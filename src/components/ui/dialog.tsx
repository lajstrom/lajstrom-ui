import { X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

type DialogContentProps = ComponentProps<typeof D.Content> & {
  title: ReactNode;
  description?: ReactNode;
};

/** A modal: title, optional description, the body, and a close button; Escape closes it. */
export function DialogContent({ title, description, className, children, ...props }: DialogContentProps) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
      <D.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-lg outline-none",
          className,
        )}
        // Without a description, tell Radix there is none instead of pointing at a missing id.
        {...(description ? {} : { "aria-describedby": undefined })}
        {...props}
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <D.Title className="text-base font-semibold">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-muted-foreground">{description}</D.Description> : null}
          </div>
          <D.Close
            className="-m-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-4"
            aria-label="Close"
          >
            <X />
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}

/** The row of buttons at the bottom of a dialog, primary action last. */
export function DialogActions({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mt-5 flex justify-end gap-2", className)} {...props} />;
}
