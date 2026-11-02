import type { ReactNode } from 'react';
import { requirePermission } from '@/lib/session';
import { PublicShell } from '@/components/public/shell';

/** Admin-only previews of public pages, including drafts. Under /admin, so never cached or indexed. */
export default async function PreviewLayout({ children }: { children: ReactNode }) {
  await requirePermission('admin:view');
  return <PublicShell>{children}</PublicShell>;
}
