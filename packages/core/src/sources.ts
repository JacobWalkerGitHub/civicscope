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

/**
 * A long link shortened for display: the site, then as much of the path as fits, with
 * the middle left out, e.g. "elect.ky.gov/…/2027-candidates.pdf". The link itself keeps
 * the full address; this only keeps long URLs from stretching a page (above all on phones).
 */
export function shortUrl(url: string, max = 40): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return url.length > max ? `${url.slice(0, max - 1)}…` : url;
  }
  const host = u.hostname.replace(/^www\./, '');
  const segments = u.pathname.split('/').filter(Boolean).map(safeDecode);
  const extra = u.search || u.hash ? '…' : '';
  const room = Math.max(max - host.length, 12);
  let path = segments.length ? `/${segments.join('/')}` : '';
  if (path.length + extra.length > room && segments.length > 1) {
    path = `/…/${segments[segments.length - 1]}`;
  }
  path += extra && !path ? '/…' : extra;
  if (path.length > room) path = `${path.slice(0, room - 1)}…`;
  return host + path;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** True when a label is really just a web address (editors often paste the URL as the title). */
export function looksLikeUrl(text: string): boolean {
  return /^(https?:\/\/|www\.)\S+$/i.test(text.trim());
}

/** The text to show for a link: its title, unless there is none or it is itself a URL. */
export function linkLabel(url: string, title?: string | null, max?: number): string {
  return title && !looksLikeUrl(title) ? title : shortUrl(url, max);
}
