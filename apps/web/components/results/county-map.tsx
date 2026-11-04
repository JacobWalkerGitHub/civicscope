import { reportingShare } from '@civicscope/cms';
import { COUNTY_MAPS } from './geo';
import { LEGEND, reportingBucket } from './format';

interface Area {
  name: string;
  precinctsTotal: number | null;
  precinctsReporting: number | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/** A state's counties shaded by how much of each county's count is in. */
export function CountyMap({ state, areas }: { state: string; areas: Area[] }) {
  const map = COUNTY_MAPS[state];
  if (!map) return null;
  const byName = new Map(areas.map((a) => [norm(a.name), a]));
  return (
    <figure className="county-map">
      <svg
        viewBox={map.viewBox}
        role="img"
        aria-label="Map of counties by share of precincts reporting"
      >
        {map.areas.map((shape) => {
          const a = byName.get(norm(shape.name));
          const share = a ? reportingShare(a) : null;
          const bucket = a ? reportingBucket(share ?? 0) : 'none';
          return (
            <path key={shape.fips} d={shape.d} className={`map-state map-${bucket}`}>
              <title>
                {a
                  ? `${shape.name}: ${share === null ? 'no precinct count' : `${Math.round(share * 100)}% reporting`}`
                  : `${shape.name}: not in this contest`}
              </title>
            </path>
          );
        })}
      </svg>
      <figcaption>
        <ul className="map-legend">
          {LEGEND.filter((l) => l.bucket !== 'none').map((l) => (
            <li key={l.bucket}>
              <span className={`swatch map-${l.bucket}`} aria-hidden="true" />
              {l.label}
            </li>
          ))}
          <li>
            <span className="swatch map-none" aria-hidden="true" />
            Not in this contest
          </li>
        </ul>
      </figcaption>
    </figure>
  );
}
