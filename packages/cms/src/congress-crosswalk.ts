import { eq, inArray } from 'drizzle-orm';
import {
  bioguideUrl,
  legislatorFileSchema,
  legislatorFullName,
  legislatorSortName,
  LEGISLATORS_BASE,
  LEGISLATORS_PROJECT_URL,
  type Legislator,
  type PersonIdentifierScheme,
} from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';
import { recordChange, type Actor, type Tx } from './changes';
import { insertCitation } from './citations';
import {
  CONGRESS_ACCOUNT,
  ensureImportSource,
  fetchText,
  systemActor,
  todayUtc,
  type FetchOptions,
} from './ingest-common';
import { uniqueSlug } from './slugs';

const { ingestRun, ingestSnapshot, person, personIdentifier } = schema;

/*
 * The ID crosswalk: unitedstates/congress-legislators lists, for every Member of
 * Congress, their Bioguide ID next to their FEC candidate IDs (and Wikidata ID). This
 * gives each CivicScope person the Bioguide ID that Congress.gov records use, so votes
 * and bills attach to the person the FEC import (or an editor) already created.
 */

export interface CrosswalkAttention {
  bioguideId: string;
  name: string;
  problem: string;
}

export interface CrosswalkSummary {
  fetched: number;
  /** Legislators in scope: everyone current, plus former members who served since `since`. */
  considered: number;
  created: number;
  /** Existing people who were given IDs they didn't have. */
  linked: number;
  identifiersAdded: number;
  unchanged: number;
  attention: CrosswalkAttention[];
}

export interface CrosswalkOptions extends FetchOptions {
  baseUrl?: string;
  /** Former members are included when their last term ended on or after this date. */
  since?: string;
  startedBy?: number | null;
  today?: string;
}

/** The start of the 118th Congress: covers everyone who has voted since 2023. */
export const CROSSWALK_DEFAULT_SINCE = '2023-01-03';

const SCHEMES = ['bioguide', 'fec_candidate_id', 'wikidata'] as const;
type Key = `${(typeof SCHEMES)[number]}:${string}`;

function legislatorIds(l: Legislator): { scheme: PersonIdentifierScheme; value: string }[] {
  return [
    { scheme: 'bioguide', value: l.id.bioguide },
    ...(l.id.fec ?? []).map((value) => ({ scheme: 'fec_candidate_id' as const, value })),
    ...(l.id.wikidata ? [{ scheme: 'wikidata' as const, value: l.id.wikidata }] : []),
  ];
}

/** Lowercased, without accents or punctuation, for spotting possible duplicates. */
const nameKey = (name: string) =>
  name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

async function addIdentifier(
  tx: Tx,
  actor: Actor,
  personId: number,
  id: { scheme: PersonIdentifierScheme; value: string },
) {
  const [res] = await tx.insert(personIdentifier).values({ personId, ...id });
  const [row] = await tx
    .select()
    .from(personIdentifier)
    .where(eq(personIdentifier.id, res.insertId));
  await recordChange(tx, actor, {
    entityType: 'person_identifier',
    entityId: res.insertId,
    action: 'create',
    before: null,
    after: row!,
    note: `Added to person ${personId} from unitedstates/congress-legislators`,
  });
}

/**
 * Matches every legislator in scope to a CivicScope person by ID and fills in the IDs
 * the person is missing. A legislator nobody matches becomes a new draft person, cited
 * to their Bioguide entry. Never merges or guesses: IDs that point at two different
 * people, a person with the same name but no matching ID, and archived people are
 * listed for an editor instead.
 */
