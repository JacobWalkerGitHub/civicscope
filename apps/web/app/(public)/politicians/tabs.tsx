import { Tabs } from '@/components/public/ui';

export function PoliticianTabs({ current }: { current: 'office' | 'state' | 'candidates' }) {
  return (
    <Tabs
      label="Politicians"
      items={[
        { href: '/politicians', label: 'Congress', current: current === 'office' },
        {
          href: '/politicians/state',
          label: 'States',
          current: current === 'state',
        },
        {
          href: '/politicians/candidates',
          label: 'Candidates',
          current: current === 'candidates',
        },
      ]}
    />
  );
}
