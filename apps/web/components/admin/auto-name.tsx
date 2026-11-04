'use client';

import { useEffect, useRef } from 'react';

const optionText = (form: HTMLFormElement, name: string) => {
  const el = form.elements.namedItem(name);
  if (!(el instanceof HTMLSelectElement) || !el.value) return '';
  return el.selectedOptions[0]?.textContent?.trim() ?? '';
};
const valueOf = (form: HTMLFormElement, name: string) => {
  const el = form.elements.namedItem(name);
  return el instanceof HTMLInputElement || el instanceof HTMLSelectElement ? el.value : '';
};

const BUILDERS = {
  /** "Virginia General Election 2027" */
  election: (f: HTMLFormElement) => {
    const state = optionText(f, 'jurisdictionId');
    const type = optionText(f, 'type');
    const year = valueOf(f, 'date').slice(0, 4);
    if (!state || !type) return '';
    return [state, type, /election/i.test(type) ? '' : 'Election', year].filter(Boolean).join(' ');
  },
  /** "Governor", "House of Delegates, District 7", with the party in a primary. */
  race: (f: HTMLFormElement) => {
    const office = optionText(f, 'officeId')
      .replace(/\s*\([^)]*\)$/, '')
      .replace(/ of (the )?(State of )?[A-Z][\w .]+$/, '');
    if (!office) return '';
    const district = optionText(f, 'districtId');
    const party = optionText(f, 'partyId');
    return `${office}${district ? `, ${district}` : ''}${party ? ` (${party})` : ''}`;
  },
} as const;

/**
 * Fills in the form's name field from the other fields as they change, until the
 * user types a name of their own. Renders nothing.
 */
export function AutoName({
  kind,
  field = 'name',
}: {
  kind: keyof typeof BUILDERS;
  field?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const nameInput = () => {
      const el = form.elements.namedItem(field);
      return el instanceof HTMLInputElement ? el : null;
    };
    // The last suggestion written; a name that differs was typed by the user.
    let last = '';
    const onChange = (e: Event) => {
      const input = nameInput();
      if (!input || e.target === input) return;
      if (input.value.trim() !== '' && input.value !== last) return;
      last = BUILDERS[kind](form);
      input.value = last;
    };
    form.addEventListener('change', onChange);
    form.addEventListener('input', onChange);
    return () => {
      form.removeEventListener('change', onChange);
      form.removeEventListener('input', onChange);
    };
  }, [kind, field]);
  return <span ref={ref} hidden />;
}
