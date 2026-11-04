import type { ResultGroup } from '@civicscope/core';

/*
 * Parsers for official state election-night results files. Each turns the state's own
 * format into the same shape: contests with statewide totals, and, where the state
 * reports them, the same totals for each county.
 */

export interface ParsedCandidate {
  /** Name plus party: stable between reads of the same file. */
  key: string;
  name: string;
  party: string | null;
  votes: number;
}

export interface ParsedArea {
  code: string;
  name: string;
  precinctsTotal: number | null;
  precinctsReporting: number | null;
  votes: Record<string, number>;
}

export interface ParsedContest {
  sourceKey: string;
  name: string;
  group: ResultGroup;
  voteFor: number;
  precinctsTotal: number | null;
  precinctsReporting: number | null;
  candidates: ParsedCandidate[];
  areas: ParsedArea[];
}

const int = (v: unknown): number => {
  const n = Number(
    String(v ?? '')
      .replace(/,/g, '')
      .trim(),
  );
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};

const clean = (s: unknown) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const GROUP_ORDER: Record<ResultGroup, number> = {
  federal: 0,
  statewide: 1,
  legislature: 2,
  judicial: 3,
  measure: 4,
  local: 5,
};

/** Sorts contests by group, then by name with district numbers in natural order. */
export function sortContests<T extends { group: ResultGroup; name: string }>(list: T[]): T[] {
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  const rank = (c: T) => {
    // Within federal: Senate before House.
    if (c.group === 'federal') return /senat/i.test(c.name) ? 0 : 1;
    // Within statewide: the governor first.
    if (c.group === 'statewide') return /governor/i.test(c.name) ? 0 : 1;
    if (c.group === 'legislature') return /senat/i.test(c.name) ? 0 : 1;
    return 0;
  };
  return [...list].sort(
    (a, b) =>
      GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
      rank(a) - rank(b) ||
      collator.compare(a.name, b.name),
  );
}

const candidateKey = (name: string, party: string | null) => `${name}|${party ?? ''}`.slice(0, 191);

// ------------------------------------------------------------------ North Carolina

/**
 * North Carolina State Board of Elections: er.ncsbe.gov/enr/<yyyymmdd>/data/results_0.txt,
 * a JSON array with one row per candidate per contest, statewide totals only.
 */
export function parseNcsbe(body: string): ParsedContest[] {
  const rows = JSON.parse(body) as Record<string, unknown>[];
  if (!Array.isArray(rows)) throw new Error('North Carolina results: expected a JSON array.');
  const contests = new Map<string, ParsedContest>();
  for (const r of rows) {
    const id = clean(r.gid) || clean(r.cnm);
    const rawName = clean(r.cnm);
    if (!id || !rawName) continue;
    let c = contests.get(id);
    if (!c) {
      c = {
        sourceKey: id,
        // "US SENATE (VOTE FOR 1)": the vote-for count is shown separately.
        name: titleCase(rawName.replace(/\s*\(VOTE FOR \d+\)\s*$/i, '')),
        group: ncGroup(clean(r.ogl), rawName),
        voteFor: Math.max(1, int(r.vfr) || 1),
        precinctsTotal: r.ptl === undefined ? null : int(r.ptl),
        precinctsReporting: r.prt === undefined ? null : int(r.prt),
        candidates: [],
        areas: [],
      };
      contests.set(id, c);
    }
    const name = clean(r.bnm);
    const party = clean(r.pty) || null;
    c.candidates.push({ key: candidateKey(name, party), name, party, votes: int(r.vct) });
  }
  return sortContests([...contests.values()]);
}

