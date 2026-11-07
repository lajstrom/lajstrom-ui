import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/cn";

import { Tooltip } from "./tooltip";

type CopyButtonProps = {
  value: string;
  /** What is copied, for the tooltip and the screen reader: "digest", "command". */
  label?: string;
  className?: string;
  size?: "sm" | "md";
};


export function CopyButton({ value, label = "value", className, size = "sm" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <Tooltip content={copied ? "Copied" : `Copy ${label}`}>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (await copyText(value)) setCopied(true);
        }}
        className={cn(
          "inline-flex shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          size === "sm" ? "size-6 [&_svg]:size-3.5" : "size-7 [&_svg]:size-4",
          copied && "text-success hover:text-success",
          className,
        )}
      >
        {copied ? <Check /> : <Copy />}
      </button>
    </Tooltip>
  );
}
