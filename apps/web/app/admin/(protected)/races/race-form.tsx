import { AutoName } from '@/components/admin/auto-name';
import { ActionForm, CheckboxField, SelectField, TextField } from '@/components/admin/form';
import type { FormState } from '@/lib/admin-action';
import { RACE_STATUS_LABELS, options } from '@/lib/labels';

export interface RaceValues {
  officeId: number;
  districtId: number | null;
  partyId: number | null;
  name: string;
  seats: number;
  isSpecial: boolean;
  status: string;
  termStartsOn: string | null;
  termStartSourceUrl: string | null;
}

export function RaceForm({
  action,
  offices,
  districts,
  parties,
  partyRule,
  race,
  submitLabel,
  resetOnSave,
  savedMessage,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  offices: { id: number; title: string; jurisdictionName: string }[];
  districts: { id: number; label: string; name: string }[];
  parties: { id: number; name: string }[];
  partyRule: 'required' | 'forbidden';
  race?: RaceValues;
  submitLabel: string;
  resetOnSave?: boolean;
  savedMessage?: string;
}) {
  return (
    <ActionForm
      action={action}
      submitLabel={submitLabel}
      resetOnSave={resetOnSave}
      savedMessage={savedMessage}
    >
      {!race && <AutoName kind="race" />}
      <SelectField
        name="officeId"
        label="Office"
        placeholder="Choose an office…"
        options={offices.map((o) => ({ value: o.id, label: `${o.title} (${o.jurisdictionName})` }))}
        defaultValue={race?.officeId}
        hint="Missing an office? Add it under Offices first."
        required
      />
      <SelectField
        name="districtId"
        label="District"
        placeholder="Statewide / no district"
        options={districts.map((d) => ({ value: d.id, label: d.name }))}
        defaultValue={race?.districtId}
      />
      {partyRule === 'required' ? (
        <SelectField
          name="partyId"
          label="Party holding this primary"
          placeholder="Choose a party…"
          options={parties.map((p) => ({ value: p.id, label: p.name }))}
          defaultValue={race?.partyId}
          hint="In a partisan primary, each party's contest is its own race."
          required
        />
      ) : (
        <p className="hint">
          This election is open to candidates of every party, so the race has no party.
        </p>
      )}
      <TextField
        name="name"
        label="Race name"
        defaultValue={race?.name}
        hint={
          race
            ? 'As shown publicly, e.g. "Governor" or "House of Delegates, District 7".'
            : 'Filled in from the office and district. Change it if you like.'
        }
        required
      />
      <TextField name="seats" label="Seats to fill" type="number" defaultValue={race?.seats ?? 1} />
      <SelectField
        name="status"
        label="Status"
        options={options(RACE_STATUS_LABELS)}
        defaultValue={race?.status ?? 'scheduled'}
      />
      <CheckboxField
        name="isSpecial"
        label="Special election (fills a vacancy)"
        defaultChecked={race?.isSpecial}
      />
      <TextField
        name="termStartsOn"
        label="Winner’s term begins"
        type="date"
        defaultValue={race?.termStartsOn ?? undefined}
        hint="Optional. Shown on the winner's profile as the day they take office. Leave blank until an official source states it."
      />
      <TextField
        name="termStartSourceUrl"
        label="Source for the term start date"
        type="url"
        defaultValue={race?.termStartSourceUrl ?? undefined}
        hint="The https:// address of the constitution, statute or election authority page that sets it. Required with a date."
      />
    </ActionForm>
  );
}
