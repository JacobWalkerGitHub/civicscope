import Link from 'next/link';
import { partyTone } from '@/lib/party';
import { PartyViewToggle } from './party-view';

/**
 * The row above a people list: how to arrange it (everyone in one list, or under
 * each state) and the party labels switch.
 */
export function ViewBar({
  view,
  listHref,
  stateHref,
  listLabel = 'All',
  partyOn,
}: {
  view?: 'list' | 'state';
  listHref?: string;
  stateHref?: string;
  listLabel?: string;
  partyOn: boolean;
}) {
  return (
    <div className="view-bar">
      {listHref && stateHref ? (
        <nav className="segmented" aria-label="Arrange the list">
          <Link href={listHref} aria-current={view === 'list' ? 'page' : undefined}>
            {listLabel}
          </Link>
          <Link href={stateHref} aria-current={view === 'state' ? 'page' : undefined}>
            By state
          </Link>
        </nav>
      ) : (
        <span />
      )}
      <PartyViewToggle on={partyOn} />
    </div>
  );
}

/** A party name chip, colored by party. Only rendered when party labels are on. */
export function PartyChip({ name }: { name: string }) {
  return <span className={`chip party-chip party-${partyTone(name)}`}>{name}</span>;
}
