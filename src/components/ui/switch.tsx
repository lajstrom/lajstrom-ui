import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

type SwitchProps = Omit<ComponentProps<"button">, "onChange" | "role"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/** An on/off control that acts at once, such as a webhook's active: a button with role switch,
 * so that screen readers say on or off. */
export function Switch({ checked, onCheckedChange, className, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-border",
        className,
      )}
      {...props}
    >
      <span className={cn("size-3.5 rounded-full bg-background shadow-card transition-transform", checked && "translate-x-3.5")} />
    </button>
  );
}
