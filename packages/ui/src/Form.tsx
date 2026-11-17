"use client";

import { useState } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { Eye, EyeOff } from "lucide-react";

type FieldWrapperProps = {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
};

export function FormField({
  label,
  hint,
  error,
  required,
  children,
  className = "",
  htmlFor,
}: FieldWrapperProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label htmlFor={htmlFor} className="text-[12.5px] font-semibold text-gray-600">
          {label} {required && <span className="text-danger">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <span className="text-xs text-gray-400">{hint}</span>}
      {error && (
        <span role="alert" className="text-xs font-medium text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

const INPUT_BASE =
  "w-full rounded-md border-[1.5px] border-border px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-green-600 disabled:cursor-not-allowed disabled:bg-bg-dashboard";

export type FormInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
};

export function FormInput({
  label,
  hint,
  error,
  required,
  className = "",
  id,
  ...props
}: FormInputProps) {
  return (
    <FormField label={label} hint={hint} error={error} required={required} htmlFor={id}>
      <input
        id={id}
        required={required}
        className={`${INPUT_BASE} ${error ? "border-danger" : ""} ${className}`}
        {...props}
        // A number input's value changes on mouse-wheel scroll while
        // focused (native browser behavior) — surprising and error-prone
        // in a long admin form the user is scrolling through, so blur it
        // out of the scroll path instead. Composed with any caller-
        // supplied onWheel (none exist today) rather than replacing it.
        onWheel={
          props.type === "number"
            ? (e) => {
                e.currentTarget.blur();
                props.onWheel?.(e);
              }
            : props.onWheel
        }
        // Same reasoning as onWheel above, a different failure mode: a
        // repeated-shape form (the same "Length (cm)"/"Breadth (cm)"/etc
        // labels on every single order the logistics wizard opens for) is
        // exactly the pattern a browser's per-field value history likes to
        // autofill/suggest from — a package's real dimensions or a price
        // must never be silently carried over from a completely different
        // record. Caller can still opt back in with an explicit autoComplete.
        autoComplete={props.autoComplete ?? (props.type === "number" ? "off" : undefined)}
      />
    </FormField>
  );
}

export type FormPasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label?: string;
  hint?: string;
  error?: string;
};

export function FormPasswordInput({
  label,
  hint,
  error,
  required,
  className = "",
  id,
  ...props
}: FormPasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <FormField label={label} hint={hint} error={error} required={required} htmlFor={id}>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          required={required}
          className={`${INPUT_BASE} pr-10 ${error ? "border-danger" : ""} ${className}`}
          {...props}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-gray-400 hover:text-gray-600"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </FormField>
  );
}

export type FormSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  hint?: string;
  error?: string;
};

export function FormSelect({
  label,
  hint,
  error,
  required,
  className = "",
  id,
  children,
  ...props
}: FormSelectProps) {
  return (
    <FormField label={label} hint={hint} error={error} required={required} htmlFor={id}>
      <select
        id={id}
        required={required}
        className={`${INPUT_BASE} bg-white ${error ? "border-danger" : ""} ${className}`}
        {...props}
      >
        {children}
      </select>
    </FormField>
  );
}

export type FormFileInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label?: string;
  hint?: string;
  error?: string;
};

export function FormFileInput({
  label,
  hint,
  error,
  required,
  className = "",
  id,
  ...props
}: FormFileInputProps) {
  return (
    <FormField label={label} hint={hint} error={error} required={required} htmlFor={id}>
      <input
        id={id}
        type="file"
        required={required}
        className={`w-full rounded-md border-[1.5px] border-border px-3 py-2 text-sm text-ink outline-none transition-colors file:mr-3 file:rounded file:border-0 file:bg-bg-dashboard file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink hover:file:bg-border focus:border-green-600 disabled:cursor-not-allowed disabled:bg-bg-dashboard ${error ? "border-danger" : ""} ${className}`}
        {...props}
      />
    </FormField>
  );
}

export type FormTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: string;
  error?: string;
};

export function FormTextarea({
  label,
  hint,
  error,
  required,
  className = "",
  id,
  ...props
}: FormTextareaProps) {
  return (
    <FormField label={label} hint={hint} error={error} required={required} htmlFor={id}>
      <textarea
        id={id}
        required={required}
        className={`${INPUT_BASE} resize-y font-sans ${error ? "border-danger" : ""} ${className}`}
        {...props}
      />
    </FormField>
  );
}
