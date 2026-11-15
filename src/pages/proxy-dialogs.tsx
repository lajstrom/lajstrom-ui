// A proxy's upstream on the Maintenance tab: purge its cache, prefetch names or images. Both are
// realistic (docs/adr/0003-changes-realistic-by-default.md): the dialog waits for the server's
// answer, shows its refusal, and a prefetch shows what became of each thing it asked for.

import { CloudDownload, Eraser, RotateCcw, WifiOff } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import type { PrefetchItemResult, Repo } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyText } from "@/components/ui/code-block";
import { Dialog, DialogActions, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { errorText } from "@/lib/errors";
import { formatBytes, pluralize, shortDigest } from "@/lib/format";

import { countResults, failedItems, listItems, PREFETCH_MAX, prefetchRequest, usePrefetch, usePurge } from "./proxy-changes";

/** The proxy's upstream, with the purge and the prefetch, for a maintainer. */
export function UpstreamCacheCard({ repo }: { repo: Repo }) {
  const [purging, setPurging] = useState(false);
  const [prefetching, setPrefetching] = useState(false);
  const u = repo.upstream;
  const oci = repo.format === "oci";
  return (
    <Card>
      <CardHeader
        icon={<CloudDownload />}
        title={`Upstream ${u?.name ?? ""}`}
        description={`Documents of the upstream are cached for ${u?.metadataTTL ?? "10m"}, what it does not have for ${u?.negativeTTL ?? "2m"}; what the repo fetched stays in the registry.`}
        actions={
          <>
            <Button size="sm" onClick={() => setPurging(true)}>
              <Eraser />
              Purge cache
            </Button>
            <Tooltip content={u?.offline ? "The repo is offline: it asks its upstream nothing. Turn offline off in Settings to prefetch." : null}>
              <span className="inline-flex">
                <Button size="sm" variant="primary" disabled={u?.offline} onClick={() => setPrefetching(true)}>
                  <CloudDownload />
                  Prefetch
                </Button>
              </span>
            </Tooltip>
          </>
        }
      />
      <CardBody className="space-y-2 text-sm text-muted-foreground">
        {u?.offline ? (
          <p className="flex items-center gap-1.5 text-warning">
            <WifiOff className="size-4" />
            Offline: the repo serves what it holds and its cache, however old, and asks the upstream nothing.
          </p>
        ) : null}
        <p>
          A purge drops what the repo keeps of the upstream's {oci ? "tags and manifests" : "documents"}: the next read asks the upstream again. A prefetch
          fetches {oci ? "images" : "the versions of package names"} before a client asks for them, the way a {oci ? "pull" : "request"} would: before a rollout
          over a poor link, or before the upstream is switched off.
        </p>
      </CardBody>
      {purging ? <PurgeDialog repo={repo} onClose={() => setPurging(false)} /> : null}
      {prefetching ? <PrefetchDialog repo={repo} onClose={() => setPrefetching(false)} /> : null}
    </Card>
  );
}

function PurgeDialog({ repo, onClose }: { repo: Repo; onClose: () => void }) {
  const purge = usePurge(repo);
  const id = useId();
  const [name, setName] = useState("");
  const oci = repo.format === "oci";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    purge.mutate(name, { onSuccess: onClose });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !purge.isPending && onClose()}>
      <DialogContent
        title={`Purge the cache of ${repo.prefix}?`}
        description={`The repo forgets what it keeps of the upstream ${repo.upstream?.name ?? ""}'s ${oci ? "tags and manifests" : "documents"}, and the documents rendered from them: the next read of each asks the upstream again. What the repo fetched stays in the registry.`}
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label={oci ? "Only one path" : "Only one name"} htmlFor={id} hint="Optional. Empty purges the whole cache.">
            <Input
              id={id}
              value={name}
              autoFocus
              spellCheck={false}
              className="font-mono"
              placeholder={oci ? "library/nginx" : "left-pad"}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <FormError error={errorText(purge.error)} />
          <DialogActions>
            <Button type="button" disabled={purge.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={purge.isPending}>
              <Eraser />
              {purge.isPending ? "Purging…" : name.trim() ? `Purge ${name.trim()}` : "Purge the cache"}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const statusTone = { fetched: "success", held: "neutral", shared: "primary", failed: "danger" } as const;

function PrefetchDialog({ repo, onClose }: { repo: Repo; onClose: () => void }) {
  const run = usePrefetch(repo);
  const ids = { items: useId(), platforms: useId(), all: useId() };
  const oci = repo.format === "oci";
  const [text, setText] = useState("");
  const [platforms, setPlatforms] = useState("linux/amd64, linux/arm64");
  const [allVersions, setAllVersions] = useState(false);
  const items = listItems(text);
  const tooMany = items.length > PREFETCH_MAX;
  const results = run.data?.results;
  const noun = oci ? "image" : "name";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!items.length || tooMany) return;
    run.mutate(prefetchRequest(repo, items, { platforms: listItems(platforms), allVersions }));
  };
  const again = (next: string[]) => {
    setText(next.join("\n"));
    run.reset();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !run.isPending && onClose()}>
      <DialogContent
        className="max-w-3xl"
        title={results ? `Prefetched into ${repo.prefix}` : `Prefetch into ${repo.prefix}`}
        description={
          results
            ? undefined
            : oci
              ? "Each image is fetched the way a pull goes: the tag, the manifest of each platform, every blob the repo does not hold. A second run finds held what this one fetched."
              : "The versions of each name are fetched as a client's request would fetch them, with your name in the audit log. A second run finds held what this one fetched."
        }
      >
        {results ? (
          <PrefetchResults results={results} />
        ) : (
          <form id={ids.items} onSubmit={submit} className="space-y-4">
            <Field
              label={oci ? "Images" : "Package names"}
              htmlFor={`${ids.items}-text`}
              hint={
                oci
                  ? "One reference a line, below the repo: <path>[:<tag>][@<digest>]; latest without a tag. At most 100 a request."
                  : "One name a line, in the format's spelling. At most 100 a request."
              }
            >
              <Textarea
                id={`${ids.items}-text`}
                value={text}
                autoFocus
                rows={6}
                spellCheck={false}
                className="font-mono text-xs"
                placeholder={oci ? "library/nginx:1.27\nbitnami/redis:7.4" : "@acme/widgets\nleft-pad"}
                onChange={(e) => setText(e.target.value)}
              />
            </Field>
            {oci ? (
              <Field label="Platforms" htmlFor={ids.platforms} hint="os/architecture[/variant], separated by commas: the manifests fetched of an image that names an index, which needs them.">
                <Input id={ids.platforms} value={platforms} spellCheck={false} className="font-mono" onChange={(e) => setPlatforms(e.target.value)} />
              </Field>
            ) : (
              <label htmlFor={ids.all} className="flex items-start gap-2 text-sm">
                <input id={ids.all} type="checkbox" className="mt-0.5 size-4 accent-primary" checked={allVersions} onChange={(e) => setAllVersions(e.target.checked)} />
                <span>
                  Every version the upstream lists
                  <span className="block text-xs text-muted-foreground">Without it, the versions its pointers name (npm's dist-tags), or its newest.</span>
                </span>
              </label>
            )}
            {tooMany ? <FormError error={`${pluralize(items.length, noun)}: at most ${PREFETCH_MAX} a request. Send the rest in another.`} /> : null}
            <FormError error={errorText(run.error)} />
          </form>
        )}
        <DialogActions>
          {results ? (
            <>
              {failedItems(results).length ? (
                <Button onClick={() => again(failedItems(results))}>
                  <RotateCcw />
                  Try the failed again
                </Button>
              ) : null}
              <Button onClick={() => again([])}>Prefetch more</Button>
              <DialogClose asChild>
                <Button variant="primary">Done</Button>
              </DialogClose>
            </>
          ) : (
            <>
              <Button type="button" disabled={run.isPending} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" form={ids.items} variant="primary" disabled={run.isPending || !items.length || tooMany}>
                <CloudDownload />
                {run.isPending ? `Prefetching ${pluralize(items.length, noun)}…` : items.length ? `Prefetch ${pluralize(items.length, noun)}` : "Prefetch"}
              </Button>
            </>
          )}
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

/** What became of each version, or each image, platform and blob. */
function PrefetchResults({ results }: { results: PrefetchItemResult[] }) {
  const oci = results.some((r) => r.kind !== undefined);
  return (
    <div className="space-y-3">
      <p className="flex flex-wrap gap-1.5 text-sm">
        {countResults(results).map(([status, n]) => (
          <Badge key={status} tone={statusTone[status]}>
            {n} {status}
          </Badge>
        ))}
      </p>
      <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border">
        <Table>
          <THead>
            <TR>
              <TH>{oci ? "Image" : "Name"}</TH>
              <TH>{oci ? "What" : "Version"}</TH>
              {oci ? <TH>Digest</TH> : null}
              <TH>Result</TH>
              {oci ? <TH className="text-right">Fetched</TH> : null}
            </TR>
          </THead>
          <TBody>
            {results.map((r, i) => (
              <TR key={i}>
                <TD className="font-mono text-xs">{r.name}</TD>
                <TD className="text-xs">
                  {oci ? (
                    <>
                      {r.kind ?? "—"}
                      {r.platform ? <span className="ml-1 font-mono text-muted-foreground">{r.platform}</span> : null}
                    </>
                  ) : (
                    <span className="font-mono">{r.version ?? "—"}</span>
                  )}
                </TD>
                {oci ? <TD>{r.digest ? <CopyText value={r.digest} display={shortDigest(r.digest)} label="digest" /> : null}</TD> : null}
                <TD>
                  <Badge tone={statusTone[r.status]}>
                    {r.status}
                    {r.httpStatus ? ` ${r.httpStatus}` : ""}
                  </Badge>
                  {r.message ? <div className="mt-1 max-w-sm text-xs text-muted-foreground">{r.message}</div> : null}
                  {r.retryAfter ? <div className="text-xs text-muted-foreground">try again in {r.retryAfter} s</div> : null}
                </TD>
                {oci ? <TD className="text-right text-xs tabular whitespace-nowrap">{r.bytes !== undefined ? formatBytes(r.bytes) : "—"}</TD> : null}
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  );
}
