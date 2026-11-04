import { Tabs } from '@/components/public/ui';

export function PoliticianTabs({ current }: { current: 'office' | 'candidates' }) {
  return (
    <Tabs
      label="Politicians"
      items={[
        { href: '/politicians', label: 'In office now', current: current === 'office' },
        {
          href: '/politicians/candidates',
          label: 'Candidates',
          current: current === 'candidates',
        },
      ]}
    />
  );
}
