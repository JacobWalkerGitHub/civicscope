import { ActionForm, TextField } from '@/components/admin/form';
import type { FormState } from '@/lib/admin-action';

export interface PersonValues {
  fullName: string;
  preferredName: string | null;
  sortName: string;
  birthYear: number | null;
}

export function PersonForm({
  action,
  person,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  person?: PersonValues;
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      <TextField
        name="fullName"
        label="Full name"
        defaultValue={person?.fullName}
        hint="As it appears on official records."
        required
      />
      <TextField
        name="preferredName"
        label="Preferred name"
        defaultValue={person?.preferredName}
        hint='The name they go by, if different, e.g. "Andy".'
      />
      <TextField
        name="sortName"
        label="Sort name"
        defaultValue={person?.sortName}
        hint='Used for alphabetical lists, e.g. "Public, Jane Q." Leave blank to fill it in from the full name.'
      />
      <TextField
        name="birthYear"
        label="Birth year"
        type="number"
        defaultValue={person?.birthYear}
        hint="Only if a source states it."
      />
    </ActionForm>
  );
}

/** Fields of a person that a citation can support. */
export const PERSON_CITABLE_FIELDS = [
  { value: 'fullName', label: 'Name' },
  { value: 'preferredName', label: 'Preferred name' },
  { value: 'birthYear', label: 'Birth year' },
];
