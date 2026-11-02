import { CheckboxField, ActionForm, SelectField, TextField } from '@/components/admin/form';
import type { FormState } from '@/lib/admin-action';
import { CHAMBER_LABELS, OFFICE_BRANCH_LABELS, OFFICE_LEVEL_LABELS, options } from '@/lib/labels';

export interface OfficeValues {
  jurisdictionId: number;
  title: string;
  level: string;
  branch: string;
  chamber: string | null;
  seats: number;
  termYears: number | null;
  isPartisan: boolean;
}

export function OfficeForm({
  action,
  jurisdictions,
  office,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  jurisdictions: { id: number; name: string }[];
  office?: OfficeValues;
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      <TextField
        name="title"
        label="Title"
        defaultValue={office?.title}
        hint='As it should appear publicly, e.g. "Governor of Kentucky" or "Virginia House of Delegates".'
        required
      />
      <SelectField
        name="jurisdictionId"
        label="Jurisdiction"
        placeholder="Choose…"
        options={jurisdictions.map((j) => ({ value: j.id, label: j.name }))}
        defaultValue={office?.jurisdictionId}
        hint="United States for federal offices (President, U.S. Senate, U.S. House)."
        required
      />
      <SelectField
        name="level"
        label="Level"
        options={options(OFFICE_LEVEL_LABELS)}
        defaultValue={office?.level ?? 'state'}
      />
      <SelectField
        name="branch"
        label="Branch"
        options={options(OFFICE_BRANCH_LABELS)}
        defaultValue={office?.branch ?? 'executive'}
      />
      <SelectField
        name="chamber"
        label="Chamber"
        placeholder="None (not legislative)"
        options={options(CHAMBER_LABELS)}
        defaultValue={office?.chamber}
      />
      <TextField
        name="seats"
        label="Seats per race"
        type="number"
        defaultValue={office?.seats ?? 1}
      />
      <TextField
        name="termYears"
        label="Term length (years)"
        type="number"
        defaultValue={office?.termYears}
      />
      <CheckboxField
        name="isPartisan"
        label="Candidates run with a party label"
        defaultChecked={office?.isPartisan ?? true}
      />
    </ActionForm>
  );
}