export async function runLegislatorCrosswalk(
  db: Db,
  opts: CrosswalkOptions = {},
): Promise<{ runId: number; summary: CrosswalkSummary }> {
  const since = opts.since ?? CROSSWALK_DEFAULT_SINCE;
  const today = opts.today ?? todayUtc();
  const actor = await systemActor(db, CONGRESS_ACCOUNT);
  const [run] = await db.insert(ingestRun).values({
    source: 'congress_legislators',
    params: { since },
    startedBy: opts.startedBy ?? null,
  });
  const runId = run.insertId;
  const summary: CrosswalkSummary = {
    fetched: 0,
    considered: 0,
    created: 0,
    linked: 0,
    identifiersAdded: 0,
    unchanged: 0,
    attention: [],
  };
  try {
    const legislators: Legislator[] = [];
    for (const file of ['legislators-current.json', 'legislators-historical.json']) {
      const url = new URL(file, opts.baseUrl ?? LEGISLATORS_BASE);
      const body = await fetchText(url, opts);
      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        throw new Error(`${file} is not JSON.`);
      }
      const parsed = legislatorFileSchema.safeParse(json);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(
          `${file} is not in the expected format (${issue?.path.join('.')}: ${issue?.message}). Nothing was imported.`,
        );
      }
      await db.insert(ingestSnapshot).values({ runId, url: url.toString(), body });
      summary.fetched += parsed.data.length;
      const current = file === 'legislators-current.json';
      legislators.push(...parsed.data.filter((l) => current || l.terms.at(-1)!.end >= since));
    }
    // A member can appear in both files for a moment after leaving office.
    const seen = new Set<string>();
    const inScope = legislators.filter((l) => {
      if (seen.has(l.id.bioguide)) return false;
      seen.add(l.id.bioguide);
      return true;
    });
    summary.considered = inScope.length;

    const owners = new Map<Key, number>();
    for (const row of await db
      .select()
      .from(personIdentifier)
      .where(inArray(personIdentifier.scheme, [...SCHEMES]))) {
      owners.set(`${row.scheme}:${row.value}` as Key, row.personId);
    }
    const people = new Map((await db.select().from(person)).map((p) => [p.id, p] as const));
    const withBioguide = new Set(
      [...owners.entries()].filter(([k]) => k.startsWith('bioguide:')).map(([, id]) => id),
    );
    const byName = new Map<string, number[]>();
    for (const p of people.values()) {
      if (p.deletedAt || withBioguide.has(p.id)) continue;
      const k = nameKey(p.fullName);
      byName.set(k, [...(byName.get(k) ?? []), p.id]);
    }

    const datasetRef = {
      url: LEGISLATORS_PROJECT_URL,
      title: 'congress-legislators: Members of the United States Congress, 1789–present',
      publisher: 'The @unitedstates project',
      sourceType: 'reference' as const,
    };

    for (const l of inScope) {
      const name = legislatorFullName(l);
      const ids = legislatorIds(l);
      const found = new Set(
        ids.map((i) => owners.get(`${i.scheme}:${i.value}` as Key)).filter((x) => x != null),
      );
      if (found.size > 1) {
        const list = [...found].map((id) => `${people.get(id)?.fullName} (#${id})`).join(' and ');
        summary.attention.push({
          bioguideId: l.id.bioguide,
          name,
          problem: `This member’s IDs belong to different people: ${list}. If they are the same person, merge them; otherwise move the ID that is wrong.`,
        });
        continue;
      }
      if (found.size === 1) {
        const personId = [...found][0]!;
        const p = people.get(personId)!;
        const missing = ids.filter((i) => !owners.has(`${i.scheme}:${i.value}` as Key));
        if (missing.length === 0) {
          summary.unchanged++;
          continue;
        }
        if (p.deletedAt) {
          summary.attention.push({
            bioguideId: l.id.bioguide,
            name,
            problem: `Matches ${p.fullName} (#${p.id}), who is archived. Restore them to link their congressional record.`,
          });
          continue;
        }
        await db.transaction(async (tx) => {
          for (const id of missing) await addIdentifier(tx, actor, personId, id);
        });
        for (const id of missing) owners.set(`${id.scheme}:${id.value}` as Key, personId);
        summary.linked++;
        summary.identifiersAdded += missing.length;
        continue;
      }

      const sameName = [
        ...new Set([
          ...(byName.get(nameKey(name)) ?? []),
          ...(byName.get(nameKey(`${l.name.first} ${l.name.last}`)) ?? []),
        ]),
      ];
      if (sameName.length) {
        const list = sameName.map((id) => `${people.get(id)?.fullName} (#${id})`).join(', ');
        summary.attention.push({
          bioguideId: l.id.bioguide,
          name,
          problem: `Possible duplicate of ${list}, who has no matching ID. If it is the same person, add Bioguide ID ${l.id.bioguide} to them and the next run links the rest.`,
        });
        continue;
      }

      const personId = await db.transaction(async (tx) => {
        const slug = await uniqueSlug(tx, person, person.slug, name);
        const [res] = await tx
          .insert(person)
          .values({ fullName: name, sortName: legislatorSortName(l), slug });
        const [created] = await tx.select().from(person).where(eq(person.id, res.insertId));
        await recordChange(tx, actor, {
          entityType: 'person',
          entityId: res.insertId,
          action: 'create',
          before: null,
          after: created!,
          note: 'Created from unitedstates/congress-legislators',
        });
        for (const id of ids) await addIdentifier(tx, actor, res.insertId, id);
        const bio = await ensureImportSource(
          tx,
          actor,
          {
            url: bioguideUrl(l.id.bioguide),
            title: `${name}, Biographical Directory of the United States Congress`,
            publisher: 'U.S. Congress',
            sourceType: 'government_record',
          },
          today,
        );
        await insertCitation(tx, actor, {
          sourceId: bio,
          subjectType: 'person',
          subjectId: res.insertId,
          field: null,
          excerpt: null,
          locator: null,
        });
        const dataset = await ensureImportSource(tx, actor, datasetRef, today);
        await insertCitation(tx, actor, {
          sourceId: dataset,
          subjectType: 'person',
          subjectId: res.insertId,
          field: 'fullName',
          excerpt: null,
          locator: `id.bioguide = ${l.id.bioguide}`,
        });
        return res.insertId;
      });
      for (const id of ids) owners.set(`${id.scheme}:${id.value}` as Key, personId);
      summary.created++;
      summary.identifiersAdded += ids.length;
    }

    await db
      .update(ingestRun)
      .set({ state: 'succeeded', finishedAt: new Date(), summary })
      .where(eq(ingestRun.id, runId));
    return { runId, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(ingestRun)
      .set({ state: 'failed', finishedAt: new Date(), summary, error: message.slice(0, 2000) })
      .where(eq(ingestRun.id, runId));
    throw error;
  }
}

/** The Bioguide IDs recorded for a person (normally one). */
export async function bioguideIdsFor(db: Db | Tx, personId: number): Promise<string[]> {
  const rows = await db
    .select({ value: personIdentifier.value, scheme: personIdentifier.scheme })
    .from(personIdentifier)
    .where(eq(personIdentifier.personId, personId));
  return rows.filter((r) => r.scheme === 'bioguide').map((r) => r.value);
}
