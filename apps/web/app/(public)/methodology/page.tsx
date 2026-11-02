import type { Metadata } from 'next';
import Link from 'next/link';
import {
  CANDIDACY_STATUSES,
  CONTENT_KINDS,
  SOURCE_TYPES,
  sourceTier,
  VERIFICATION_STATUSES,
} from '@civicscope/core';
import {
  CANDIDACY_STATUS_LABELS,
  CONTENT_KIND_LABELS,
  SOURCE_TYPE_LABELS,
  TIER_LABELS,
  VERIFICATION_LABELS,
} from '@/lib/labels';

export const metadata: Metadata = {
  title: 'Methodology · CivicScope',
  description: 'How CivicScope decides what to publish, ranks sources and keeps entries current.',
};

const CONTENT_KIND_HELP: Record<(typeof CONTENT_KINDS)[number], string> = {
  sourced_fact: 'Something a record shows, such as a filing, a vote or a court document.',
  candidate_claim:
    'What the candidate or campaign says about themselves. We report that they said it; we do not present it as established fact.',
  independent_analysis: 'A finding from an independent, named organization, attributed to it.',
  editorial_summary: 'A neutral summary in our words of entries that are each sourced.',
};

const VERIFICATION_HELP: Record<(typeof VERIFICATION_STATUSES)[number], string> = {
  unverified: 'Drafted but not checked. Never shown publicly.',
  pending_review: 'Waiting for a reviewer. Never shown publicly.',
  verified: 'A reviewer checked it against its sources.',
  disputed: 'Sources disagree. We show what each one says.',
  outdated: 'It was accurate when checked, but newer information may exist.',
};

const STATUS_HELP: Record<(typeof CANDIDACY_STATUSES)[number], string> = {
  announced: 'Has said publicly they are running, but has not filed.',
  registered:
    'Has registered as a federal candidate with the Federal Election Commission, which is required once a campaign raises or spends more than $5,000. This is about campaign finance only. It does not mean they are on any ballot.',
  filed: 'Has filed with the election authority.',
  qualified: 'The election authority has certified them for the ballot.',
  withdrawn: 'Has left the race.',
  disqualified: 'The election authority or a court removed them from the ballot.',
  advanced: 'Moved on to a later round, such as a runoff or general election.',
  won: 'Won, according to certified results.',
  lost: 'Did not win, according to certified results.',
};

export default function MethodologyPage() {
  const tiers = [1, 2, 3, 4] as const;
  return (
    <article className="prose">
      <h1>How we work</h1>
      <p>
        CivicScope is a nonpartisan guide to candidates. It does not endorse anyone, rate anyone or
        tell you how to vote. This page explains how we decide what to publish.
      </p>

      <h2>No source, no publication</h2>
      <p>
        Every fact on a candidate or race page links to at least one source. Our publishing system
        will not publish a fact that has no citation. Each source shows its title, publisher, type
        and the date we last checked it.
      </p>

      <h2>Which sources we trust most</h2>
      <p>
        When sources disagree, we prefer the higher tier and say that they disagree. A lower tier
        source is still useful, for example for what a candidate says about their own views.
      </p>
      <dl className="definitions">
        {tiers.map((tier) => (
          <div key={tier}>
            <dt>{TIER_LABELS[tier]}</dt>
            <dd>
              {SOURCE_TYPES.filter((t) => sourceTier(t) === tier)
                .map((t) => SOURCE_TYPE_LABELS[t])
                .join(', ')}
            </dd>
          </div>
        ))}
      </dl>

      <h2>Whose account it is</h2>
      <p>
        Every entry says what kind of information it is, so you know whose account you are reading.
      </p>
      <dl className="definitions">
        {CONTENT_KINDS.map((k) => (
          <div key={k}>
            <dt>{CONTENT_KIND_LABELS[k]}</dt>
            <dd>{CONTENT_KIND_HELP[k]}</dd>
          </div>
        ))}
      </dl>

      <h2>Review before publishing</h2>
      <p>
        Positions, biography entries and accomplishments are written as neutral summaries, then
        checked against their sources by a reviewer who did not write them. An edit to a published
        entry takes it off the site until it is reviewed again.
      </p>
      <dl className="definitions">
        {VERIFICATION_STATUSES.map((v) => (
          <div key={v}>
            <dt>{VERIFICATION_LABELS[v]}</dt>
            <dd>{VERIFICATION_HELP[v]}</dd>
          </div>
        ))}
      </dl>

      <h2>Candidate status</h2>
      <p>
        A candidate’s status comes from the election authority where possible, and each change is
        dated and sourced.
      </p>
      <dl className="definitions">
        {CANDIDACY_STATUSES.map((s) => (
          <div key={s}>
            <dt>{CANDIDACY_STATUS_LABELS[s]}</dt>
            <dd>{STATUS_HELP[s]}</dd>
          </div>
        ))}
      </dl>

      <h2>Equal treatment</h2>
      <ul>
        <li>Candidates are always listed alphabetically by last name.</li>
        <li>Every profile uses the same layout and section order.</li>
        <li>
          Photos are shown the same way for everyone, with a credit and a link to where the photo
          came from. A missing photo means we have not added one, nothing more.
        </li>
        <li>
          When we have no sourced information on a topic, we say so. Silence is never shown as a
          position.
        </li>
      </ul>

      <h2>Automation and AI</h2>
      <p>
        We do not publish text written by AI. Data imported from official sources goes through the
        same rules as hand-entered data. When an editor corrects a candidate’s details by hand, a
        later import cannot overwrite that correction. If we ever add AI-assisted summaries, they
        will be labeled, linked to the entries they summarize and reviewed by a person before
        publishing.
      </p>

      <h2>Mistakes</h2>
      <p>
        If something is wrong, please <Link href="/corrections">tell us</Link>. Meaningful fixes are
        listed in our public corrections log with the date. What we cover, and what we do not yet
        cover, is on the <Link href="/coverage">Coverage</Link> page.
      </p>
    </article>
  );
}
