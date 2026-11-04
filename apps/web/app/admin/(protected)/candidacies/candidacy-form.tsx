import { ActionForm, CheckboxField, SelectField, TextField } from '@/components/admin/form';
import type { FormState } from '@/lib/admin-action';

export interface CandidacyValues {
  partyId: number | null;
  ballotName: string;
  isIncumbent: boolean;
  campaignUrl: string | null;
  fecCommitteeId: string | null;
}

export function CandidacyForm({
  action,
  people,
  parties,
  racePartyName,
  candidacy,
  submitLabel,
  resetOnSave,
  savedMessage,
  newPerson,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  /** Only when adding: who can be added to this race. */
  people?: { id: number; sortName: string }[];
  parties: { id: number; name: string }[];
  /** Set for a partisan primary, whose candidates all carry the primary's party. */
  racePartyName: string | null;
  candidacy?: CandidacyValues;
  submitLabel: string;
  resetOnSave?: boolean;
  savedMessage?: string;
  /** Adding someone new: ask for their name instead of picking a person. */
  newPerson?: boolean;
}) {
  return (
    <ActionForm
      action={action}
      submitLabel={submitLabel}
      resetOnSave={resetOnSave}
      savedMessage={savedMessage}
    >
      {newPerson && (
        <>
          <TextField
            name="fullName"
            label="Full name"
            hint="As it appears on official records. Check the other tab first so the same person isn’t added twice."
            required
          />
          <TextField
            name="preferredName"
            label="Preferred name"
            hint='The name they go by, if different, e.g. "Andy".'
          />
        </>
      )}
      {people && (
        <SelectField
          name="personId"
          label="Person"
          placeholder="Choose a person…"
          options={people.map((p) => ({ value: p.id, label: p.sortName }))}
          hint="Not listed? Use “Someone new” instead."
          required
        />
      )}
      <TextField
        name="ballotName"
        label="Name on the ballot"
        defaultValue={candidacy?.ballotName}
        hint="Leave blank to use the person's full name."
      />
      {racePartyName ? (
        <p className="muted">
          This is the {racePartyName} primary, so the candidate is listed with that party.
        </p>
      ) : (
        <SelectField
          name="partyId"
          label="Party on the ballot"
          placeholder="None / not shown"
          options={parties.map((p) => ({ value: p.id, label: p.name }))}
          defaultValue={candidacy?.partyId}
        />
      )}
      <CheckboxField
        name="isIncumbent"
        label="Currently holds this seat"
        defaultChecked={candidacy?.isIncumbent}
      />
      <TextField
        name="campaignUrl"
        label="Campaign website"
        type="url"
        defaultValue={candidacy?.campaignUrl}
      />
      <TextField
        name="fecCommitteeId"
        label="FEC committee ID"
        defaultValue={candidacy?.fecCommitteeId}
        hint="Federal races only, e.g. C00123456."
      />
    </ActionForm>
  );
}

export const CANDIDACY_CITABLE_FIELDS = [
  { value: 'ballotName', label: 'Name on the ballot' },
  { value: 'partyId', label: 'Party on the ballot' },
  { value: 'isIncumbent', label: 'Incumbency' },
  { value: 'campaignUrl', label: 'Campaign website' },
  { value: 'status', label: 'Status' },
];
