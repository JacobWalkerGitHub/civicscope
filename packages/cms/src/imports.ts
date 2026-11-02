import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  CANDIDATE_IMPORT_COLUMNS,
  candidateImportInputSchema,
  candidateImportRowSchema,
  csvHeaderKey,
  CsvSyntaxError,
  defaultSortName,
  fieldErrors,
  parseCsv,
  sourceRefSchema,
  type CandidacyStatus,
  type CandidateImportRow,
  type SourceRefInput,
} from '@civicscope/core';
import { recordAudit, schema, type Db } from '@civicscope/db';
import { recordChange, type Actor, type Tx } from './changes';
import { insertCitation } from './citations';
import { CmsError, NotFoundError } from './errors';
import { removeLock } from './locks';
import { parseInput } from './parse';
import { uniqueSlug } from './slugs';
import { resolveSource } from './sources';

const {
  importBatch,
  reviewItem,
  fieldLock,
  person,
  personIdentifier,
  candidacy,
  candidacyStatusEvent,
  citation,
  race,
  election,
  party,
  source,
  adminUser,
} = schema;

export type ImportBatch = typeof importBatch.$inferSelect;

/** Large enough for a statewide candidate list; small enough to preview on one page. */
export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 900_000;

const COLUMN_FOR_FIELD = Object.fromEntries(
  Object.entries(CANDIDATE_IMPORT_COLUMNS).map(([col, field]) => [field, col]),
) as Record<string, string>;

/** Candidacy fields an import can set, as shown in previews and conflicts. */
export const IMPORT_FIELD_LABELS: Record<string, string> = {
  ballotName: 'Name on the ballot',
  partyId: 'Party',
  isIncumbent: 'Incumbent',
  campaignUrl: 'Campaign website',
  fecCommitteeId: 'FEC committee ID',
  status: 'Status',
};

export type RowAction = 'create' | 'add_to_race' | 'update' | 'unchanged' | 'error';

export interface PlannedChange {
  field: keyof typeof IMPORT_FIELD_LABELS;
  from: unknown;
  to: unknown;
  /** Locked fields are not changed; a conflict opens for review instead. */
  locked: boolean;
  /** For status changes: the date the file gives. */
  statusDate?: string;
}

export interface PlannedRow {
  line: number;
  name: string;
  action: RowAction;
  errors: string[];
  warnings: string[];
  personId: number | null;
  personName: string | null;
  candidacyId: number | null;
  changes: PlannedChange[];
  /** An FEC candidate ID to attach to the person. */
  addFecId: string | null;
  data: CandidateImportRow | null;
  partyId: number | null;
}

export interface ImportPlan {
  fileErrors: string[];
  rows: PlannedRow[];
  counts: Record<RowAction, number>;
  conflicts: number;
}

export type ImportSummary = Record<RowAction, number> & { conflicts: number };

const normalizeName = (s: string) =>
  s.normalize('NFKD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();

async function loadBatch(tx: Tx | Db, id: number): Promise<ImportBatch> {
  const [row] = await tx.select().from(importBatch).where(eq(importBatch.id, id));
  if (!row) throw new NotFoundError('Import');
  return row;
}

/** Reads the header and checks the file's shape; throws CmsError for an unusable file. */
function readFile(csvText: string): {
  header: string[];
  rows: { line: number; cells: string[] }[];
} {
  let parsed;
  try {
    parsed = parseCsv(csvText);
  } catch (error) {
    if (error instanceof CsvSyntaxError)
      throw new CmsError(`The file is not valid CSV. ${error.message}`);
    throw error;
  }
  const [head, ...rows] = parsed;
  if (!head) throw new CmsError('The file is empty.');
  const header = head.cells.map(csvHeaderKey);
  const known = Object.keys(CANDIDATE_IMPORT_COLUMNS);
  const unknown = header.filter((h) => !known.includes(h));
  if (unknown.length) {
    throw new CmsError(
      `Unknown column${unknown.length > 1 ? 's' : ''}: ${unknown.map((u) => `"${u || '(blank)'}"`).join(', ')}. The columns are: ${known.join(', ')}.`,
    );
  }
  const dupes = header.filter((h, i) => header.indexOf(h) !== i);
  if (dupes.length) throw new CmsError(`The column "${dupes[0]}" appears twice.`);
  if (!header.includes('full_name')) throw new CmsError('The file needs a full_name column.');
  if (rows.length === 0) throw new CmsError('The file has a header but no rows.');
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new CmsError(
      `The file has ${rows.length} rows; split it into files of ${MAX_IMPORT_ROWS} or fewer.`,
    );
  }
  return { header, rows };
}

