import type { Metadata } from 'next';
import QRCode from 'qrcode';
import { pendingTwoStepSecret, twoStepRequired, twoStepStatus } from '@civicscope/auth';
import { AuthForm } from '@/components/admin/auth-form';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import {
  changePasswordAction,
  confirmTwoStepAction,
  regenerateCodesAction,
  startTwoStepAction,
} from './actions';

export const metadata: Metadata = { title: 'Your account · CivicScope admin' };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string; recovery?: string }>;
}) {
  const user = await requirePermission('admin:view', { allowWithoutTwoStep: true });
  const params = await searchParams;
  const db = getDb();
  const status = await twoStepStatus(db, user.id);
  const pending = status.enabled ? null : await pendingTwoStepSecret(db, user.id);
  const qr = pending ? await QRCode.toString(pending.url, { type: 'svg', margin: 1 }) : null;
  const required = twoStepRequired(user.role);

  return (
    <>
      <h1>Your account</h1>
      <p>
        {user.name} · {user.email} · <span className="role">{user.role}</span>
      </p>

      {params.setup === 'required' && !status.enabled && (
        <p className="alert" role="alert">
          Your role can publish content, so two-step sign-in is required. Set it up below to
          continue.
        </p>
      )}
      {params.recovery === 'used' && (
        <p className="notice">
          You signed in with a recovery code. You have {status.recoveryCodesLeft} left; replace them
          below if you&apos;re running low.
        </p>
      )}

      <section aria-labelledby="two-step-heading">
        <h2 id="two-step-heading">Two-step sign-in</h2>
        {status.enabled ? (
          <>
            <p>
              <strong>On.</strong> You sign in with your password and a code from your authenticator
              app. {status.recoveryCodesLeft} recovery codes left.
            </p>
            <details className="add-form">
              <summary>Replace recovery codes</summary>
              <AuthForm action={regenerateCodesAction} submitLabel="Replace codes">
                <label>
                  Current code from your app
                  <input name="code" autoComplete="one-time-code" inputMode="numeric" required />
                </label>
              </AuthForm>
            </details>
          </>
        ) : pending ? (
          <>
            <ol>
              <li>
                Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password
                and others work) and scan this code, or type the key below.
              </li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            <div className="qr" dangerouslySetInnerHTML={{ __html: qr! }} />
            <p>
              Key: <code aria-label="Setup key">{pending.secret}</code>
            </p>
            <AuthForm action={confirmTwoStepAction} submitLabel="Turn on two-step sign-in">
              <label>
                Code from your app
                <input name="code" autoComplete="one-time-code" inputMode="numeric" required />
              </label>
            </AuthForm>
          </>
        ) : (
          <>
            <p>
              <strong>Off.</strong> Add a second step to sign-in: a code from an app on your phone,
              so a stolen password alone isn&apos;t enough.
              {required ? ' Required for your role.' : ''}
            </p>
            <AuthForm action={startTwoStepAction} submitLabel="Set up two-step sign-in" />
          </>
        )}
      </section>

      <section aria-labelledby="password-heading">
        <h2 id="password-heading">Change password</h2>
        <AuthForm
          action={changePasswordAction}
          submitLabel="Change password"
          savedMessage="Password changed. Your other sessions were signed out."
        >
          <label>
            Current password
            <input name="current" type="password" autoComplete="current-password" required />
          </label>
          <label>
            New password (at least 12 characters)
            <input name="next" type="password" autoComplete="new-password" required />
          </label>
          <label>
            New password again
            <input name="confirm" type="password" autoComplete="new-password" required />
          </label>
        </AuthForm>
      </section>
    </>
  );
}
