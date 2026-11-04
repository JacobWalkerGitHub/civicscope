import type { Metadata } from 'next';
import Link from 'next/link';
import { checkConfirmLink } from '@civicscope/cms';
import { getDb } from '@/lib/db';
import { confirmFollowAction } from '../actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Confirm email updates · CivicScope',
  robots: { index: false },
};

type Search = Promise<{ f?: string; t?: string }>;

/*
 * The link in a confirmation email opens this page; the follow starts only when the
 * reader presses the button. Mail scanners that open every link can't confirm a
 * follow for someone.
 */
export default async function ConfirmPage({ searchParams }: { searchParams: Search }) {
  const { f = '', t = '' } = await searchParams;
  const check = await checkConfirmLink(getDb(), Number(f), t);
  return (
    <article className="prose alerts-page">
      {check.state === 'ok' && check.follow.confirmedAt ? (
        <>
          <h1>You’re following this</h1>
          <p>
            We’ll email <strong>{check.follow.email}</strong> when there’s something new about{' '}
            <Link href={check.path}>{check.follow.targetLabel}</Link>, at most once a day. Every
            email has a link to stop.
          </p>
          <p>
            <Link className="button" href={check.path}>
              Back to the page
            </Link>
          </p>
        </>
      ) : check.state === 'ok' ? (
        <>
          <h1>Confirm email updates</h1>
          <p>
            Send <strong>{check.follow.email}</strong> an email when there’s something new about{' '}
            <Link href={check.path}>{check.follow.targetLabel}</Link>?
          </p>
          <form action={confirmFollowAction}>
            <input type="hidden" name="f" value={f} />
            <input type="hidden" name="t" value={t} />
            <button type="submit">Yes, send me updates</button>
          </form>
          <p className="small muted">
            At most one email a day, only when something is added. We use your address for nothing
            else and never share it.
          </p>
        </>
      ) : (
        <>
          <h1>{check.state === 'expired' ? 'This link has expired' : 'This link doesn’t work'}</h1>
          <p>
            {check.state === 'expired'
              ? 'Confirmation links work for 7 days.'
              : 'It may have been replaced by a newer email, or copied only in part.'}{' '}
            To try again, open the politician or bill and choose <em>Get email updates</em>.
          </p>
        </>
      )}
    </article>
  );
}