/**
 * Stores an uploaded candidate CSV for preview. The file's shape (CSV syntax, known
 * columns, size) is checked now; each row is checked in the preview.
 */
export async function createCandidateImport(
  db: Db,
  actor: Actor,
  input: { fileName: string; csvText: string } & Record<string, unknown>,
): Promise<number> {
  const data = parseInput(candidateImportInputSchema, input);
  if (!input.csvText || !input.fileName) {
    throw new CmsError('Choose a CSV file to upload.', { file: 'Choose a CSV file.' });
  }
  if (Buffer.byteLength(input.csvText) > MAX_IMPORT_BYTES) {
    throw new CmsError('The file is too large. Split it into smaller files.', {
      file: 'Under 900 KB, please.',
    });
  }
  readFile(input.csvText);
  return db.transaction(async (tx) => {
    const [raceRow] = await tx.select().from(race).where(eq(race.id, data.raceId));
    if (!raceRow) throw new NotFoundError('Race');
    if (raceRow.deletedAt) throw new CmsError('That race is archived.');
    const sourceRef: SourceRefInput = {
      sourceUrl: data.sourceUrl,
      sourceTitle: data.sourceTitle ?? null,
      sourcePublisher: data.sourcePublisher ?? null,
      sourceType: data.sourceType ?? null,
      sourcePublishedAt: data.sourcePublishedAt ?? null,
    };
    // Check the source now (known URL, or enough detail to create it) so apply won't fail on it.
    const known = await tx
      .select({ id: source.id, deletedAt: source.deletedAt })
      .from(source)
      .where(eq(source.urlHash, sql`sha2(${sourceRef.sourceUrl}, 256)`));
    if (known[0]?.deletedAt) {
      throw new CmsError('That source was archived. Restore it on the Sources page to cite it.', {
        sourceUrl: 'This source is archived.',
      });
    }
    if (!known[0]) {
      const missing: Record<string, string> = {};
      if (!sourceRef.sourceTitle) missing.sourceTitle = 'New source: enter its title.';
      if (!sourceRef.sourcePublisher)
        missing.sourcePublisher = 'New source: enter who published it.';
      if (!sourceRef.sourceType) missing.sourceType = 'New source: choose its type.';
      if (Object.keys(missing).length) {
        throw new CmsError(
          'This URL is not a known source yet. Fill in its title, publisher and type.',
          missing,
        );
      }
    }
    const [res] = await tx.insert(importBatch).values({
      kind: 'candidates',
      raceId: data.raceId,
      fileName: input.fileName.slice(0, 255),
      csvText: input.csvText,
      sourceRef,
      createdBy: actor.userId,
    });
    await recordAudit(tx, {
      actorType: 'user',
      actorId: String(actor.userId),
      action: 'create',
      entityType: 'import_batch',
      entityId: String(res.insertId),
      diff: { fileName: [null, input.fileName], raceId: [null, data.raceId] },
      note: 'Uploaded for preview',
      ipAddress: actor.ipAddress ?? null,
    });
    return res.insertId;
  });
}

/**
 * Works out what applying the file would do, without writing anything: which rows
 * create people, which add existing people to the race, which update candidacies,
 * and which fields are locked. Run again at apply time inside the transaction.
 */
