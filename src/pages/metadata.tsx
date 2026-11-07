import { ExternalLink } from "lucide-react";

import type { MetadataRow } from "@/lib/formats";
import { cn } from "@/lib/cn";

/** Fields of a metadata layer as label/value rows; lists become one line per item. */
export function MetadataRows({ rows, compact = false }: { rows: MetadataRow[]; compact?: boolean }) {
  return (
    <dl className={cn("grid gap-x-4 gap-y-2 text-sm", compact ? "grid-cols-[6.5rem_1fr]" : "grid-cols-[minmax(8rem,auto)_1fr]")}>
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className="min-w-0 break-words">
            {Array.isArray(r.value) ? (
              <ul className={cn("space-y-0.5", r.mono && "font-mono text-[12px]")}>
                {r.value.map((v, i) => (
                  <li key={i} className="break-all">
                    {v}
                  </li>
                ))}
              </ul>
            ) : r.href ? (
              <a href={r.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-primary hover:underline">
                {r.value}
                <ExternalLink className="size-3 shrink-0" />
              </a>
            ) : (
              <span className={cn(r.mono && "font-mono text-[12.5px] break-all")}>{r.value}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
