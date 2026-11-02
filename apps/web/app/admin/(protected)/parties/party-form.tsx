import { ActionForm, SelectField, TextField } from '@/components/admin/form';
import type { FormState } from '@/lib/admin-action';

export function PartyForm({
  action,
  jurisdictions,
  party,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  jurisdictions: { id: number; name: string }[];
  party?: {
    name: string;
    shortName: string | null;
    fecCode: string | null;
    jurisdictionId: number | null;
  };
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      <TextField name="name" label="Name" defaultValue={party?.name} required />
      <TextField
        name="shortName"
        label="Short name"
        defaultValue={party?.shortName}
        hint="Optional, e.g. an abbreviation."
      />
      <TextField
        name="fecCode"
        label="FEC party code"
        defaultValue={party?.fecCode}
        hint="Three letters used by the Federal Election Commission, if any."
      />
      <SelectField
        name="jurisdictionId"
        label="Scope"
        placeholder="National party"
        options={jurisdictions.map((j) => ({ value: j.id, label: `${j.name} only` }))}
        defaultValue={party?.jurisdictionId}
      />
    </ActionForm>
  );
}