export async function planCandidateImport(
  tx: Tx | Db,
  batch: Pick<ImportBatch, 'csvText' | 'raceId'>,
): Promise<ImportPlan> {
  const counts: Record<RowAction, number> = {
    create: 0,
    add_to_race: 0,
    update: 0,
    unchanged: 0,
    error: 0,
  };
  let file;
  try {
    file = readFile(batch.csvText);
  } catch (error) {
    if (error instanceof CmsError)
      return { fileErrors: [error.message], rows: [], counts, conflicts: 0 };
    throw error;
  }
  const [raceRow] = await tx.select().from(race).where(eq(race.id, batch.raceId));
  if (!raceRow) throw new NotFoundError('Race');
  const fileErrors: string[] = [];
  if (raceRow.deletedAt) fileErrors.push('The race this file goes into has been archived.');

  // Parse every row first so lookups can be batched.
  const parsed = file.rows.map(({ line, cells }) => {
    const errors: string[] = [];
    if (cells.length > file.header.length) {
      errors.push(`This row has ${cells.length} cells but the header has ${file.header.length}.`);
    }
    const raw: Record<string, string> = {};
    file.header.forEach((col, i) => {
      raw[CANDIDATE_IMPORT_COLUMNS[col as keyof typeof CANDIDATE_IMPORT_COLUMNS]] = cells[i] ?? '';
    });
    const result = candidateImportRowSchema.safeParse(raw);
    if (!result.success) {
      for (const [field, message] of Object.entries(fieldErrors(result.error))) {
        errors.push(`${COLUMN_FOR_FIELD[field] ?? field}: ${message}`);
      }
    }
    return { line, raw, errors, data: result.success ? result.data : null };
  });

  const valid = parsed.flatMap((p) => (p.data ? [p.data] : []));
  const fecIds = [...new Set(valid.flatMap((d) => (d.fecCandidateId ? [d.fecCandidateId] : [])))];
  const explicitIds = [
    ...new Set(valid.flatMap((d) => (typeof d.personId === 'number' ? [d.personId] : []))),
  ];
  const names = [...new Set(valid.map((d) => d.fullName.replace(/\s+/g, ' ').trim()))];

  const fecOwners = new Map<string, number>();
  if (fecIds.length) {
    for (const r of await tx
      .select({ value: personIdentifier.value, personId: personIdentifier.personId })
      .from(personIdentifier)
      .where(
        and(
          eq(personIdentifier.scheme, 'fec_candidate_id'),
          inArray(personIdentifier.value, fecIds),
        ),
      )) {
      fecOwners.set(r.value, r.personId);
    }
  }
  const peopleIds = [...new Set([...explicitIds, ...fecOwners.values()])];
  const people = new Map<number, typeof person.$inferSelect>();
  if (peopleIds.length) {
    for (const p of await tx.select().from(person).where(inArray(person.id, peopleIds))) {
      people.set(p.id, p);
    }
  }
  const sameName = new Map<string, { id: number; fullName: string }[]>();
  if (names.length) {
    for (const p of await tx
      .select({ id: person.id, fullName: person.fullName })
      .from(person)
      .where(and(inArray(person.fullName, names), isNull(person.deletedAt)))) {
      const key = normalizeName(p.fullName);
      sameName.set(key, [...(sameName.get(key) ?? []), p]);
    }
  }
  const inRace = await tx
    .select({
      candidacy,
      personName: person.fullName,
    })
    .from(candidacy)
    .innerJoin(person, eq(person.id, candidacy.personId))
    .where(eq(candidacy.raceId, batch.raceId));
  const byPerson = new Map(inRace.map((r) => [r.candidacy.personId, r]));
  const byName = new Map<string, number>();
  for (const r of inRace) {
    byName.set(normalizeName(r.personName), r.candidacy.personId);
    byName.set(normalizeName(r.candidacy.ballotName), r.candidacy.personId);
  }
  const lockRows = inRace.length
    ? await tx
        .select({ entityId: fieldLock.entityId, field: fieldLock.field })
        .from(fieldLock)
        .where(
          and(
            eq(fieldLock.entityType, 'candidacy'),
            inArray(
              fieldLock.entityId,
              inRace.map((r) => r.candidacy.id),
            ),
          ),
        )
    : [];
  const locked = new Set(lockRows.map((l) => `${l.entityId}:${l.field}`));

  const parties = await tx.select().from(party).where(isNull(party.deletedAt));
  const resolveParty = (text: string): { id?: number; error?: string } => {
    const key = text.trim().toLowerCase();
    const hits = parties.filter((p) =>
      [p.name, p.shortName, p.slug, p.fecCode].some((v) => v && v.toLowerCase() === key),
    );
    if (hits.length === 1) return { id: hits[0]!.id };
    if (hits.length > 1) return { error: `party: "${text}" matches more than one party.` };
    return { error: `party: no party called "${text}". Add it on the Parties page first.` };
  };

  const seen = new Map<string, number>();
  const rows: PlannedRow[] = parsed.map(({ line, raw, errors, data }) => {
    const row: PlannedRow = {
      line,
      name: (raw.fullName ?? '').trim() || '(no name)',
      action: 'error',
      errors: [...errors],
      warnings: [],
      personId: null,
      personName: null,
      candidacyId: null,
      changes: [],
      addFecId: null,
      data,
      partyId: null,
    };
    if (!data || row.errors.length) return row;

    // Party: a partisan primary's candidates always carry the primary's party.
    let partyId: number | null = null;
    if (data.party) {
      const r = resolveParty(data.party);
      if (r.error) row.errors.push(r.error);
      partyId = r.id ?? null;
    }
    if (raceRow.partyId) {
      if (partyId && partyId !== raceRow.partyId) {
        row.errors.push('party: this race is one party’s primary, so candidates carry that party.');
      }
      partyId = raceRow.partyId;
    }
    row.partyId = partyId;

    // Match the person: explicit number, then FEC ID, then a name already in this race.
    let personId: number | null = null;
    const nameKey = normalizeName(data.fullName);
    const fecOwner = data.fecCandidateId ? fecOwners.get(data.fecCandidateId) : undefined;
    if (typeof data.personId === 'number') {
      const p = people.get(data.personId);
      if (!p) row.errors.push(`person_id: there is no person ${data.personId}.`);
      else if (p.deletedAt) row.errors.push(`person_id: ${p.fullName} (${p.id}) is archived.`);
      else personId = p.id;
      if (fecOwner && fecOwner !== data.personId) {
        row.errors.push(
          `fec_candidate_id: ${data.fecCandidateId} belongs to ${people.get(fecOwner)?.fullName ?? 'another person'} (${fecOwner}), not person ${data.personId}.`,
        );
      }
    } else if (fecOwner) {
      const p = people.get(fecOwner)!;
      if (p.deletedAt)
        row.errors.push(
          `fec_candidate_id: it belongs to ${p.fullName} (${p.id}), who is archived.`,
        );
      else personId = p.id;
      if (data.personId === 'new') {
        row.errors.push(
          `person_id: says "new", but ${data.fecCandidateId} already belongs to ${p.fullName} (${p.id}).`,
        );
      }
    } else if (data.personId !== 'new' && byName.has(nameKey)) {
      personId = byName.get(nameKey)!;
    } else if (data.personId !== 'new') {
      const lookalikes = sameName.get(nameKey) ?? [];
      if (lookalikes.length) {
        const list = lookalikes.map((p) => `${p.fullName} (${p.id})`).join(', ');
        row.errors.push(
          `Possible duplicate of ${list}. Put their number in person_id to use that person, or "new" to add a separate person.`,
        );
      }
    }
    if (row.errors.length) return row;

    const dupeKey = personId ? `id:${personId}` : `new:${nameKey}`;
    if (seen.has(dupeKey)) {
      row.errors.push(`The same person is already on line ${seen.get(dupeKey)}.`);
      return row;
    }
    seen.set(dupeKey, line);

    const existingPerson = personId ? (people.get(personId) ?? null) : null;
    const current = personId ? byPerson.get(personId) : undefined;
    row.personId = personId;
    row.personName = existingPerson?.fullName ?? current?.personName ?? null;
    if (data.fecCandidateId && !fecOwner) row.addFecId = data.fecCandidateId;

    if (!current) {
      row.action = personId ? 'add_to_race' : 'create';
      const set = (field: PlannedChange['field'], to: unknown, statusDate?: string) =>
        to !== null && to !== undefined && to !== false
          ? row.changes.push({ field, from: null, to, locked: false, statusDate })
          : undefined;
      set('ballotName', data.ballotName ?? row.personName ?? data.fullName);
      set('partyId', partyId);
      set('isIncumbent', data.incumbent ?? false);
      set('campaignUrl', data.campaignUrl);
      set('fecCommitteeId', data.fecCommitteeId);
      set('status', data.status, data.statusDate ?? undefined);
      return row;
    }

    const c = current.candidacy;
    row.candidacyId = c.id;
    if (c.deletedAt) {
      row.errors.push(
        `${current.personName}'s candidacy in this race is archived. Restore it first, or remove this row.`,
      );
      return row;
    }
    const change = (
      field: PlannedChange['field'],
      from: unknown,
      to: unknown,
      statusDate?: string,
    ) => {
      if (to === null || to === undefined || from === to) return;
      row.changes.push({ field, from, to, locked: locked.has(`${c.id}:${field}`), statusDate });
    };
    change('ballotName', c.ballotName, data.ballotName);
    if (!raceRow.partyId) change('partyId', c.partyId, partyId);
    change('isIncumbent', c.isIncumbent, data.incumbent);
    change('campaignUrl', c.campaignUrl, data.campaignUrl);
    change('fecCommitteeId', c.fecCommitteeId, data.fecCommitteeId);
    if (data.status && data.status !== c.status) {
      if (c.statusDate && data.statusDate! < c.statusDate) {
        row.warnings.push(
          `The file says "${data.status}" as of ${data.statusDate}, which is older than the recorded "${c.status}" as of ${c.statusDate}. Skipped.`,
        );
      } else {
        change('status', c.status, data.status, data.statusDate!);
      }
    }
    row.action = row.changes.length || row.addFecId ? 'update' : 'unchanged';
    return row;
  });

  let conflicts = 0;
  for (const r of rows) {
    if (r.errors.length) r.action = 'error';
    counts[r.action]++;
    conflicts += r.changes.filter((c) => c.locked).length;
  }
  return { fileErrors, rows, counts, conflicts };
}

