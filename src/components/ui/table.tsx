import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto scrollbar-thin">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("bg-surface text-left", className)} {...props} />;
}

export function TBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn("[&>tr:last-child]:border-0", className)} {...props} />;
}

export function TR({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("border-b border-border", className)} {...props} />;
}

export function TH({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "h-9 px-3 text-xs font-medium whitespace-nowrap text-muted-foreground first:pl-4 last:pr-4",
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-3 py-2 align-middle first:pl-4 last:pr-4", className)} {...props} />;
}

type SortableTHProps = ComponentProps<"th"> & {
  active: boolean;
  direction: "asc" | "desc";
  onSort: () => void;
  children: ReactNode;
};

/** A header cell that sorts its column; the sort state lives in the URL of the page. */
export function SortableTH({ active, direction, onSort, children, className, ...props }: SortableTHProps) {
  const Icon = !active ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <TH aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"} className={className} {...props}>
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "-ml-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 hover:bg-muted hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {children}
        <Icon className={cn("size-3", !active && "opacity-40")} />
      </button>
    </TH>
  );
}
