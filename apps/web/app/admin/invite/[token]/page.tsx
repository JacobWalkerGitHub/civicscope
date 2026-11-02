import type { Metadata } from 'next';
import Link from 'next/link';
import { findInvite } from '@civicscope/auth';
import { getDb } from '@/lib/db';
import { AcceptInviteForm } from './accept-form';

export const metadata: Metadata = { title: 'Accept invitation · CivicScope admin' };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await findInvite(getDb(), token);
  if (!invite) {
    return (
      <main className="narrow">
        <h1>Invitation not valid</h1>
        <p>
          This invitation has expired, was revoked or was already used. Ask the person who invited
          you for a new link.
        </p>
        <p>
          <Link href="/admin/sign-in">Go to sign-in</Link>
        </p>
      </main>
    );
  }
  return (
    <main className="narrow">
      <h1>Join CivicScope admin</h1>
      <p className="muted">
        You&apos;re invited as <strong>{invite.role}</strong> with the email{' '}
        <strong>{invite.email}</strong>. Choose your name and a password.
      </p>
      <AcceptInviteForm token={token} />
    </main>
  );
}
