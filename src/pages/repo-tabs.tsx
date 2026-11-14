import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Clock, KeyRound, Loader2, RefreshCw, ShieldCheck, Upload } from "lucide-react";

import { callerQuery, infoQuery, registriesQuery, reindexQuery, sessionsQuery } from "@/api/queries";
import type { Repo } from "@/api/types";
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
              <span className="ml-1 text-xs text-muted-foreground">(proxy and group repos come after the MVP)</span>
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
          <Properties>
            <Property label="Max file size">{p.maxFileSize ? formatBytes(p.maxFileSize) : "registry limit only"}</Property>
            <Property label="Blob redirect">
              {p.blobRedirect ?? "auto"}
              <span className="ml-1 text-xs text-muted-foreground">
                {(p.blobRedirect ?? "auto") === "auto" ? "(307 to the registry's storage when it supports it)" : "(always stream through Lajstrom)"}
              </span>
            </Property>
            {repo.format === "maven" ? (
              <>
                <Property label="Deploy session timeout">{p["maven.sessionTimeout"] ?? "30m"}</Property>
                <Property label="On timeout">
                  {(p["maven.sessionExpiry"] ?? "abort") === "seal" ? "seal: commit the files received so far" : "abort: drop the session"}
                </Property>
              </>
            ) : null}
          </Properties>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Backend registry" description={registry ? registry.product : "Details are visible to admins"} />
        <CardBody>
          <Properties>
            <Property label="Name">
              {who.data?.admin ? (
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
        ) : !report.data ? (
          <CardBody>
            <Skeleton className="h-16" />
          </CardBody>
        ) : (
          <>
            <CardBody>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                {(
                  [
                    ["OCI repositories", report.data.ociRepositories],
                    ["Manifests", report.data.manifests],
                    ["Added", report.data.added],
                    ["Updated", report.data.updated],
                    ["Removed", report.data.removed],
                    ["Degraded", report.data.degraded],
                    ["Foreign", report.data.foreign.length],
                  ] as const
                ).map(([label, n]) => (
                  <div key={label} className="rounded-md border border-border px-3 py-2">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className={`text-base font-semibold tabular ${(label === "Foreign" || label === "Degraded") && n > 0 ? "text-warning" : ""}`}>
                      {formatNumber(n)}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {report.data.finishedAt ? (
                  <>
                    Finished <RelativeTime iso={report.data.finishedAt} /> in{" "}
                    {Math.max(1, Math.round((Date.parse(report.data.finishedAt) - Date.parse(report.data.startedAt)) / 1000))} s.
                  </>
                ) : null}{" "}
                Degraded rows have no readable metadata layer and were indexed from annotations only.
              </p>
            </CardBody>
            {report.data.foreign.length ? (
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
                      <TH>Why</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {report.data.foreign.map((f) => (
                      <TR key={f.digest}>
                        <TD className="font-mono text-xs">{f.path}</TD>
                        <TD className="font-mono text-xs">{f.tag}</TD>
                        <TD>
                          <CopyText value={f.digest} display={shortDigest(f.digest)} label="digest" />
                        </TD>
                        <TD className="text-xs text-muted-foreground">{f.reason}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </>
            ) : null}
          </>
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
