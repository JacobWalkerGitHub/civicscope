import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in · CivicScope admin' };

export default async function SignInPage() {
  if (await getCurrentUser()) redirect('/admin');
  return (
    <main className="narrow">
      <h1>CivicScope admin</h1>
      <p className="muted">Sign in to manage candidates, races and sources.</p>
      <SignInForm />
    </main>
  );
}