export async function previewImport(db: Db, id: number) {
  const batch = await loadBatch(db, id);
  const [ctx] = await db
    .select({
      raceName: race.name,
      electionName: election.name,
      createdByName: adminUser.name,
    })
    .from(race)
    .innerJoin(election, eq(election.id, race.electionId))
    .leftJoin(adminUser, eq(adminUser.id, batch.createdBy))
    .where(eq(race.id, batch.raceId));
  const partyNames = new Map(
    (await db.select({ id: party.id, name: party.name }).from(party)).map((p) => [p.id, p.name]),
  );
  const plan = batch.state === 'preview' ? await planCandidateImport(db, batch) : null;
  return { batch, ...ctx!, plan, partyNames };
}

async function recordStatus(
  tx: Tx,
  actor: Actor,
  candidacyId: number,
  status: CandidacyStatus,
  effectiveDate: string,
  sourceId: number,
  note: string,
) {
  await tx.insert(candidacyStatusEvent).values({
    candidacyId,
    status,
    effectiveDate,
    sourceId,
    note,
    recordedBy: String(actor.userId),
  });
  await insertCitation(tx, actor, {
    sourceId,
    subjectType: 'candidacy',
    subjectId: candidacyId,
    field: 'status',
    excerpt: null,
    locator: null,
  });
  const [latest] = await tx
    .select({ status: candidacyStatusEvent.status, date: candidacyStatusEvent.effectiveDate })
    .from(candidacyStatusEvent)
    .where(eq(candidacyStatusEvent.candidacyId, candidacyId))
    .orderBy(desc(candidacyStatusEvent.effectiveDate), desc(candidacyStatusEvent.id))
    .limit(1);
  await tx
    .update(candidacy)
    .set({ status: latest!.status, statusDate: latest!.date })
    .where(eq(candidacy.id, candidacyId));
}

