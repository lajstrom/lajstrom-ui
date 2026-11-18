// The reason for changes in the header (docs/spec/rbac.md §13, A reason; src/api/reason.ts): the
// one kept for this tab, which the person sets, changes or forgets, and the question a change asks
// when the server takes it only with a reason and none is kept. The dialog loads when it opens,
// out of the main chunk.

import { useQuery } from "@tanstack/react-query";
import { Ticket } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";

import { infoQuery } from "@/api/queries";
import { setReasonAsker, setReasonRequired } from "@/api/reason";
import { Tooltip } from "@/components/ui/tooltip";

import { onOpenReasonDialog, useKeptReason } from "./reason";

const ReasonDialog = lazy(() => import("./change-reason-dialog").then((m) => ({ default: m.ReasonDialog })));

type Open = { ask: false } | { ask: true; answer: (reason: string | null) => void };

export function ChangeReason() {
  const info = useQuery(infoQuery);
  const required = info.data?.requireReason === true;
  const kept = useKeptReason();
  const [open, setOpen] = useState<Open | null>(null);

  useEffect(() => setReasonRequired(required), [required]);
  useEffect(() => {
    setReasonAsker(() => new Promise((resolve) => setOpen({ ask: true, answer: resolve })));
    return () => setReasonAsker(null);
  }, []);
  useEffect(() => onOpenReasonDialog(() => setOpen({ ask: false })), []);

  const close = (reason: string | null) => {
    if (open?.ask) open.answer(reason);
    setOpen(null);
  };
  return (
    <>
      {kept !== null ? (
        <Tooltip
          content={
            <>
              Your reason for changes, sent with each change of users, bindings, tokens, repos, webhooks and CI trust policies and kept in its audit row:{" "}
              <span className="font-medium">{kept}</span>
            </>
          }
        >
          {/* The reason itself where the header has the room; its icon alone below. */}
          <button
            type="button"
            aria-label={`Reason for changes: ${kept}`}
            onClick={() => setOpen({ ask: false })}
            className="flex h-8 max-w-44 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-xs text-muted-foreground shadow-card transition-colors hover:text-foreground"
          >
            <Ticket className="size-3.5 shrink-0" />
            <span className="hidden truncate 2xl:inline">{kept}</span>
          </button>
        </Tooltip>
      ) : null}
      {open ? (
        <Suspense fallback={null}>
          <ReasonDialog ask={open.ask} required={required} onClose={close} />
        </Suspense>
      ) : null}
    </>
  );
}
