import type { Metadata } from 'next';
import Link from 'next/link';
import { checkUnsubscribeLink } from '@civicscope/cms';
import { getDb } from '@/lib/db';
import { unsubscribeAction } from '../actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Unsubscribe · CivicScope',
  robots: { index: false },
};

type Search = Promise<{ f?: string; e?: string; t?: string; done?: string }>;

/*
 * The links in alert emails open this page. Unsubscribing takes one press of a
 * button, so a mail scanner that opens every link can't unsubscribe anyone.
 */
export default async function UnsubscribePage({ searchParams }: { searchParams: Search }) {
  const { f = '', e = '', t = '', done } = await searchParams;
  if (done) {
    return (
      <article className="prose alerts-page">
        <h1>{done === 'gone' ? 'Already unsubscribed' : 'You’re unsubscribed'}</h1>
        <p>
          {done === 'all'
            ? 'We won’t send any more CivicScope emails to that address, and we’ve deleted it.'
            : done === 'gone'
              ? 'There’s nothing left to stop for this link.'
              : 'We won’t email you about that any more.'}
        </p>
        <p>
          <Link href="/">Go to CivicScope</Link>
        </p>
      </article>
    );
  }
  const check = await checkUnsubscribeLink(getDb(), { f, e, t });
  if (check.state === 'invalid') {
    return (
      <article className="prose alerts-page">
        <h1>Already unsubscribed</h1>
        <p>This link isn’t active: what it was for has already been stopped.</p>
      </article>
    );
  }
  return (
    <article className="prose alerts-page">
      <h1>{check.state === 'all' ? 'Stop all CivicScope emails' : 'Stop these emails'}</h1>
      <p>
        {check.state === 'all' ? (
          <>
            Stop every CivicScope email to <strong>{check.email}</strong> and delete the address?
          </>
        ) : (
          <>
            Stop emails to <strong>{check.email}</strong> about{' '}
            <Link href={check.path}>{check.follow.targetLabel}</Link>?
          </>
        )}
      </p>
      <form action={unsubscribeAction} className="alerts-buttons">
        <input type="hidden" name="f" value={f} />
        <input type="hidden" name="e" value={e} />
        <input type="hidden" name="t" value={t} />
        <button type="submit" name="all" value="0">
          Unsubscribe
        </button>
        {check.state === 'one' && (
          <button type="submit" name="all" value="1" className="button button-secondary">
            Stop all CivicScope emails
          </button>
        )}
      </form>
    </article>
  );
}
