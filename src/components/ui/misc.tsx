import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("animate-skeleton rounded-md bg-muted", className)} {...props} />;
}

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface px-1 font-sans text-[11px] font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

type EmptyStateProps = {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ icon, title, children, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon ? (
        <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <h3 className="text-sm font-semibold">{title}</h3>
      {children ? <div className="mt-1 max-w-md text-sm text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** A definition list in two columns: label on the left, value on the right. */
export function Properties({ className, ...props }: ComponentProps<"dl">) {
  return <dl className={cn("grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm", className)} {...props} />;
}

export function Property({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">
        {label}
        {hint ? <span className="ml-1 text-xs opacity-70">{hint}</span> : null}
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

type SegmentedProps<T extends string> = {
  value: T;
  options: { value: T; label: ReactNode; count?: number }[];
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
};

/** A row of mutually exclusive filter buttons. */
export function Segmented<T extends string>({ value, options, onChange, className, ...rest }: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={rest["aria-label"]}
      className={cn("inline-flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5", className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-6 cursor-pointer items-center gap-1.5 rounded px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
            o.value === value && "bg-background text-foreground shadow-card",
          )}
        >
          {o.label}
          {o.count !== undefined ? <span className="tabular text-muted-foreground">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
