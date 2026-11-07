import 'server-only';
import { cookies } from 'next/headers';
import { PARTY_VIEW_COOKIE } from './party';

/**
 * Whether this visitor has turned on party labels. Off unless they chose it: with
 * it off, lists show no party names, party colors or party filters at all.
 */
export async function partyViewOn(): Promise<boolean> {
  return (await cookies()).get(PARTY_VIEW_COOKIE)?.value === '1';
}