/** NC's county IDs: its 100 counties in alphabetical order, 1 to 100. */
export const NC_COUNTIES = [
  'Alamance',
  'Alexander',
  'Alleghany',
  'Anson',
  'Ashe',
  'Avery',
  'Beaufort',
  'Bertie',
  'Bladen',
  'Brunswick',
  'Buncombe',
  'Burke',
  'Cabarrus',
  'Caldwell',
  'Camden',
  'Carteret',
  'Caswell',
  'Catawba',
  'Chatham',
  'Cherokee',
  'Chowan',
  'Clay',
  'Cleveland',
  'Columbus',
  'Craven',
  'Cumberland',
  'Currituck',
  'Dare',
  'Davidson',
  'Davie',
  'Duplin',
  'Durham',
  'Edgecombe',
  'Forsyth',
  'Franklin',
  'Gaston',
  'Gates',
  'Graham',
  'Granville',
  'Greene',
  'Guilford',
  'Halifax',
  'Harnett',
  'Haywood',
  'Henderson',
  'Hertford',
  'Hoke',
  'Hyde',
  'Iredell',
  'Jackson',
  'Johnston',
  'Jones',
  'Lee',
  'Lenoir',
  'Lincoln',
  'Macon',
  'Madison',
  'Martin',
  'McDowell',
  'Mecklenburg',
  'Mitchell',
  'Montgomery',
  'Moore',
  'Nash',
  'New Hanover',
  'Northampton',
  'Onslow',
  'Orange',
  'Pamlico',
  'Pasquotank',
  'Pender',
  'Perquimans',
  'Person',
  'Pitt',
  'Polk',
  'Randolph',
  'Richmond',
  'Robeson',
  'Rockingham',
  'Rowan',
  'Rutherford',
  'Sampson',
  'Scotland',
  'Stanly',
  'Stokes',
  'Surry',
  'Swain',
  'Transylvania',
  'Tyrrell',
  'Union',
  'Vance',
  'Wake',
  'Warren',
  'Washington',
  'Watauga',
  'Wayne',
  'Wilkes',
  'Wilson',
  'Yadkin',
  'Yancey',
];

/**
 * Adds each county's numbers (results_<county id>.txt, same format as the statewide
 * file) to the statewide contests, matched by the state's contest ID.
 */
export function addCountyAreas(
  contests: ParsedContest[],
  counties: { code: string; name: string; body: string }[],
): ParsedContest[] {
  const byKey = new Map(contests.map((c) => [c.sourceKey, c]));
  for (const county of counties) {
    for (const local of parseNcsbe(county.body)) {
      const c = byKey.get(local.sourceKey);
      if (!c) continue;
      c.areas.push({
        code: county.code,
        name: county.name,
        precinctsTotal: local.precinctsTotal,
        precinctsReporting: local.precinctsReporting,
        votes: Object.fromEntries(local.candidates.map((x) => [x.key, x.votes])),
      });
    }
  }
  for (const c of contests) c.areas.sort((a, b) => a.name.localeCompare(b.name));
  return contests;
}

function ncGroup(ogl: string, name: string): ResultGroup {
  switch (ogl) {
    case 'FED':
      return 'federal';
    case 'NCS':
    case 'NCH':
      return 'legislature';
    case 'JUD':
      return 'judicial';
    case 'COS':
      return 'statewide';
    case '':
      return /AMENDMENT|REFERENDUM|BOND/i.test(name) ? 'measure' : 'statewide';
    default:
      return /REFERENDUM|BONDS?\b/i.test(name) ? 'measure' : 'local';
  }
}

/** NC lists contests in capitals; keep acronyms and roman numerals as they are. */
function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  const keep = new Set([
    'US',
    'NC',
    'ID',
    'II',
    'III',
    'IV',
    'VI',
    'VII',
    'VIII',
    'IX',
    'XI',
    'AT-LARGE',
  ]);
  const small = new Set(['of', 'and', 'the', 'for', 'to', 'in', 'on', 'a', 'or']);
  return s
    .toLowerCase()
    .split(' ')
    .map((w, i) => {
      if (keep.has(w.toUpperCase()))
        return w.toUpperCase() === 'AT-LARGE' ? 'At-Large' : w.toUpperCase();
      if (i > 0 && small.has(w)) return w;
      return w.replace(/(^|[-/(])([a-z])/g, (_, p: string, ch: string) => p + ch.toUpperCase());
    })
    .join(' ');
}

// ------------------------------------------------------------------ Florida

