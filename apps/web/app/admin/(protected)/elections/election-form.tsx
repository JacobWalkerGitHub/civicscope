import { ActionForm, SelectField, TextField } from '@/components/admin/form';
import type { FormState } from '@/lib/admin-action';
import { ELECTION_TYPE_LABELS, PRIMARY_SYSTEM_LABELS, options } from '@/lib/labels';

export interface ElectionValues {
  jurisdictionId: number;
  type: string;
  primarySystem: string;
  date: string;
  name: string;
  officialUrl: string | null;
}

export function ElectionForm({
  action,
  states,
  election,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  states: { id: number; name: string }[];
  election?: ElectionValues;
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      <SelectField
        name="jurisdictionId"
        label="State"
        placeholder="Choose a state…"
        options={states.map((s) => ({ value: s.id, label: s.name }))}
        defaultValue={election?.jurisdictionId}
        required
      />
      <TextField
        name="name"
        label="Name"
        defaultValue={election?.name}
        hint='e.g. "Kentucky General Election 2027"'
        required
      />
      <SelectField
        name="type"
        label="Type"
        options={options(ELECTION_TYPE_LABELS)}
        defaultValue={election?.type ?? 'general'}
      />
      <SelectField
        name="primarySystem"
        label="Primary system"
        options={options(PRIMARY_SYSTEM_LABELS)}
        defaultValue={election?.primarySystem ?? 'not_applicable'}
        hint="How candidates are narrowed down. General elections use “Not applicable”."
      />
      <TextField
        name="date"
        label="Election date"
        type="date"
        defaultValue={election?.date}
        required
      />
      <TextField
        name="officialUrl"
        label="Official election page"
        type="url"
        defaultValue={election?.officialUrl}
        hint="Link to the state election authority's page for this election (https://)."
      />
    </ActionForm>
  );
}
