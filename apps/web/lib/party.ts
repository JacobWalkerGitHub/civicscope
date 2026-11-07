/** The cookie that remembers a visitor turned party labels on. Shared by server and client. */
export const PARTY_VIEW_COOKIE = 'cs_party_view';

export type PartyTone = 'dem' | 'rep' | 'ind' | 'lib' | 'grn' | 'other';

/**
 * The color family for a party name, used only when a visitor turns party labels on.
 * Matched by name, since parties have no color in the database.
 */
export function partyTone(name: string | null | undefined): PartyTone {
  const n = (name ?? '').toLowerCase();
  if (n.includes('democrat')) return 'dem';
  if (n.includes('republican')) return 'rep';
  if (n.includes('libertarian')) return 'lib';
  if (/\bgreen\b/.test(n)) return 'grn';
  if (n.includes('independent') || n.includes('no party') || n.includes('nonpartisan'))
    return 'ind';
  return 'other';
}
