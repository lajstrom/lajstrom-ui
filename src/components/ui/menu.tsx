import { DropdownMenu } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({
  className,
  align = "end",
  children,
  ...props
}: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        sideOffset={6}
        className={cn(
          "z-50 min-w-48 rounded-lg border border-border bg-background p-1 text-sm shadow-lg",
          className,
        )}
        {...props}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenu.Label>) {
  return <DropdownMenu.Label className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)} {...props} />;
}

export function MenuItem({
  className,
  icon,
  children,
  hint,
  ...props
}: ComponentProps<typeof DropdownMenu.Item> & { icon?: ReactNode; hint?: ReactNode }) {
  return (
    <DropdownMenu.Item
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </DropdownMenu.Item>
  );
}

export function MenuRadioGroup(props: ComponentProps<typeof DropdownMenu.RadioGroup>) {
  return <DropdownMenu.RadioGroup {...props} />;
}

export function MenuRadioItem({
  className,
  children,
  description,
  ...props
}: ComponentProps<typeof DropdownMenu.RadioItem> & { description?: ReactNode }) {
  return (
    <DropdownMenu.RadioItem
      className={cn(
        "relative flex cursor-pointer flex-col rounded-md py-1.5 pr-2 pl-7 outline-none select-none data-[highlighted]:bg-muted",
        className,
      )}
      {...props}
    >
      <DropdownMenu.ItemIndicator className="absolute top-2.5 left-2.5 size-2 rounded-full bg-primary" />
      <span>{children}</span>
      {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
    </DropdownMenu.RadioItem>
  );
}

export function MenuSeparator({ className, ...props }: ComponentProps<typeof DropdownMenu.Separator>) {
  return <DropdownMenu.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}
