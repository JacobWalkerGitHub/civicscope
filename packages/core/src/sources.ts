import type { SourceType } from './enums';

/**
 * Reliability tier of a source type, 1 being strongest.
 * 1: official records (election authorities, government, legislatures, courts)
 * 2: independent news reporting
 * 3: the candidate's own materials and general reference works
 * 4: anything else
 */
export function sourceTier(type: SourceType): 1 | 2 | 3 | 4 {
  switch (type) {
    case 'official_election_authority':
    case 'government_record':
    case 'legislative_record':
    case 'court_record':
      return 1;
    case 'news':
      return 2;
    case 'campaign_site':
    case 'reference':
      return 3;
    default:
      return 4;
  }
}

/**
 * Canonical form of a source URL, so the same document is stored once:
 * lowercased host, no fragment, no default port, no trailing slash on the path root.
 * Query strings are kept because many official pages use them to pick a record.
 */
export function normalizeSourceUrl(raw: string): string {
  const url = new URL(raw.trim());
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

/** "Jane Q. Public" -> "Public, Jane Q." for alphabetical lists. Suffixes stay with the surname. */
export function defaultSortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName.trim();
  const suffixes = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
  let end = parts.length - 1;
  if (suffixes.test(parts[end]!.replace(/,$/, '')) && end > 1) end -= 1;
  const surname = parts.slice(end).join(' ').replace(/,/g, '');
  const given = parts.slice(0, end).join(' ').replace(/,$/, '');
  return `${surname}, ${given}`;
}
