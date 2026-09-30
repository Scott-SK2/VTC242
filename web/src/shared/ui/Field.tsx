import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useId } from 'react';

interface Base {
  label: string;
  hint?: string;
  error?: string | null;
  children?: ReactNode;
}

export function Field({ label, hint, error, children, htmlFor }: Base & { htmlFor?: string }) {
  return (
    <div className="mb-3">
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-sm text-gray-500">{hint}</p>}
      {error && (
        <p className="mt-1 text-sm text-alert" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField({
  label,
  hint,
  error,
  className = '',
  ...rest
}: Base & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <input
        id={id}
        className={`input ${error ? 'border-alert' : ''} ${className}`}
        aria-invalid={!!error}
        {...rest}
      />
    </Field>
  );
}

export function SelectField({
  label,
  hint,
  error,
  children,
  className = '',
  ...rest
}: Base & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <select id={id} className={`input ${className}`} {...rest}>
        {children}
      </select>
    </Field>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  className = '',
  ...rest
}: Base & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <textarea id={id} className={`input py-3 min-h-[96px] ${className}`} {...rest} />
    </Field>
  );
}

export function Checkbox({ label, ...rest }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex items-center gap-3 min-h-tap cursor-pointer">
      <input id={id} type="checkbox" className="h-5 w-5 accent-brand" {...rest} />
      <span>{label}</span>
    </label>
  );
}
