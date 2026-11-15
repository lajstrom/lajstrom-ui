// Starting a reindex of a repo (docs/api.md, Reindex): realistic, the dialog waits for the server
// to take the run and shows its refusal, such as a run that overlaps (409). The run is then
// polled by the card that shows it (useReindexRun).

import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { callerQuery, registriesQuery } from "@/api/queries";
import type { Repo } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogContent } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { errorText } from "@/lib/errors";

import { useStartReindex } from "./repo-changes";

export function StartReindexButton({ repo, running }: { repo: Repo; running: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip content={running ? "A run covers the repo now: its report comes when it ends." : null}>
        <span className="inline-flex">
          <Button size="sm" disabled={running} onClick={() => setOpen(true)}>
            <Play />
            Reindex
          </Button>
        </span>
      </Tooltip>
      {open ? <StartReindexDialog repo={repo} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function Option({ id, checked, onChange, title, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; title: string; children: ReactNode }) {
  return (
    <label htmlFor={id} className="flex items-start gap-2 text-sm">
      <input id={id} type="checkbox" className="mt-0.5 size-4 accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{children}</span>
      </span>
    </label>
  );
}

function StartReindexDialog({ repo, onClose }: { repo: Repo; onClose: () => void }) {
  const start = useStartReindex(repo);
  const who = useQuery(callerQuery);
  // The registries are the admin's to read: a maintainer gets the option without the detail.
  const regs = useQuery({ ...registriesQuery, enabled: who.data?.admin ?? false });
  const ids = { prune: useId(), verify: useId() };
  const [prune, setPrune] = useState(false);
  const [verify, setVerify] = useState(false);
  const noReferrersApi = regs.data?.find((r) => r.name === repo.registry)?.capabilities.referrers === false;
  return (
    <Dialog open onOpenChange={(o) => !o && !start.isPending && onClose()}>
      <DialogContent
        title={`Reindex ${repo.prefix}?`}
        description="A run reads the registry below the repo's path and writes the index from the manifests' annotations, on the replica that takes it. Clients are served meanwhile; the report says what it found."
      >
        <div className="space-y-3">
          <Option id={ids.prune} checked={prune} onChange={setPrune} title="Prune">
            Remove the rows of manifests that are gone from the registry; one it answers unknown is kept until it says so twice.
          </Option>
          <Option id={ids.verify} checked={verify} onChange={setVerify} title="Verify">
            Read every manifest again, not only the new ones
            {noReferrersApi ? `; ${repo.registry} has no referrers API, so the referrers indexes that lack referrers are pushed again` : ""}.
          </Option>
          <FormError error={errorText(start.error)} />
        </div>
        <DialogActions>
          <Button disabled={start.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={start.isPending} onClick={() => start.mutate({ prune, verify }, { onSuccess: onClose })}>
            <Play />
            {start.isPending ? "Starting…" : "Start the reindex"}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
