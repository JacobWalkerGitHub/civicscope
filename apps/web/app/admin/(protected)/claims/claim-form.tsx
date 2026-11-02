import type { ClaimKind } from '@civicscope/core';
import { ActionForm, SelectField, TextAreaField, TextField } from '@/components/admin/form';
import type { FormState } from '@/lib/admin-action';
import {
  BIO_CATEGORY_LABELS,
  CONTENT_KIND_LABELS,
  options,
  POSITION_TYPE_LABELS,
} from '@/lib/labels';

export interface ClaimValues {
  contentKind: string;
  title: string;
  summary: string;
  quote: string | null;
  issueId: number | null;
  positionType: string | null;
  bioCategory: string | null;
  organization: string | null;
  statedOn: string | null;
  venue: string | null;
  startYear: number | null;
  endYear: number | null;
}

const TITLE_HINTS: Record<ClaimKind, string> = {
  position: 'A short, neutral description, e.g. "Supports raising the minimum wage".',
  biography: 'e.g. "B.A., University of Kentucky" or "Mayor of Example City".',
  accomplishment: 'e.g. "Sponsored the 2024 broadband expansion law".',
};

/** Fields for one profile entry; which appear depends on the kind of entry. */
export function ClaimForm({
  action,
  kind,
  issues,
  claim,
  submitLabel,
  warning,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  kind: ClaimKind;
  issues: { id: number; name: string }[];
  claim?: ClaimValues;
  submitLabel: string;
  /** Shown above the form, e.g. that saving takes a published entry down for review. */
  warning?: string;
}) {
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      {warning && <p className="notice">{warning}</p>}
      {kind === 'position' && (
        <>
          <SelectField
            name="issueId"
            label="Issue"
            placeholder="Choose an issue…"
            options={issues.map((i) => ({ value: i.id, label: i.name }))}
            defaultValue={claim?.issueId}
            required
          />
          <SelectField
            name="positionType"
            label="Type of statement"
            placeholder="Choose a type…"
            options={options(POSITION_TYPE_LABELS)}
            defaultValue={claim?.positionType}
            required
          />
        </>
      )}
      {kind === 'biography' && (
        <SelectField
          name="bioCategory"
          label="Category"
          placeholder="Choose a category…"
          options={options(BIO_CATEGORY_LABELS)}
          defaultValue={claim?.bioCategory}
          required
        />
      )}
      <TextField
        name="title"
        label="Title"
        defaultValue={claim?.title}
        hint={TITLE_HINTS[kind]}
        required
      />
      <TextAreaField
        name="summary"
        label="Summary"
        defaultValue={claim?.summary}
        hint="Plain, neutral wording: what the source shows, without praise or criticism."
      />
      <TextAreaField
        name="quote"
        label={kind === 'position' ? 'Their exact words (required)' : 'Exact words (optional)'}
        defaultValue={claim?.quote}
        hint="Copied exactly from the source, so readers can judge the summary for themselves."
      />
      <SelectField
        name="contentKind"
        label="Whose account is this?"
        placeholder="Choose one…"
        options={options(CONTENT_KIND_LABELS)}
        defaultValue={claim?.contentKind ?? (kind === 'position' ? 'candidate_claim' : undefined)}
        hint="Readers see this label, so a candidate's own claims are never presented as established fact."
        required
      />
      {kind !== 'position' && (
        <TextField name="organization" label="Organization" defaultValue={claim?.organization} />
      )}
      {kind === 'biography' ? (
        <>
          <TextField
            name="startYear"
            label="Start year"
            type="number"
            defaultValue={claim?.startYear}
          />
          <TextField
            name="endYear"
            label="End year"
            type="number"
            defaultValue={claim?.endYear}
            hint="Leave blank if ongoing."
          />
        </>
      ) : (
        <>
          <TextField
            name="statedOn"
            label={kind === 'position' ? 'Date said' : 'Date'}
            type="date"
            defaultValue={claim?.statedOn}
          />
          {kind === 'position' && (
            <TextField
              name="venue"
              label="Where it was said"
              defaultValue={claim?.venue}
              hint='e.g. "Campaign website", "Debate on WKYT", "Floor speech".'
            />
          )}
        </>
      )}
    </ActionForm>
  );
}