async function citeOnce(
  tx: Tx,
  actor: Actor,
  subjectType: 'person' | 'candidacy',
  subjectId: number,
  sourceId: number,
) {
  const [existing] = await tx
    .select({ id: citation.id })
    .from(citation)
    .where(
      and(
        eq(citation.sourceId, sourceId),
        eq(citation.subjectType, subjectType),
        eq(citation.subjectId, subjectId),
        isNull(citation.field),
        isNull(citation.deletedAt),
      ),
    );
  if (existing) return;
  await insertCitation(tx, actor, {
    sourceId,
    subjectType,
    subjectId,
    field: null,
    excerpt: null,
    locator: null,
  });
}

async function loadCandidacy(tx: Tx, id: number) {
  const [row] = await tx.select().from(candidacy).where(eq(candidacy.id, id));
  if (!row) throw new NotFoundError('Candidacy');
  return row;
}

async function openConflict(
  tx: Tx,
  batch: ImportBatch,
  sourceId: number,
  candidacyId: number,
  ch: PlannedChange,
) {
  const open = await tx
    .select({ proposedValue: reviewItem.proposedValue })
    .from(reviewItem)
    .where(
      and(
        eq(reviewItem.state, 'open'),
        eq(reviewItem.entityType, 'candidacy'),
        eq(reviewItem.entityId, candidacyId),
        eq(reviewItem.field, ch.field),
      ),
    );
  if (open.some((o) => JSON.stringify(o.proposedValue) === JSON.stringify(ch.to))) return false;
  await tx.insert(reviewItem).values({
    kind: 'field_conflict',
    entityType: 'candidacy',
    entityId: candidacyId,
    field: ch.field,
    currentValue: ch.from ?? null,
    proposedValue: ch.to,
    detail: ch.statusDate ? { statusDate: ch.statusDate } : null,
    sourceId,
    importBatchId: batch.id,
  });
  return true;
}

