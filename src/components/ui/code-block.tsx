import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

import { CopyButton } from "./copy-button";

type CodeBlockProps = {
  code: string;
  /** Small caption above the code: "shell", "settings.xml", "/etc/apt/sources.list.d/…". */
  caption?: ReactNode;
  className?: string;
  /** Lines starting with "#" are shown as comments. */
  shell?: boolean;
};

/** A copyable block of code or configuration. */
export function CodeBlock({ code, caption, className, shell = false }: CodeBlockProps) {
  return (
    <div className={cn("group relative overflow-hidden rounded-md border border-border bg-code", className)}>
      {caption ? (
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
          <span className="truncate font-mono">{caption}</span>
          <CopyButton value={code} label="to clipboard" />
        </div>
      ) : (
        <div className="absolute top-1.5 right-1.5 opacity-70 transition-opacity group-hover:opacity-100">
          <CopyButton value={code} label="to clipboard" />
        </div>
      )}
      <pre className={cn("overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-relaxed scrollbar-thin", !caption && "pr-10")}>
        <code>
          {shell
            ? code.split("\n").map((line, i, lines) => {
                const comment = line.trimStart().startsWith("#");
                const continued = i > 0 && lines[i - 1]!.trimEnd().endsWith("\\");
                return (
                  <span key={i} className={cn("block", comment && "text-muted-foreground")}>
                    {comment || continued || line === "" ? (
                      continued ? `  ${line}` : line || " "
                    ) : (
                      <>
                        <span className="text-muted-foreground select-none">$ </span>
                        {line}
                      </>
                    )}
                  </span>
                );
              })
            : code}
        </code>
      </pre>
    </div>
  );
}

/** Inline monospace text with a copy button: digests, tags, OCI paths. */
export function CopyText({
  value,
  display,
  label,
  className,
}: {
  value: string;
  display?: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-0.5 font-mono text-[12.5px]", className)}>
      <span className="truncate" title={value}>
        {display ?? value}
      </span>
      <CopyButton value={value} label={label} />
    </span>
  );
}
