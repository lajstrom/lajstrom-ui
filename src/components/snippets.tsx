import { Tabs } from "radix-ui";

import type { Snippet } from "@/lib/formats";
import { cn } from "@/lib/cn";

import { CodeBlock } from "./ui/code-block";

/** Several ways to do the same thing (pip, uv, pip.conf), one tab each. */
export function SnippetTabs({ snippets, className }: { snippets: Snippet[]; className?: string }) {
  if (snippets.length === 0) return null;
  if (snippets.length === 1) {
    const s = snippets[0]!;
    return (
      <div className={className}>
        <CodeBlock code={s.code} caption={s.caption} shell={s.shell} />
        {s.note ? <p className="mt-1.5 text-xs text-muted-foreground">{s.note}</p> : null}
      </div>
    );
  }
  return (
    <Tabs.Root defaultValue={snippets[0]!.id} className={className}>
      <Tabs.List aria-label="Variants" className="mb-2 flex flex-wrap gap-1">
        {snippets.map((s) => (
          <Tabs.Trigger
            key={s.id}
            value={s.id}
            className={cn(
              "h-6 cursor-pointer rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              "data-[state=active]:bg-primary-soft data-[state=active]:text-primary-soft-foreground",
            )}
          >
            {s.title}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {snippets.map((s) => (
        <Tabs.Content key={s.id} value={s.id} className="outline-none">
          <CodeBlock code={s.code} caption={s.caption} shell={s.shell} />
          {s.note ? <p className="mt-1.5 text-xs text-muted-foreground">{s.note}</p> : null}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