/**
 * Applies a previewed import in one transaction: every row is written, or none are.
 * New people and candidacies start as drafts, and every row is cited to the file's
 * source. Locked fields are left alone and open conflicts for review instead.
 */
export async function applyImport(db: Db, actor: Actor, id: number): Promise<ImportSummary> {
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(importBatch).where(eq(importBatch.id, id)).for('update');
    if (!batch) throw new NotFoundError('Import');
    if (batch.state !== 'preview') throw new CmsError(`This import was already ${batch.state}.`);
    const plan = await planCandidateImport(tx, batch);
    if (plan.fileErrors.length || plan.counts.error > 0) {
      throw new CmsError('Fix the rows with errors (or remove them) and upload the file again.');
    }
    const ref = sourceRefSchema.parse(batch.sourceRef);
    const src = await resolveSource(tx, actor, ref);
    const note =
      batch.kind === 'fec'
        ? `FEC import run ${batch.ingestRunId} (${batch.fileName})`
        : `CSV import ${batch.id} (${batch.fileName})`;
    let conflicts = 0;

    for (const row of plan.rows) {
      const data = row.data!;
      let personId = row.personId;
      if (!personId) {
        const slug = await uniqueSlug(tx, person, person.slug, data.fullName);
        const [res] = await tx
          .insert(person)
          .values({ fullName: data.fullName, sortName: defaultSortName(data.fullName), slug });
        personId = res.insertId;
        const [created] = await tx.select().from(person).where(eq(person.id, personId));
        await recordChange(tx, actor, {
          entityType: 'person',
          entityId: personId,
          action: 'create',
          before: null,
          after: created!,
          note,
        });
      }
      if (row.action === 'create' || row.action === 'add_to_race' || row.action === 'update') {
        await citeOnce(tx, actor, 'person', personId, src.id);
      }
      if (row.addFecId) {
        const [res] = await tx
          .insert(personIdentifier)
          .values({ personId, scheme: 'fec_candidate_id', value: row.addFecId });
        const [ident] = await tx
          .select()
          .from(personIdentifier)
          .where(eq(personIdentifier.id, res.insertId));
        await recordChange(tx, actor, {
          entityType: 'person_identifier',
          entityId: res.insertId,
          action: 'create',
          before: null,
          after: ident!,
          note,
        });
      }

      const status = row.changes.find((c) => c.field === 'status');
      if (row.action === 'create' || row.action === 'add_to_race') {
        const val = (f: string) => row.changes.find((c) => c.field === f)?.to;
        const [res] = await tx.insert(candidacy).values({
          personId,
          raceId: batch.raceId,
          partyId: row.partyId,
          ballotName: val('ballotName') as string,
          isIncumbent: Boolean(val('isIncumbent')),
          campaignUrl: (val('campaignUrl') as string | undefined) ?? null,
          fecCommitteeId: (val('fecCommitteeId') as string | undefined) ?? null,
        });
        const candidacyId = res.insertId;
        await recordChange(tx, actor, {
          entityType: 'candidacy',
          entityId: candidacyId,
          action: 'create',
          before: null,
          after: await loadCandidacy(tx, candidacyId),
          note,
        });
        await citeOnce(tx, actor, 'candidacy', candidacyId, src.id);
        if (status) {
          const before = await loadCandidacy(tx, candidacyId);
          await recordStatus(
            tx,
            actor,
            candidacyId,
            status.to as CandidacyStatus,
            status.statusDate!,
            src.id,
            note,
          );
          await recordChange(tx, actor, {
            entityType: 'candidacy',
            entityId: candidacyId,
            action: 'update',
            before,
            after: await loadCandidacy(tx, candidacyId),
            note: `${note}: status ${String(status.to)} as of ${status.statusDate}`,
          });
        }
        continue;
      }

      if (row.action !== 'update') continue;
      const candidacyId = row.candidacyId!;
      const before = await loadCandidacy(tx, candidacyId);
      const updates: Record<string, unknown> = {};
      for (const ch of row.changes) {
        if (ch.locked) {
          if (await openConflict(tx, batch, src.id, candidacyId, ch)) conflicts++;
        } else if (ch.field !== 'status') {
          updates[ch.field] = ch.to;
        }
      }
      if (Object.keys(updates).length) {
        await tx.update(candidacy).set(updates).where(eq(candidacy.id, candidacyId));
      }
      if (status && !status.locked) {
        await recordStatus(
          tx,
          actor,
          candidacyId,
          status.to as CandidacyStatus,
          status.statusDate!,
          src.id,
          note,
        );
      }
      const after = await loadCandidacy(tx, candidacyId);
      if (Object.keys(updates).length || (status && !status.locked)) {
        await recordChange(tx, actor, {
          entityType: 'candidacy',
          entityId: candidacyId,
          action: 'update',
          before,
          after,
          note,
        });
        await citeOnce(tx, actor, 'candidacy', candidacyId, src.id);
      }
    }

    const summary: ImportSummary = { ...plan.counts, conflicts };
    await tx
      .update(importBatch)
      .set({
        state: 'applied',
        sourceId: src.id,
        summary,
        closedBy: actor.userId,
        closedAt: new Date(),
      })
      .where(eq(importBatch.id, id));
    await recordAudit(tx, {
      actorType: 'user',
      actorId: String(actor.userId),
      action: 'import',
      entityType: 'import_batch',
      entityId: String(id),
      diff: { state: ['preview', 'applied'] },
      note: `${batch.fileName}: ${summary.create} new, ${summary.add_to_race} added, ${summary.update} updated, ${summary.unchanged} unchanged, ${conflicts} conflicts`,
      ipAddress: actor.ipAddress ?? null,
    });
    return summary;
  });
}

