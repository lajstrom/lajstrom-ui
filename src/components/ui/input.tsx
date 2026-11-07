import { Search, X } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm text-foreground shadow-card outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
        className,
      )}
      {...props}
    />
  );
}

type SearchInputProps = Omit<ComponentProps<"input">, "onChange" | "value"> & {
  value: string;
  onValueChange: (value: string) => void;
};

/** A text input with a search icon and a clear button. */
export function SearchInput({ value, onValueChange, className, ...props }: SearchInputProps) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className="pr-7 pl-8 [&::-webkit-search-cancel-button]:hidden"
        {...props}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => onValueChange("")}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
