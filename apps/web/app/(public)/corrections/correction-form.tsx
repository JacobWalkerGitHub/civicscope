'use client';

import { ActionForm, TextAreaField, TextField } from '@/components/admin/form';
import { submitCorrectionAction } from './actions';

export function CorrectionForm({ pagePath }: { pagePath: string | null }) {
  return (
    <ActionForm
      action={submitCorrectionAction}
      submitLabel="Send correction"
      savedMessage="Thank you. An editor will review your request."
      resetOnSave
    >
      <TextField
        name="pagePath"
        label="Page with the error"
        defaultValue={pagePath}
        hint="The address of the CivicScope page, starting with /. Leave blank if it’s not about one page."
      />
      <TextAreaField
        name="description"
        label="What is wrong?"
        hint="Tell us what the page says and what it should say."
        rows={6}
        required
      />
      <TextField
        name="evidenceUrl"
        label="A source that shows the right information"
        type="url"
        hint="Optional, but it helps us fix things faster. An official source is best."
      />
      <TextField
        name="contactEmail"
        label="Your email"
        type="email"
        hint="Optional. Only used to reply to you, never published or shared."
      />
      <div className="hp" aria-hidden="true">
        <label htmlFor="correction-website">Leave this empty</label>
        <input id="correction-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
    </ActionForm>
  );
}
