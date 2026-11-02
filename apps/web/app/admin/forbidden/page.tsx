import Link from 'next/link';

export default function ForbiddenPage() {
  return (
    <main className="narrow">
      <h1>You don&apos;t have access to that page</h1>
      <p className="muted">
        Your role doesn&apos;t include this permission. Ask the site owner if you need it.
      </p>
      <p>
        <Link href="/admin">Back to the dashboard</Link>
      </p>
    </main>
  );
}
