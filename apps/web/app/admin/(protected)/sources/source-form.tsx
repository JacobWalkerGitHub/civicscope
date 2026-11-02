import { ActionForm, SelectField, TextField } from '@/components/admin/form';
import type { FormState } from '@/lib/admin-action';
import { options, SOURCE_TYPE_LABELS } from '@/lib/labels';

export interface SourceValues {
  url: string;
  title: string;
  publisher: string;
  sourceType: string;
  publishedAt: string | null;
  retrievedAt: string;
  archiveUrl: string | null;
}

export function SourceForm({
  action,
  source,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  source: SourceValues;
}) {
  return (
    <ActionForm action={action} submitLabel="Save changes">
      <TextField name="url" label="URL" type="url" defaultValue={source.url} required />
      <TextField name="title" label="Title" defaultValue={source.title} required />
      <TextField name="publisher" label="Publisher" defaultValue={source.publisher} required />
      <SelectField
        name="sourceType"
        label="Type"
        options={options(SOURCE_TYPE_LABELS)}
        defaultValue={source.sourceType}
      />
      <TextField
        name="publishedAt"
        label="Date published"
        type="date"
        defaultValue={source.publishedAt}
      />
      <TextField
        name="retrievedAt"
        label="Last checked"
        type="date"
        defaultValue={source.retrievedAt}
        hint="The last date someone confirmed the page still says what it's cited for."
        required
      />
      <TextField
        name="archiveUrl"
        label="Archived copy"
        type="url"
        defaultValue={source.archiveUrl}
        hint="A permanent copy, e.g. on web.archive.org, in case the page changes."
      />
    </ActionForm>
  );
}
