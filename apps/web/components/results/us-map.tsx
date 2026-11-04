import Link from 'next/link';
import { reportingShare, type ResultStateSummary } from '@civicscope/cms';
import { US_STATES, US_VIEWBOX } from './geo';
import { LEGEND, reportingBucket } from './format';

/**
 * The country, each state shaded by how much of its count is in (never by who leads).
 * States with an official results feed are links to their results.
 */
export function UsResultsMap({ states }: { states: ResultStateSummary[] }) {
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
          const bucket = reportingBucket(share ?? 0);
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
              <path d={shape.d} className={`map-state map-${bucket}`}>
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
          {LEGEND.map((l) => (
            <li key={l.bucket}>
              <span className={`swatch map-${l.bucket}`} aria-hidden="true" />
              {l.label}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