export async function discardImport(db: Db, actor: Actor, id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [batch] = await tx.select().from(importBatch).where(eq(importBatch.id, id)).for('update');
    if (!batch) throw new NotFoundError('Import');
    if (batch.state !== 'preview') throw new CmsError(`This import was already ${batch.state}.`);
    await tx
      .update(importBatch)
      .set({ state: 'discarded', closedBy: actor.userId, closedAt: new Date() })
      .where(eq(importBatch.id, id));
    await recordAudit(tx, {
      actorType: 'user',
      actorId: String(actor.userId),
      action: 'update',
      entityType: 'import_batch',
      entityId: String(id),
      diff: { state: ['preview', 'discarded'] },
      note: 'Discarded without applying',
      ipAddress: actor.ipAddress ?? null,
    });
  });
}

export async function listImports(db: Db) {
  return db
    .select({
      id: importBatch.id,
      fileName: importBatch.fileName,
      state: importBatch.state,
      summary: importBatch.summary,
      createdAt: importBatch.createdAt,
      closedAt: importBatch.closedAt,
      raceId: race.id,
      raceName: race.name,
      createdByName: adminUser.name,
    })
    .from(importBatch)
    .innerJoin(race, eq(race.id, importBatch.raceId))
    .leftJoin(adminUser, eq(adminUser.id, importBatch.createdBy))
    .orderBy(desc(importBatch.createdAt), desc(importBatch.id))
    .limit(100);
}

// Conflicts between a locked field and what an import's source says.

export async function countOpenConflicts(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(reviewItem)
    .where(eq(reviewItem.state, 'open'));
  return Number(row?.n ?? 0);
}

