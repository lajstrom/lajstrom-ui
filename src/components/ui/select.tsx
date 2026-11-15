import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

/** The browser's own select, styled as Input: short lists of fixed choices. */
export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 w-full cursor-pointer rounded-md border border-border bg-background px-2 text-sm text-foreground shadow-card outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
