// The dialog of the reason for changes (src/app/change-reason.tsx): set, changed or forgotten from
// the header and the user menu, or asked by a change that the server takes only with a reason.

import { Ticket } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { keepReason, keptReason, reasonProblem } from "@/api/reason";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const WHAT = "users, bindings, tokens, repos, webhooks and CI trust policies";

/** ask: a change waits for the reason, which onClose gives it, or null to send nothing. Otherwise
 * the reason kept for the changes of this tab is set or forgotten here, and onClose closes. */
export function ReasonDialog({ ask, required, onClose }: { ask: boolean; required: boolean; onClose: (reason: string | null) => void }) {
  const ids = { reason: useId(), keep: useId() };
  const [reason, setReason] = useState(() => keptReason() ?? "");
  const [keep, setKeep] = useState(true);
  const kept = keptReason();
  const problem = reason === "" ? null : reasonProblem(reason);
  const ok = reason !== "" && problem === null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    if (!ask || keep) keepReason(reason);
    onClose(reason);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose(null)}>
      <DialogContent
        title={ask ? "Reason for this change" : "Reason for your changes"}
        description={
          ask
            ? `This server takes a change of ${WHAT} only with a reason (auth.requireReason): a ticket or a sentence, the reference of the change's approval, kept in its audit row.`
            : `A ticket or a sentence, the reference of the changes' approval. This tab sends it with each change of ${WHAT}, and the server keeps it in the change's audit row.${required ? " This server takes those changes only with a reason (auth.requireReason)." : ""}`
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Reason" htmlFor={ids.reason} hint={problem ? <span className="text-danger">{problem}</span> : "At most 1024 bytes, on one line."}>
            <Input
              id={ids.reason}
              autoFocus
              value={reason}
              placeholder="CHG-1234: the release team writes on npm/*"
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {ask ? (
            <label htmlFor={ids.keep} className="flex items-start gap-2 text-sm">
              <input id={ids.keep} type="checkbox" className="mt-0.5 size-4 accent-primary" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
              <span>
                Send it with my next changes too
                <span className="block text-xs text-muted-foreground">Kept in this tab until you sign out or forget it.</span>
              </span>
            </label>
          ) : null}
          <DialogActions>
            {!ask && kept !== null ? (
              <Button
                type="button"
                className="mr-auto"
                onClick={() => {
                  keepReason(null);
                  onClose(null);
                }}
              >
                Forget it
              </Button>
            ) : null}
            <Button type="button" onClick={() => onClose(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!ok}>
              <Ticket />
              {ask ? "Send the change" : "Keep"}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
