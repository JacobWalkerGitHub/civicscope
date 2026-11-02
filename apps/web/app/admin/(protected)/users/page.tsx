import type { Metadata } from 'next';
import { listPendingInvites, listUsers } from '@civicscope/auth';
import { ROLE_DESCRIPTIONS, USER_ROLES } from '@civicscope/core';
import { AuthForm } from '@/components/admin/auth-form';
import { getDb } from '@/lib/db';
import { dateTime } from '@/lib/labels';
import { requirePermission } from '@/lib/session';
import {
  changeRoleAction,
  inviteAction,
  resetTwoStepAction,
  revokeInviteAction,
  setDisabledAction,
} from './actions';

export const metadata: Metadata = { title: 'Users · CivicScope admin' };

function RoleSelect({ defaultValue }: { defaultValue?: string }) {
  return (
    <select name="role" defaultValue={defaultValue ?? ''} aria-label="Role" required>
      {!defaultValue && <option value="">Choose a role…</option>}
      {USER_ROLES.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </select>
  );
}

export default async function UsersPage() {
  const me = await requirePermission('users:manage');
  const db = getDb();
  const [users, invites] = await Promise.all([listUsers(db), listPendingInvites(db)]);

  return (
    <>
      <h1>Users</h1>
      <dl className="muted">
        {USER_ROLES.map((r) => (
          <div key={r}>
            <dt>
              <strong>{r}</strong>
            </dt>
            <dd>{ROLE_DESCRIPTIONS[r]}</dd>
          </div>
        ))}
      </dl>

      <table>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
            <th scope="col">Two-step</th>
            <th scope="col">Last sign-in</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const self = u.id === me.id;
            return (
              <tr key={u.id}>
                <td>
                  {u.name}
                  {self && <span className="muted"> (you)</span>}
                </td>
                <td>{u.email}</td>
                <td>
                  {self ? (
                    u.role
                  ) : (
                    <AuthForm
                      action={changeRoleAction.bind(null, u.id)}
                      submitLabel="Change"
                      variant="secondary"
                      className="inline-form"
                    >
                      <RoleSelect defaultValue={u.role} />
                    </AuthForm>
                  )}
                </td>
                <td>
                  {u.totpEnabledAt ? 'On' : 'Off'}
                  {!self && u.totpEnabledAt && (
                    <AuthForm
                      action={resetTwoStepAction.bind(null, u.id)}
                      submitLabel="Reset"
                      variant="secondary"
                      className="inline-form"
                    />
                  )}
                </td>
                <td>{u.lastSignInAt ? dateTime.format(u.lastSignInAt) : 'Never'}</td>
                <td>
                  {u.disabledAt ? 'Disabled' : 'Active'}
                  {!self && (
                    <AuthForm
                      action={setDisabledAction.bind(null, u.id, !u.disabledAt)}
                      submitLabel={u.disabledAt ? 'Enable' : 'Disable'}
                      variant={u.disabledAt ? 'secondary' : 'danger'}
                      className="inline-form"
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <section aria-labelledby="invite-heading">
        <h2 id="invite-heading">Invite someone</h2>
        <p className="muted">
          You&apos;ll get a one-time link to send them. They choose their own name and password.
        </p>
        <AuthForm action={inviteAction} submitLabel="Create invitation link">
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Role
            <RoleSelect />
          </label>
        </AuthForm>
        {invites.length > 0 && (
          <>
            <h3>Pending invitations</h3>
            <table>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Invited by</th>
                  <th scope="col">Expires</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id}>
                    <td>{i.email}</td>
                    <td>{i.role}</td>
                    <td>{i.invitedByName ?? '—'}</td>
                    <td>{dateTime.format(i.expiresAt)}</td>
                    <td>
                      <AuthForm
                        action={revokeInviteAction.bind(null, i.id)}
                        submitLabel="Revoke"
                        variant="secondary"
                        className="inline-form"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </>
  );
}
