import Link from 'next/link';

export interface Step {
  label: string;
  hint?: string;
  href?: string;
  state: 'done' | 'current' | 'todo';
}

/** Where this record is in the "election → races → candidates → publish" flow. */
export function Steps({ steps, label = 'Progress' }: { steps: Step[]; label?: string }) {
  return (
    <ol className="admin-steps" aria-label={label}>
      {steps.map((s, i) => (
        <li
          key={s.label}
          className={`step-${s.state}`}
          aria-current={s.state === 'current' ? 'step' : undefined}
        >
          <span className="admin-step-num" aria-hidden="true">
            {s.state === 'done' ? '✓' : i + 1}
          </span>
          <span className="admin-step-text">
            {s.href ? <Link href={s.href}>{s.label}</Link> : <strong>{s.label}</strong>}
            {s.hint && <span className="admin-step-hint">{s.hint}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The flow for an election, worked out from what it already has. */
export function electionSteps(e: {
  electionId?: number;
  raceId?: number;
  races: number;
  candidates: number;
  published: boolean;
  at: 'election' | 'races' | 'candidates';
}): Step[] {
  const state = (done: boolean, here: boolean): Step['state'] =>
    here ? 'current' : done ? 'done' : 'todo';
  return [
    {
      label: 'Election',
      hint: 'Date, state and type',
      href: e.electionId && e.at !== 'election' ? `/admin/elections/${e.electionId}` : undefined,
      state: state(e.electionId != null, e.at === 'election' && e.electionId == null),
    },
    {
      label: 'Races',
      hint: e.races ? `${e.races} added` : 'Offices on the ballot',
      href:
        e.electionId && e.at === 'candidates'
          ? `/admin/elections/${e.electionId}#races`
          : undefined,
      state: state(e.races > 0, e.at === 'races' || (e.at === 'election' && e.electionId != null)),
    },
    {
      label: 'Candidates',
      hint: e.candidates ? `${e.candidates} added` : 'Who is running',
      state: state(e.candidates > 0, e.at === 'candidates'),
    },
    {
      label: 'Sources & publish',
      hint: e.published ? 'Live on the site' : 'Cite, then publish',
      state: e.published ? 'done' : 'todo',
    },
  ];
}
