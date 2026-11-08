import { FlaskConical } from "lucide-react";
import { Tabs } from "radix-ui";

import { demoMode } from "@/app/demo";
import type { Snippet } from "@/lib/formats";
import { cn } from "@/lib/cn";

import { CodeBlock } from "./ui/code-block";

/** In the demo, says once at the top of the Connect tab that its commands are examples: no server
 * answers them behind the example host. */
export function DemoCommandsNote({ host, className }: { host: string; className?: string }) {
  if (!demoMode().active) return null;
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm", className)}>
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning" />
      <p>
        These commands are examples. In the demo there is no server behind <span className="font-mono">{host}</span>, so they do
        not run against it; against a real Lajstrom they work as shown, with its address in place of that one.
      </p>
    </div>
  );
}

/** The same in one line, above the commands shown elsewhere in the demo. */
function DemoCommandsLine() {
  if (!demoMode().active) return null;
  return (
    <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
      <FlaskConical className="size-3.5 shrink-0" />
      Example commands: in the demo no server answers them.
    </p>
  );
}

type SnippetTabsProps = {
  snippets: Snippet[];
  className?: string;
  /** Leave out the demo's one-line note where a DemoCommandsNote says it already. */
  noDemoLine?: boolean;
};

/** Several ways to do the same thing (pip, uv, pip.conf), one tab each. */
export function SnippetTabs({ snippets, className, noDemoLine = false }: SnippetTabsProps) {
  if (snippets.length === 0) return null;
  const demoLine = noDemoLine ? null : <DemoCommandsLine />;
  if (snippets.length === 1) {
    const s = snippets[0]!;
    return (
      <div className={className}>
        {demoLine}
        <CodeBlock code={s.code} caption={s.caption} shell={s.shell} />
        {s.note ? <p className="mt-1.5 text-xs text-muted-foreground">{s.note}</p> : null}
      </div>
    );
  }
  return (
    <Tabs.Root defaultValue={snippets[0]!.id} className={className}>
      {demoLine}
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
