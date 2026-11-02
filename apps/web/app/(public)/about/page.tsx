import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'About · CivicScope',
  description: 'What CivicScope is, the rules it follows, and how to reach us about a mistake.',
};

export default function AboutPage() {
  return (
    <article className="prose">
      <h1>About CivicScope</h1>
      <p>
        CivicScope helps voters research the candidates on their ballot. For each candidate we
        collect what the public record shows and what the candidate says, with a link to the source
        for every fact, so you can check it yourself.
      </p>

      <h2>Our commitments</h2>
      <ul>
        <li>We do not endorse, rate or rank candidates, and we do not tell anyone how to vote.</li>
        <li>Every published fact links to its source.</li>
        <li>Every candidate in a race gets the same layout, and lists are alphabetical.</li>
        <li>A candidate’s own claims are labeled as theirs, not presented as fact.</li>
        <li>We say plainly what we do not cover yet, and we correct mistakes in public.</li>
      </ul>
      <p>
        The details are on our <Link href="/methodology">methodology</Link> page.
      </p>

      <h2>Who runs it and how it is funded</h2>
      <p>
        CivicScope is in development and has not launched yet. Before launch we will publish here
        who runs it and every source of its funding.
      </p>

      <h2>Found a mistake?</h2>
      <p>
        Please <Link href="/corrections">send us a correction</Link>. You don’t need an account, and
        an email address is optional.
      </p>
    </article>
  );
}
