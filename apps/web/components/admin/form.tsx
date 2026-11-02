'use client';

import { createContext, useActionState, useContext, useId, type ReactNode } from 'react';
import type { FormState } from '@/lib/admin-action';

const initial: FormState = { error: null, fieldErrors: {}, values: {} };
/** Form state plus a per-form id prefix, so two forms on one page never share field ids. */
const FormContext = createContext<FormState & { idPrefix: string }>({
  ...initial,
  idPrefix: 'field',
});

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export function ActionForm({
  action,
  submitLabel,
  savedMessage = 'Saved.',
  resetOnSave = false,
  children,
  className = 'stack form',
}: {
  action: Action;
  submitLabel: string;
  savedMessage?: string;
  /** Clear the fields after a successful save (for "add another" forms). */
  resetOnSave?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  const idPrefix = useId();
  return (
    <form action={formAction} className={className} noValidate>
      {state.error && (
        <p role="alert" className="alert">
          {state.error}
        </p>
      )}
      {state.saved && !state.error && (
        <p role="status" className="notice">
          {savedMessage}
        </p>
      )}
      <FormContext.Provider
        value={{ ...state, values: resetOnSave && state.saved ? {} : state.values, idPrefix }}
      >
        {children}
      </FormContext.Provider>
      <div>
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

/** A one-button form for publish, archive and restore actions. */
export function ActionButton({
  action,
  label,
  variant = 'secondary',
  confirm,
}: {
  action: Action;
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  return (
    <form
      action={formAction}
      className="inline-form"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      <button type="submit" className={variant} disabled={pending}>
        {label}
      </button>
      {state.error && (
        <span role="alert" className="alert inline">
          {state.error}
        </span>
      )}
    </form>
  );
}

function useField(name: string, defaultValue?: string | number | null) {
  const state = useContext(FormContext);
  const value = state.values[name] ?? (defaultValue == null ? '' : String(defaultValue));
  return { value, error: state.fieldErrors[name], id: `${state.idPrefix}-${name}` };
}

export function TextField({
  name,
  label,
  defaultValue,
  type = 'text',
  hint,
  required,
}: {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  type?: 'text' | 'date' | 'url' | 'number' | 'email';
  hint?: string;
  required?: boolean;
}) {
  const { value, error, id } = useField(name, defaultValue);
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={value}
        key={value}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
        }
      />
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextAreaField({
  name,
  label,
  defaultValue,
  hint,
  required,
  rows = 3,
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
  hint?: string;
  required?: boolean;
  rows?: number;
}) {
  const { value, error, id } = useField(name, defaultValue);
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      <textarea
        id={id}
        name={name}
        rows={rows}
        defaultValue={value}
        required={required}
        key={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
        }
      />
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function SelectField({
  name,
  label,
  options,
  defaultValue,
  placeholder,
  hint,
  required,
}: {
  name: string;
  label: string;
  options: { value: string | number; label: string }[];
  defaultValue?: string | number | null;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}) {
  const { value, error, id } = useField(name, defaultValue);
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      <select
        id={id}
        name={name}
        defaultValue={value}
        key={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
        }
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function CheckboxField({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  const state = useContext(FormContext);
  const submitted = Object.keys(state.values).length > 0;
  const checked = submitted ? state.values[name] === 'on' : Boolean(defaultChecked);
  return (
    <div className="field checkbox">
      <label>
        <input type="checkbox" name={name} defaultChecked={checked} key={String(checked)} /> {label}
      </label>
    </div>
  );
}

/** A file picker. Browsers never refill these, so after an error the user picks again. */
export function FileField({
  name,
  label,
  accept,
  hint,
  required,
}: {
  name: string;
  label: string;
  accept?: string;
  hint?: string;
  required?: boolean;
}) {
  const { error, id } = useField(name);
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      <input
        id={id}
        name={name}
        type="file"
        accept={accept}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
        }
      />
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
