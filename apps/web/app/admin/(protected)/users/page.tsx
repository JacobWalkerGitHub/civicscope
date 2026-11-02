import type { Metadata } from 'next';
import { listUsers } from '@civicscope/auth';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Users · CivicScope admin' };

const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

export default async function UsersPage() {
  await requirePermission('users:manage');
  const users = await listUsers(getDb());
  return (
    <>
      <h1>Users</h1>
      <table>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
            <th scope="col">Last sign-in</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>{u.role}</td>
              <td>{u.lastSignInAt ? dateFormat.format(u.lastSignInAt) : 'Never'}</td>
              <td>{u.disabledAt ? 'Disabled' : 'Active'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        Add users from the command line for now: <code>pnpm admin:create-user</code>. Inviting and
        disabling users here comes later in Phase 1.
      </p>
    </>
  );
}
