import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Clock, KeyRound, Loader2, RefreshCw, ShieldCheck, Upload } from "lucide-react";

import { callerQuery, infoQuery, registriesQuery, reindexQuery, sessionsQuery } from "@/api/queries";
import type { ReindexRun, Repo } from "@/api/types";
import { ErrorState, Principal, RelativeTime } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyText } from "@/components/ui/code-block";
import { EmptyState, Properties, Property, Skeleton } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { formatBytes, formatDateTime, formatNumber, shortDigest } from "@/lib/format";
import { formatSpec, snippetContext } from "@/lib/formats";

import { AuditTable } from "./audit";
import { DeployTokens } from "./deploy-tokens";

const NOT_REPORTED = <span className="text-muted-foreground">not reported by this server version</span>;

/** The largest file when the policy sets none (Policy in the server's openapi.yaml). */
const defaultMaxFileSize: Record<string, number> = {
  npm: 512 * 1024 ** 2,
  pypi: 4 * 1024 ** 3,
  maven: 4 * 1024 ** 3,
  apt: 8 * 1024 ** 3,
  raw: 8 * 1024 ** 3,
  oci: 16 * 1024 ** 3,
};

export function RepoDetails({ repo }: { repo: Repo }) {
  const info = useQuery(infoQuery);
  const who = useQuery(callerQuery);
  const regs = useQuery({ ...registriesQuery, enabled: who.data?.admin ?? false });
  const registry = regs.data?.find((r) => r.name === repo.registry);
  const spec = formatSpec(repo.format);
  const ctx = snippetContext(info.data, repo);
  const p = repo.policy ?? {};

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Repository" />
        <CardBody>
          <Properties>
            <Property label="Format">
              {spec.label} <span className="font-mono text-xs text-muted-foreground">({spec.artifactType})</span>
            </Property>
            <Property label="Kind">
              {repo.kind}
              {repo.upstream ? <span className="ml-1 text-xs text-muted-foreground">of the upstream {repo.upstream.name}</span> : null}
              {repo.group ? <span className="ml-1 text-xs text-muted-foreground">of {repo.group.members.join(", ")}</span> : null}
            </Property>
            <Property label="Endpoint">
              <CopyText value={`${ctx.baseUrl}/${repo.format}/${repo.name}/`} />
            </Property>
            <Property label="OCI path">
              <CopyText
                value={`${registry?.prefix ?? ""}${repo.prefix}/`}
                display={
                  <>
                    {registry?.prefix ? <span className="text-muted-foreground">{registry.prefix}</span> : null}
                    {repo.prefix}/<span className="text-muted-foreground">&lt;package&gt;</span>
                  </>
                }
              />
            </Property>
            <Property label="Anonymous read">
              {repo.anonymousRead ? (info.data?.anonymousRead === false ? "on, but off server-wide (auth.anonymousRead)" : "on") : "off"}
            </Property>
            <Property label="Your access">
              {repo.permissions ? (
                <span className="flex flex-wrap gap-1">
                  {repo.permissions.map((a) => (
                    <Badge key={a} tone="outline">
                      {a}
                    </Badge>
                  ))}
                </span>
              ) : (
                NOT_REPORTED
              )}
            </Property>
            <Property label="Created">{formatDateTime(repo.createdAt)}</Property>
            <Property label="Updated">{formatDateTime(repo.updatedAt)}</Property>
          </Properties>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Policy" description="repos.policy; changing it needs manage on the repo" />
        <CardBody>
          {repo.kind === "group" ? (
            <p className="text-sm text-muted-foreground">A group has no policy of its own; each member keeps its own.</p>
          ) : (
          <Properties>
            <Property label="Max file size">
              {p.maxFileSize ? (
                formatBytes(p.maxFileSize)
              ) : defaultMaxFileSize[repo.format] ? (
                <>
                  {formatBytes(defaultMaxFileSize[repo.format]!)}
                  <span className="ml-1 text-xs text-muted-foreground">(the default for {spec.label})</span>
                </>
              ) : (
                "the server's default"
              )}
            </Property>
            <Property label="Blob redirect">
              {p.blobRedirect ?? "auto"}
              <span className="ml-1 text-xs text-muted-foreground">
                {(p.blobRedirect ?? "auto") === "auto" ? "(307 to the registry's storage when it supports it)" : "(always stream through Lajstrom)"}
              </span>
            </Property>
            {repo.format === "maven" ? (
              <>
                <Property label="Deploy session timeout">{p.maven?.sessionTimeout ?? "30m"}</Property>
                <Property label="Files per deploy">{p.maven?.maxSessionFiles ?? 256}</Property>
                <Property label="Versions taken">
                  {(p.maven?.versionPolicy ?? "release") === "release" ? "release versions" : "SNAPSHOT builds, one more under its own tag per deploy"}
                </Property>
              </>
            ) : null}
          </Properties>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Backend registry" description={registry ? registry.product : "Details are visible to admins"} />
        <CardBody>
          <Properties>
            <Property label="Name">
              {!repo.registry ? (
                <span className="text-muted-foreground">none: a group stores nothing, its members do</span>
              ) : who.data?.admin ? (
                <Link to="/registries" className="font-mono text-primary hover:underline">
                  {repo.registry}
                </Link>
              ) : (
                <span className="font-mono">{repo.registry}</span>
              )}
            </Property>
            {registry ? (
              <>
                <Property label="Type">{registry.type}</Property>
                <Property label="Instance prefix">
                  <span className="font-mono">{registry.prefix || "—"}</span>
                </Property>
                <Property label="Status">
                  <span className={registry.status.state === "ok" ? "text-success" : "text-warning"}>{registry.status.state}</span>
                  {registry.status.message ? <span className="ml-1 text-xs text-muted-foreground">{registry.status.message}</span> : null}
                </Property>
              </>
            ) : null}
          </Properties>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Index" description="Derived from the registry; reindex rebuilds it from manifest annotations" />
        <CardBody>
          <Properties>
            <Property label="State">
              <ReindexState repo={repo} />
            </Property>
            <Property label="Last reconcile">{repo.reindex ? <RelativeTime iso={repo.reindex.finishedAt} /> : NOT_REPORTED}</Property>
            <Property label="Next reconcile">
              {repo.reindex ? repo.reindex.nextReconcileAt ? <RelativeTime iso={repo.reindex.nextReconcileAt} /> : "—" : NOT_REPORTED}
            </Property>
            <Property label="Contents">
              {repo.stats ? `${formatNumber(repo.stats.manifests)} manifests, ${formatNumber(repo.stats.files)} files` : NOT_REPORTED}
            </Property>
          </Properties>
        </CardBody>
      </Card>

      {repo.signingKeys?.length ? (
        <Card className="lg:col-span-2">
          <CardHeader
            icon={<KeyRound />}
            title="Signing keys"
            description="apt checks Release/InRelease with this key (signed-by); retired keys are still served for a grace period"
          />
          <Table>
            <THead>
              <TR>
                <TH>Fingerprint</TH>
                <TH>Algorithm</TH>
                <TH>Created</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {repo.signingKeys.map((k) => (
                <TR key={k.fingerprint}>
                  <TD>
                    <CopyText value={k.fingerprint} display={k.fingerprint.replace(/(.{4})/g, "$1 ").trim()} label="fingerprint" />
                  </TD>
                  <TD className="font-mono text-xs">{k.algorithm}</TD>
                  <TD>
                    <RelativeTime iso={k.createdAt} />
                  </TD>
                  <TD>
                    {k.retiredAt ? (
                      <Tooltip content={`Retired ${formatDateTime(k.retiredAt)}`}>
                        <Badge>retired</Badge>
                      </Tooltip>
                    ) : (
                      <Badge tone="success">
                        <ShieldCheck />
                        current
                      </Badge>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}
    </div>
  );
}

const runTone = { running: "primary", done: "success", failed: "danger", abandoned: "warning" } as const;

function ReindexRunView({ run }: { run: ReindexRun }) {
  const r = run.report;
  const counts = (
    [
      ["OCI repositories", r?.ociRepositories],
      ["Manifests", r?.manifests],
      ["Added", r?.added],
      ["Updated", r?.updated],
      ["Removed", r?.removed],
      ["Degraded", r?.degraded],
      ["Foreign", r?.foreign?.length],
      ["Deleted, pending", r?.deletedPending],
      ["Referrers repaired", r?.repairedReferrers?.length],
    ] as [string, number | undefined][]
  ).flatMap(([label, n]) => (n === undefined ? [] : [[label, n] as const]));
  const warn = new Set(["Foreign", "Degraded", "Deleted, pending"]);
  return (
    <>
      <CardBody>
        <p className="mb-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
          <Badge tone={runTone[run.state as keyof typeof runTone] ?? "neutral"}>{run.state}</Badge>
          {run.allRepos ? "a run of every repo" : "a run of this repo"}, from {run.source}, by <Principal value={run.principal} />, started{" "}
          <RelativeTime iso={run.startedAt} />
          {run.finishedAt ? (
            <>
              , took {Math.max(1, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000))} s
            </>
          ) : null}
          {run.prune ? <Badge tone="outline">prune</Badge> : null}
          {run.verify ? <Badge tone="outline">verify</Badge> : null}
        </p>
        {run.error ? <p className="mb-3 text-sm text-danger">{run.error}</p> : null}
        {!r ? (
          <p className="text-xs text-muted-foreground">
            {run.state === "running" ? "The report comes when the run finishes." : "The run stopped before it reached this repo."}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {counts.map(([label, n]) => (
                <div key={label} className="rounded-md border border-border px-3 py-2">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className={`text-base font-semibold tabular ${warn.has(label) && n > 0 ? "text-warning" : ""}`}>{formatNumber(n)}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Degraded rows have no readable metadata layer and were indexed from annotations only.
              {r.deletedPending ? " Deleted, pending: tags the registry still lists after a delete through Lajstrom, not indexed again." : ""}
            </p>
          </>
        )}
      </CardBody>
      {r?.foreign?.length ? (
        <>
          <div className="border-t border-border px-4 pt-3 pb-1 text-sm font-medium">Foreign manifests</div>
          <p className="px-4 pb-2 text-xs text-muted-foreground">
            Found under this repo's path in the registry but not written by Lajstrom: they have no lajstrom.schema annotation and are not indexed.
          </p>
          <Table>
            <THead>
              <TR>
                <TH>OCI repository</TH>
                <TH>Tag</TH>
                <TH>Digest</TH>
                <TH>Media type</TH>
              </TR>
            </THead>
            <TBody>
              {r.foreign.map((f) => (
                <TR key={f.digest}>
                  <TD className="font-mono text-xs">{f.repository}</TD>
                  <TD className="font-mono text-xs">{f.tag}</TD>
                  <TD>
                    <CopyText value={f.digest} display={shortDigest(f.digest)} label="digest" />
                  </TD>
                  <TD className="font-mono text-xs text-muted-foreground">{f.mediaType}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      ) : null}
      {r?.repairedReferrers?.length ? (
        <>
          <div className="border-t border-border px-4 pt-3 pb-1 text-sm font-medium">Referrers indexes pushed again</div>
          <Table>
            <THead>
              <TR>
                <TH>OCI repository</TH>
                <TH>Subject</TH>
                <TH>Index</TH>
                <TH>Referrers added</TH>
              </TR>
            </THead>
            <TBody>
              {r.repairedReferrers.map((x) => (
                <TR key={x.index}>
                  <TD className="font-mono text-xs">{x.repository}</TD>
                  <TD>
                    <CopyText value={x.subject} display={shortDigest(x.subject)} label="subject" />
                  </TD>
                  <TD>
                    <CopyText value={x.index} display={shortDigest(x.index)} label="index" />
                  </TD>
                  <TD className="tabular">{x.added.length}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      ) : null}
    </>
  );
}

export function ReindexState({ repo }: { repo: Repo }) {
  const r = repo.reindex;
  if (!r) return NOT_REPORTED;
  if (r.state === "running")
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-primary">
        <Loader2 className="size-3.5 animate-spin" />
        reindex running since <RelativeTime iso={r.startedAt} />
      </span>
    );
  if (r.state === "failed")
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-danger">
        <AlertTriangle className="size-3.5" />
        failed with {r.errors} errors
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-success">
      <CheckCircle2 className="size-3.5" />
      in sync
    </span>
  );
}

export function RepoMaintenance({ repo }: { repo: Repo }) {
  const report = useQuery(reindexQuery(repo.format, repo.name));
  const sessions = useQuery({ ...sessionsQuery(repo.format, repo.name), enabled: repo.format === "maven" });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={<RefreshCw />}
          title="Last reindex"
          description="Reconcile compares the index with the registry every hour; reindex rebuilds it from the annotations"
          actions={<ReindexState repo={repo} />}
        />
        {report.isError ? (
          <ErrorState error={report.error} />
        ) : report.data === undefined ? (
          <CardBody>
            <Skeleton className="h-16" />
          </CardBody>
        ) : report.data === null ? (
          <EmptyState title="No reindex yet" className="py-6">
            No run has covered this repo: ingest indexes every publish, and a reindex rebuilds the index from the registry.
          </EmptyState>
        ) : (
          <ReindexRunView run={report.data} />
        )}
      </Card>

      {repo.format === "maven" ? (
        <Card>
          <CardHeader
            icon={<Upload />}
            title="Deploy sessions"
            description="mvn deploy uploads file by file; the PUT of maven-metadata.xml commits the session as one manifest"
          />
          {sessions.data && sessions.data.length === 0 ? (
            <EmptyState title="No sessions" className="py-6" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Coordinates</TH>
                  <TH>By</TH>
                  <TH>Files</TH>
                  <TH>State</TH>
                  <TH>Started</TH>
                  <TH>Expires</TH>
                </TR>
              </THead>
              <TBody>
                {sessions.data?.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-mono text-xs">{s.key}</TD>
                    <TD>
                      <Principal value={s.principal} />
                    </TD>
                    <TD>
                      <Tooltip content={s.files.map((f) => f.name).join(", ")}>
                        <span className="tabular">
                          {s.files.length} · {formatBytes(s.files.reduce((n, f) => n + f.size, 0))}
                        </span>
                      </Tooltip>
                    </TD>
                    <TD>
                      {s.state === "open" ? (
                        <Badge tone="primary">
                          <Clock />
                          open
                        </Badge>
                      ) : (
                        <Badge>{s.state}</Badge>
                      )}
                    </TD>
                    <TD>
                      <RelativeTime iso={s.createdAt} />
                    </TD>
                    <TD>
                      <RelativeTime iso={s.expiresAt} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      ) : null}

      <DeployTokens repo={repo} />
    </div>
  );
}

export function RepoActivity({ repo }: { repo: Repo }) {
  return <AuditTable fixedRepo={repo.prefix} />;
}