const FL_GROUPS: Record<string, ResultGroup> = {
  USS: 'federal',
  USR: 'federal',
  GOV: 'statewide',
  ATG: 'statewide',
  CFO: 'statewide',
  AGR: 'statewide',
  STS: 'legislature',
  STR: 'legislature',
  SCJ: 'judicial',
  DCA: 'judicial',
  CTJ: 'judicial',
  AMD: 'measure',
};

const FL_HEADER = [
  'ElectionDate',
  'PartyCode',
  'PartyName',
  'RaceCode',
  'RaceName',
  'CountyCode',
  'CountyName',
  'Juris1num',
  'Juris2num',
  'Precincts',
  'PrecinctsReporting',
  'CanNameLast',
  'CanNameFirst',
  'CanNameMiddle',
  'CanVotes',
];

/**
 * Florida Division of Elections: flelectionfiles.floridados.gov/enightfilespublic/
 * <yyyymmdd>_ElecResultsFL.txt, tab-separated, one row per candidate per county.
 * Statewide totals are the sum of the counties.
 */
export function parseFlDos(body: string): ParsedContest[] {
  const lines = body.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = (lines.shift() ?? '').split('\t').map((h) => h.trim());
  const col = Object.fromEntries(FL_HEADER.map((h) => [h, header.indexOf(h)]));
  const missing = FL_HEADER.filter((h) => col[h]! < 0);
  if (missing.length) throw new Error(`Florida results: missing column(s) ${missing.join(', ')}.`);

  const contests = new Map<
    string,
    ParsedContest & { byKey: Map<string, ParsedCandidate>; byArea: Map<string, ParsedArea> }
  >();
  for (const line of lines) {
    const f = line.split('\t');
    const get = (h: string) => clean(f[col[h]!]);
    const code = get('RaceCode');
    const raceName = get('RaceName');
    if (!code || !raceName) continue;
    // Amendments share a code; districts are told apart by the jurisdiction numbers.
    const id = [code, get('Juris1num'), get('Juris2num'), code === 'AMD' ? raceName : '']
      .join('|')
      .slice(0, 191);
    let c = contests.get(id);
    if (!c) {
      c = {
        sourceKey: id,
        name: raceName,
        group: FL_GROUPS[code] ?? 'local',
        voteFor: 1,
        precinctsTotal: 0,
        precinctsReporting: 0,
        candidates: [],
        areas: [],
        byKey: new Map(),
        byArea: new Map(),
      };
      contests.set(id, c);
    }
    const name = [get('CanNameFirst'), get('CanNameMiddle'), get('CanNameLast')]
      .filter(Boolean)
      .join(' ');
    const party = get('PartyCode') || null;
    // "Yes"/"No" on measures and retention questions carry no party.
    const shownParty = party === 'NOP' ? null : party;
    const key = candidateKey(name, shownParty);
    const votes = int(get('CanVotes'));
    let cand = c.byKey.get(key);
    if (!cand) {
      cand = { key, name, party: shownParty, votes: 0 };
      c.byKey.set(key, cand);
      c.candidates.push(cand);
    }
    cand.votes += votes;

    const areaCode = get('CountyCode');
    let area = c.byArea.get(areaCode);
    if (!area) {
      area = {
        code: areaCode,
        name: get('CountyName'),
        precinctsTotal: int(get('Precincts')),
        precinctsReporting: int(get('PrecinctsReporting')),
        votes: {},
      };
      c.byArea.set(areaCode, area);
      c.areas.push(area);
      c.precinctsTotal! += area.precinctsTotal!;
      c.precinctsReporting! += area.precinctsReporting!;
    }
    area.votes[key] = (area.votes[key] ?? 0) + votes;
  }
  return sortContests(
    [...contests.values()].map(({ byKey: _k, byArea: _a, ...c }) => ({
      ...c,
      areas: c.areas.sort((a, b) => a.name.localeCompare(b.name)),
    })),
  );
}

export const PARSERS = { ncsbe: parseNcsbe, 'fl-dos': parseFlDos } as const;
export type FeedKind = keyof typeof PARSERS;
