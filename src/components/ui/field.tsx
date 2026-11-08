import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

type FieldProps = {
  label: ReactNode;
  /** The id of the control, so that the label points at it. */
  htmlFor?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
};

/** A labelled form control with an optional hint below it. */
export function Field({ label, htmlFor, hint, className, children }: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** An error to show above a form's buttons; nothing when there is none. */
export function FormError({ error }: { error: ReactNode }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
      {error}
    </p>
  );
}
