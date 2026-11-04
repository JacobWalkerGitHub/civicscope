'use client';

import { useState } from 'react';
import { LEAD_LEGEND, fmt, leaderClass, pct } from './format';

interface Candidate {
  key: string;
  name: string;
  party: string | null;
}
interface Area {
  code: string;
  name: string;
  precinctsTotal: number | null;
  precinctsReporting: number | null;
  votes: Record<string, number>;
}
interface Shape {
  fips: string;
  name: string;
  d: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/**
 * A state's counties colored by who leads in one contest. Select a county (click, tap or
 * Enter) to see its numbers beside the map.
 */
export function CountyExplorer({
  viewBox,
  shapes,
  areas,
  candidates,
}: {
  viewBox: string;
  shapes: Shape[];
  areas: Area[];
  candidates: Candidate[];
}) {
  const byName = new Map(areas.map((a) => [norm(a.name), a]));
  const [selected, setSelected] = useState<string | null>(null);
  const area = selected ? byName.get(selected) : undefined;
  const total = area ? Object.values(area.votes).reduce((n, v) => n + v, 0) : 0;
  const ranked = area
    ? [...candidates].sort((a, b) => (area.votes[b.key] ?? 0) - (area.votes[a.key] ?? 0))
    : [];

  return (
    <div className="county-explorer">
      <figure className="county-map">
        <svg viewBox={viewBox} role="group" aria-label="Counties, colored by who leads">
          {shapes.map((s) => {
            const a = byName.get(norm(s.name));
            const cls = a ? leaderClass(a.votes, candidates) : 'lead-out';
            const key = norm(s.name);
            return (
              <path
                key={s.fips}
                d={s.d}
                className={`map-county ${cls}${selected === key ? ' is-selected' : ''}`}
                tabIndex={a ? 0 : -1}
                role={a ? 'button' : undefined}
                aria-label={a ? `${s.name} County` : undefined}
                aria-pressed={a ? selected === key : undefined}
                onClick={() => a && setSelected(key)}
                onKeyDown={(e) => {
                  if (a && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    setSelected(key);
                  }
                }}
              >
                <title>{s.name}</title>
              </path>
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
          </ul>
          <p className="muted map-note">Darker shades mean a wider lead.</p>
        </figcaption>
      </figure>
      <aside className="county-card" aria-live="polite">
        {!area ? (
          <p className="muted">Select a county on the map to see its results.</p>
        ) : (
          <>
            <h3>{area.name} County</h3>
            <p className="muted">
              {fmt(area.precinctsReporting ?? 0)} of {fmt(area.precinctsTotal ?? 0)} precincts
              reporting
            </p>
            <table className="contest-table">
              <tbody>
                {ranked.map((c) => (
                  <tr key={c.key}>
                    <th scope="row">
                      {c.name}
                      {c.party && <span className="cand-party">{c.party}</span>}
                    </th>
                    <td className="num">{fmt(area.votes[c.key] ?? 0)}</td>
                    <td className="num">{pct(area.votes[c.key] ?? 0, total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </aside>
    </div>
  );
}
