import { Ban, Trash2, Undo2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import type { BatchDeleteItemResult, Repo, VersionDetail } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { errorText } from "@/lib/errors";
import { formatBytes, pluralize } from "@/lib/format";

import type { VersionGroup } from "./package-model";
import { deletes, useDeleteVersion, useDeleteVersions, useYank, yanks } from "./version-changes";

type VersionActionsProps = {
  repo: Repo;
  name: string;
  detail: VersionDetail;
  /** How many versions the package has, when the list is loaded. */
  versions: number | undefined;
};

/** Yank or unyank, and delete, on the page of a version, for callers who may. */
export function VersionActions({ repo, name, detail, versions }: VersionActionsProps) {
  const yank = useYank(repo.format, repo.name, name);
  const [yanking, setYanking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const version = detail.version;
  return (
    <>
      {yanks(repo) ? (
        detail.yanked ? (
          <Button disabled={yank.isPending} onClick={() => yank.mutate({ version, yanked: null, before: detail.yanked ?? null })}>
            <Undo2 />
            Unyank
          </Button>
        ) : (
          <Button disabled={yank.isPending} onClick={() => setYanking(true)}>
            <Ban />
            Yank
          </Button>
        )
      ) : null}
      {deletes(repo) ? (
        <Button onClick={() => setDeleting(true)}>
          <Trash2 />
          Delete
        </Button>
      ) : null}
      <YankDialog open={yanking} onOpenChange={setYanking} version={version} onYank={(reason) => yank.mutate({ version, yanked: { reason }, before: null })} />
      {deleting ? <DeleteVersionDialog repo={repo} name={name} detail={detail} last={versions === 1} onClose={() => setDeleting(false)} /> : null}
    </>
  );
}

type YankDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  version: string;
  onYank: (reason: string) => void;
};

/** Asks for the reason of a yank, which pip shows; the yank shows at once (optimistic). */
function YankDialog({ open, onOpenChange, version, onYank }: YankDialogProps) {
  const id = useId();
  const [reason, setReason] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onYank(reason.trim());
    onOpenChange(false);
    setReason("");
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Yank ${version}?`}
        description="pip and uv skip a yanked version unless a requirement pins it with ==, and warn when one does (PEP 592). Its files stay and are served as before."
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Reason" htmlFor={id} hint="Optional. pip shows it to whoever installs the version.">
            <Input id={id} value={reason} maxLength={4096} autoFocus placeholder="breaks proxies with HTTPS_PROXY set" onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogActions>
            <DialogClose asChild>
              <Button type="button">Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="primary">
              <Ban />
              Yank
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type DeleteVersionDialogProps = { repo: Repo; name: string; detail: VersionDetail; last: boolean; onClose: () => void };

/** Names what a delete takes, then waits for the server (realistic): a delete cannot be undone. */
function DeleteVersionDialog({ repo, name, detail, last, onClose }: DeleteVersionDialogProps) {
  const del = useDeleteVersion(repo.format, repo.name, name);
  const [force, setForce] = useState(false);
  const forceId = useId();
  const files = detail.variants.flatMap((v) => v.files);
  const size = files.reduce((n, f) => n + f.size, 0);
  const named = detail.pointers.map((p) => p.name);
  return (
    <Dialog open onOpenChange={(o) => !o && !del.isPending && onClose()}>
      <DialogContent title={`Delete ${name} ${detail.version}?`}>
        <div className="space-y-3 text-sm">
          <p>
            {detail.variants.length > 1 ? `Its ${pluralize(detail.variants.length, "manifest")}` : "Its manifest"}, with the signatures, SBOMs and
            attestations that refer to {detail.variants.length > 1 ? "them" : "it"}, {pluralize(files.length, "file")} and {formatBytes(size)}, go from the
            index and, where the registry still has them, from the registry. This cannot be undone.
          </p>
          {detail.variants.length > 1 ? (
            <p className="flex flex-wrap gap-1">
              {detail.variants.map((v) => (
                <Badge key={v.digest} tone="outline" className="font-mono">
                  {v.variant}
                </Badge>
              ))}
            </p>
          ) : null}
          {last ? <p className="text-warning">It is the only version of {name}: the package goes with it.</p> : null}
          {named.length ? (
            <label htmlFor={forceId} className="flex items-start gap-2 text-warning">
              <input id={forceId} type="checkbox" className="mt-0.5 size-4 accent-danger" checked={force} onChange={(e) => setForce(e.target.checked)} />
              <span>
                {named.join(", ")} {named.length > 1 ? "name" : "names"} this version. Delete it anyway: {named.length > 1 ? "they then name" : "it then names"} a
                version that is gone.
              </span>
            </label>
          ) : null}
          <FormError error={errorText(del.error)} />
        </div>
        <DialogActions>
          <Button disabled={del.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={del.isPending || (named.length > 0 && !force)}
            onClick={() => del.mutate({ version: detail.version, digests: detail.variants.map((v) => v.digest), force, last })}
          >
            <Trash2 />
            {del.isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

const outcome: Record<BatchDeleteItemResult["status"], { label: string; tone: "success" | "neutral" | "warning" | "danger" }> = {
  deleted: { label: "deleted", tone: "success" },
  gone: { label: "gone already", tone: "neutral" },
  changed: { label: "changed, kept", tone: "warning" },
  protected: { label: "named, kept", tone: "warning" },
  young: { label: "too new, kept", tone: "warning" },
  error: { label: "failed", tone: "danger" },
};

type DeleteVersionsDialogProps = {
  repo: Repo;
  name: string;
  /** The versions to delete, as the list shows them. */
  groups: VersionGroup[];
  /** How many versions the package has. */
  total: number;
  onClose: () => void;
  onDeleted: () => void;
};

/** Deletes the versions selected in the list in one request, each checked on its own by the
 * server, and shows what became of each. */
export function DeleteVersionsDialog({ repo, name, groups, total, onClose, onDeleted }: DeleteVersionsDialogProps) {
  const del = useDeleteVersions(repo.format, repo.name, name, total);
  const manifests = groups.reduce((n, g) => n + g.variants.length, 0);
  const size = groups.every((g) => g.size !== null) ? groups.reduce((n, g) => n + g.size!, 0) : null;
  const results = del.data?.results;
  const remove = () =>
    del.mutate(
      groups.map((g) => ({ package: name, version: g.version, digests: g.variants.map((v) => v.digest) })),
      { onSuccess: onDeleted },
    );
  return (
    <Dialog open onOpenChange={(o) => !o && !del.isPending && onClose()}>
      <DialogContent title={results ? `Deleted ${pluralize(results.filter((r) => r.status === "deleted").length, "version")} of ${name}` : `Delete ${pluralize(groups.length, "version")} of ${name}?`}>
        {results ? (
          <Table>
            <THead>
              <TR>
                <TH>Version</TH>
                <TH>Result</TH>
              </TR>
            </THead>
            <TBody>
              {results.map((r) => (
                <TR key={r.version}>
                  <TD className="font-mono text-xs">{r.version}</TD>
                  <TD>
                    <Badge tone={outcome[r.status].tone}>{outcome[r.status].label}</Badge>
                    {r.status !== "deleted" && r.message ? <div className="mt-1 text-xs text-muted-foreground">{r.message}</div> : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <div className="space-y-3 text-sm">
            <p>
              {pluralize(manifests, "manifest")}
              {size === null ? "" : `, ${formatBytes(size)}`}, with the signatures, SBOMs and attestations that refer to them, go from the index and, where
              the registry still has them, from the registry. The server checks each version on its own: one published again or named by a dist-tag since
              this list was read is kept. This cannot be undone.
            </p>
            <p className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
              {groups.map((g) => (
                <Badge key={g.version} tone="outline" className="font-mono">
                  {g.version}
                </Badge>
              ))}
            </p>
            <FormError error={errorText(del.error)} />
          </div>
        )}
        <DialogActions>
          {results ? (
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          ) : (
            <>
              <Button disabled={del.isPending} onClick={onClose}>
                Cancel
              </Button>
              <Button variant="danger" disabled={del.isPending} onClick={remove}>
                <Trash2 />
                {del.isPending ? "Deleting…" : `Delete ${pluralize(groups.length, "version")}`}
              </Button>
            </>
          )}
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
