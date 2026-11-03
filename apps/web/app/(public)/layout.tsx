import type { ReactNode } from 'react';
import { PublicShell } from '@/components/public/shell';
import './public.css';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
