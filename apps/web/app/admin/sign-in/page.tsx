import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in · CivicScope admin' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string; welcome?: string }>;
}) {
  if (await getCurrentUser()) redirect('/admin');
  const params = await searchParams;
  return (
    <main className="narrow">
      <h1>CivicScope admin</h1>
      <p className="muted">Sign in to manage candidates, races and sources.</p>
      {params.expired && (
        <p className="notice">That sign-in took too long or had too many tries. Start again.</p>
      )}
      {params.welcome && (
        <p className="notice" role="status">
          Your account is ready. Sign in with your email and new password.
        </p>
      )}
      <SignInForm />
    </main>
  );
}
