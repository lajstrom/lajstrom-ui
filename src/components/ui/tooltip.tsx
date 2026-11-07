import { Tooltip as T } from "radix-ui";
import type { ReactNode } from "react";

export const TooltipProvider = T.Provider;

type TooltipProps = {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  /** Wrap the trigger in a span; needed when the child is not a focusable element. */
  wrap?: boolean;
};

export function Tooltip({ content, children, side = "top", wrap = false }: TooltipProps) {
  if (content === null || content === undefined || content === "") return <>{children}</>;
  return (
    <T.Root>
      <T.Trigger asChild>{wrap ? <span className="inline-flex">{children}</span> : children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 max-w-xs rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md"
        >
          {content}
          <T.Arrow className="fill-foreground" />
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
