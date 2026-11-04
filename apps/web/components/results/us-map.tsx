import Link from 'next/link';
import { reportingShare, type ResultStateSummary } from '@civicscope/cms';
import { US_STATES, US_VIEWBOX } from './geo';
import { LEAD_LEGEND } from './format';

/**
 * The country, each state with a results feed colored by who leads its top race, and a
 * link to its results. States without a feed stay plain.
 */
export function UsResultsMap({
  states,
  leads,
}: {
  states: ResultStateSummary[];
  /** Map class per state, from leaderClass(). */
  leads: Record<string, string>;
}) {
  const byState = new Map(states.map((s) => [s.state, s]));
  return (
    <figure className="us-map">
      <svg viewBox={US_VIEWBOX} role="group" aria-label="Map of states with live results">
        {US_STATES.map((shape) => {
          const s = byState.get(shape.usps);
          if (!s) {
            return (
              <path key={shape.usps} d={shape.d} className="map-state map-none">
                <title>{`${shape.name}: no official results feed connected`}</title>
              </path>
            );
          }
          const share = s.headline ? reportingShare(s.headline) : null;
          const cls = leads[shape.usps] ?? 'lead-none';
          const label =
            share === null
              ? `${shape.name}: results`
              : `${shape.name}: ${Math.round(share * 100)}% of precincts reporting`;
          return (
            <Link
              key={shape.usps}
              href={`/results/${shape.usps.toLowerCase()}`}
              aria-label={label}
              className="map-link"
            >
              <path d={shape.d} className={`map-state ${cls}`}>
                <title>{label}</title>
              </path>
              <text x={shape.cx} y={shape.cy} className="map-label" aria-hidden="true">
                {shape.usps}
              </text>
            </Link>
          );
        })}
      </svg>
      <figcaption>
        <ul className="map-legend">
          {LEAD_LEGEND.map((l) => (
            <li key={l.cls}>
              <span className={`swatch ${l.cls}`} aria-hidden="true" />
              {l.label}
            </li>
          ))}
          <li>
            <span className="swatch map-none" aria-hidden="true" />
            No official feed yet
          </li>
        </ul>
      </figcaption>
    </figure>
  );
}
