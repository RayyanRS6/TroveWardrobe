import type { ReactNode } from "react";

type FieldProps = {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  /**
   * The control is a Select button: its label is plain text (id `${id}-label`)
   * that the button names itself with, so pressing the label opens nothing.
   */
  select?: boolean;
  children: ReactNode;
};

/** The id to put in the control's aria-describedby (error first, then hint). */
export function fieldMessageId(id: string, error?: string, hint?: string) {
  if (error) return `${id}-error`;
  return hint ? `${id}-hint` : undefined;
}

/** A labelled form control with a required mark and an error or hint below. */
export function Field({
  id,
  label,
  required,
  error,
  hint,
  className = "",
  select = false,
  children,
}: FieldProps) {
  const mark = required && (
    <span className="required-mark" aria-hidden="true">
      *
    </span>
  );
  return (
    <div className={`field ${className}`}>
      {select ? (
        <span id={`${id}-label`} className="field-label">
          {label}
          {mark}
          {required && <span className="visually-hidden"> (required)</span>}
        </span>
      ) : (
        <label htmlFor={id} id={`${id}-label`} className="field-label">
          {label}
          {mark}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
