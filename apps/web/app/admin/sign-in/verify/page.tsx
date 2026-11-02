import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, takeChallengeCookie } from '@/lib/session';
import { VerifyForm } from './verify-form';

export const metadata: Metadata = { title: 'Enter your code · CivicScope admin' };

export default async function VerifyPage() {
  if (await getCurrentUser()) redirect('/admin');
  if (!(await takeChallengeCookie())) redirect('/admin/sign-in');
  return (
    <main className="narrow">
      <h1>Enter your code</h1>
      <p className="muted">
        Open your authenticator app and enter the 6-digit code for CivicScope. Lost your phone?
        Enter one of your recovery codes instead.
      </p>
      <VerifyForm />
      <p>
        <Link href="/admin/sign-in">Start over</Link>
      </p>
    </main>
  );
}