export async function listOpenConflicts(db: Db) {
  return db
    .select({
      id: reviewItem.id,
      field: reviewItem.field,
      currentValue: reviewItem.currentValue,
      proposedValue: reviewItem.proposedValue,
      detail: reviewItem.detail,
      createdAt: reviewItem.createdAt,
      importBatchId: reviewItem.importBatchId,
      candidacyId: candidacy.id,
      ballotName: candidacy.ballotName,
      raceName: race.name,
      sourceTitle: source.title,
      sourceUrl: source.url,
    })
    .from(reviewItem)
    .innerJoin(candidacy, eq(candidacy.id, reviewItem.entityId))
    .innerJoin(race, eq(race.id, candidacy.raceId))
    .innerJoin(source, eq(source.id, reviewItem.sourceId))
    .where(and(eq(reviewItem.state, 'open'), eq(reviewItem.entityType, 'candidacy')))
    .orderBy(reviewItem.createdAt, reviewItem.id);
}

/**
 * Settles a conflict. Accepting writes the source's value and removes the lock, so
 * the field follows imports again; keeping the current value leaves the lock in place.
 */
export async function resolveConflict(
  db: Db,
  actor: Actor,
  id: number,
  decision: 'accept' | 'reject',
  note?: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [item] = await tx.select().from(reviewItem).where(eq(reviewItem.id, id)).for('update');
    if (!item) throw new NotFoundError('Conflict');
    if (item.state !== 'open') throw new CmsError('This conflict was already settled.');
    if (decision === 'accept') {
      const before = await loadCandidacy(tx, item.entityId);
      if (before.deletedAt) throw new CmsError('Restore this candidacy before changing it.');
      const label = `Accepted the source’s value (conflict ${id})`;
      if (item.field === 'status') {
        const statusDate = (item.detail as { statusDate?: string } | null)?.statusDate;
        if (!statusDate) throw new CmsError('This conflict has no status date.');
        await recordStatus(
          tx,
          actor,
          item.entityId,
          item.proposedValue as CandidacyStatus,
          statusDate,
          item.sourceId,
          label,
        );
      } else if (item.field in IMPORT_FIELD_LABELS) {
        if (item.field === 'partyId') {
          const [p] = await tx
            .select()
            .from(party)
            .where(eq(party.id, Number(item.proposedValue)));
          if (!p || p.deletedAt) throw new CmsError('That party is archived.');
        }
        await tx
          .update(candidacy)
          .set({ [item.field]: item.proposedValue })
          .where(eq(candidacy.id, item.entityId));
      } else {
        throw new CmsError('This field can’t be changed from here.');
      }
      await recordChange(tx, actor, {
        entityType: 'candidacy',
        entityId: item.entityId,
        action: 'update',
        before,
        after: await loadCandidacy(tx, item.entityId),
        note: note ? `${label}: ${note}` : label,
      });
      await citeOnce(tx, actor, 'candidacy', item.entityId, item.sourceId);
      const [lock] = await tx
        .select({ id: fieldLock.id })
        .from(fieldLock)
        .where(
          and(
            eq(fieldLock.entityType, 'candidacy'),
            eq(fieldLock.entityId, item.entityId),
            eq(fieldLock.field, item.field),
          ),
        );
      if (lock) await removeLock(tx, actor, lock.id, label);
    }
    await tx
      .update(reviewItem)
      .set({
        state: decision === 'accept' ? 'accepted' : 'rejected',
        resolvedBy: actor.userId,
        resolvedAt: new Date(),
        resolutionNote: note ?? null,
      })
      .where(eq(reviewItem.id, id));
    await recordAudit(tx, {
      actorType: 'user',
      actorId: String(actor.userId),
      action: 'update',
      entityType: 'review_item',
      entityId: String(id),
      diff: { state: ['open', decision === 'accept' ? 'accepted' : 'rejected'] },
      note: note ?? null,
      ipAddress: actor.ipAddress ?? null,
    });
  });
}

/** Races a file can be imported into: not archived, newest elections first. */
export async function listRacesForImport(db: Db) {
  return db
    .select({
      id: race.id,
      name: race.name,
      electionName: election.name,
      electionDate: election.date,
    })
    .from(race)
    .innerJoin(election, eq(election.id, race.electionId))
    .where(and(isNull(race.deletedAt), isNull(election.deletedAt)))
    .orderBy(desc(election.date), race.name);
}
