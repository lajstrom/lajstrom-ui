import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  AlertTriangle,
  BadgeCheck,
  Braces,
  Download,
  FileText,
  Fingerprint,
  Link2,
  ShieldCheck,
  Tags,
} from "lucide-react";

import { ApiError, isUnavailable } from "@/api/client";
import { attachmentsQuery, infoQuery, packageQuery, repoQuery, versionQuery, versionsQuery } from "@/api/queries";
import type { Attachment, Repo, VariantDetail, VersionDetail } from "@/api/types";
import { ErrorState, FormatMark, PageHeader, Principal, RelativeTime } from "@/components/common";
import { SnippetTabs } from "@/components/snippets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CodeBlock, CopyText } from "@/components/ui/code-block";
import { EmptyState, Properties, Property, Segmented, Skeleton } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { demoMode } from "@/app/demo";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/cn";
import { formatBytes, formatDateTime, shortDigest } from "@/lib/format";
import { formatSpec, snippetContext, type FormatSpec } from "@/lib/formats";
import { variantShort } from "@/lib/variants";
import { ociSnippets, referrerKinds } from "@/lib/formats/common";

import { MetadataRows } from "./metadata";
import { packageCrumbs } from "./package-model";

type Props = { format: string; repoName: string; name: string; version: string };

/** One variant of a version as the cards show it: the server's VariantDetail, with what the
 * version and the format add. */
type View = VariantDetail & {
  version: string;
  ociRepository: string;
  size: number;
  /** lajstrom.uploaded-by, absent on a degraded row. */
  uploadedBy: string | null;
};

function viewOf(d: VersionDetail, v: VariantDetail): View {
  return {
    ...v,
    version: d.version,
    ociRepository: d.ociRepository,
    size: v.files.reduce((n, f) => n + f.size, 0),
    uploadedBy: v.attrs["lajstrom.uploaded-by"] ?? null,
  };
}

export function VersionPage({ format, repoName, name, version }: Props) {
  const spec = formatSpec(format);
  const search = useSearch({ strict: false }) as { variant?: string };
  const navigate = useNavigate();
  const repo = useQuery(repoQuery(format, repoName));
  const pkg = useQuery(packageQuery(format, repoName, name));
  const versions = useQuery(versionsQuery(format, repoName, name));
  const detail = useQuery(versionQuery(format, repoName, name, version));

  const d = detail.data;
  const variant = d?.variants.find((v) => v.variant === search.variant) ?? d?.variants[0];
  const view = d && variant ? viewOf(d, variant) : undefined;
  const latest = pkg.data?.latestVersion ?? versions.data?.[0]?.version;
  const isLatest = latest === version;
  const isRaw = format === "raw";

  const crumbs = packageCrumbs(format, repoName, name, version);
  if (detail.isError) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <>
        <PageHeader crumbs={crumbs} title={`${name} ${version}`} />
        <Card>
          {missing ? (
            <EmptyState icon={<AlertTriangle />} title="Version not found">
              {name} has no version {version} in {format}/{repoName}.
            </EmptyState>
          ) : (
            <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
          )}
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        icon={<FormatMark format={format} className="h-6 min-w-10 text-[11px]" />}
        title={
          <>
            <span className={cn(format === "maven" && "font-mono text-lg")}>{isRaw ? name.split("/").at(-1) : name}</span>{" "}
            <span className="font-mono text-muted-foreground">{isRaw ? shortDigest(version, 16) : version}</span>
          </>
        }
        badges={
          <>
            {isLatest ? <Badge tone="primary">{isRaw ? "current" : "latest"}</Badge> : null}
            {d?.yanked ? (
              <Tooltip content={d.yanked.reason ? `Yanked: ${d.yanked.reason}` : "Yanked: installers skip it unless pinned (PEP 592)"}>
                <Badge tone="warning">yanked</Badge>
              </Tooltip>
            ) : null}
            {d?.pointers.map((ptr) => (
              <Tooltip key={ptr.name} content={`The ${ptr.kind} ${ptr.name} names this version`}>
                <Badge tone="outline" className="font-mono">
                  {ptr.name}
                </Badge>
              </Tooltip>
            ))}
            {view?.attrs["lajstrom.pypi.nonstandard"] === "true" ? (
              <Tooltip content="Not a PEP 440 version: accepted and flagged lajstrom.pypi.nonstandard=true">
                <Badge tone="warning">non-standard version</Badge>
              </Tooltip>
            ) : null}
            {view?.degraded ? (
              <Tooltip content="The metadata layer is missing or unreadable; reindex kept the row from annotations only">
                <Badge tone="warning">degraded</Badge>
              </Tooltip>
            ) : null}
          </>
        }
        description={
          d && view ? (
            <span>
              Published <RelativeTime iso={d.publishedAt} />
              {view.uploadedBy ? (
                <>
                  {" "}
                  by <Principal value={view.uploadedBy} />
                </>
              ) : null}
              {d.variants.length > 1 ? ` · ${d.variants.length} ${spec.variantLabel?.toLowerCase()}s` : null}
            </span>
          ) : (
            <Skeleton className="h-4 w-72" />
          )
        }
      />

      {d && d.variants.length > 1 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{spec.variantLabel}:</span>
          <Segmented
            aria-label={spec.variantLabel ?? "Variant"}
            value={view?.variant ?? ""}
            onChange={(v) => void navigate({ to: ".", search: { variant: v }, replace: true })}
            options={d.variants.map((m) => ({
              value: m.variant,
              label: (
                <Tooltip content={`tag ${m.tag}`}>
                  <span className="font-mono">{variantShort(m.variant)}</span>
                </Tooltip>
              ),
            }))}
          />
        </div>
      ) : null}

      {!view || !repo.data ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-4">
            <Skeleton className="h-40" />
            <Skeleton className="h-56" />
          </div>
          <Skeleton className="h-80" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-4">
            <FilesCard view={view} spec={spec} repoName={repoName} pkgName={name} />
            <UseCard repo={repo.data} view={view} spec={spec} pkgName={name} />
            <AttachmentsCard format={format} repoName={repoName} pkgName={name} view={view} />
            <MetadataCard view={view} spec={spec} />
            <ManifestCard view={view} />
          </div>
          <aside className="min-w-0 space-y-4">
            <DetailsCard view={view} />
            <AttributesCard view={view} format={format} />
          </aside>
        </div>
      )}
    </>
  );
}

function FilesCard({ view, spec, repoName, pkgName }: { view: View; spec: FormatSpec; repoName: string; pkgName: string }) {
  const info = useQuery(infoQuery);
  const base = (info.data?.externalURL ?? window.location.origin).replace(/\/$/, "");
  const mock = demoMode().active;
  return (
    <Card>
      <CardHeader
        icon={<FileText />}
        title="Files"
        description={`${view.files.length} file layer${view.files.length === 1 ? "" : "s"} · ${formatBytes(view.size)}${view.metadata ? " · plus metadata.json" : ""}`}
      />
      <Table>
        <THead>
          <TR>
            <TH>Name</TH>
            <TH>Kind</TH>
            <TH className="text-right">Size</TH>
            <TH>Digest</TH>
            <TH className="w-px" />
          </TR>
        </THead>
        <TBody>
          {view.files.map((f) => {
            const path = spec.filePath(repoName, pkgName, view, f.name);
            const url = path === null ? null : base + path;
            return (
              <TR key={f.digest}>
                <TD className="max-w-[22rem]">
                  <Tooltip content={<>{f.name}<br />{f.mediaType}</>}>
                    <span className="block truncate font-mono text-[12.5px]">{f.name}</span>
                  </Tooltip>
                </TD>
                <TD className="text-xs whitespace-nowrap text-muted-foreground">{spec.fileRole(f.mediaType, f.attrs)}</TD>
                <TD className="text-right tabular whitespace-nowrap">{formatBytes(f.size)}</TD>
                <TD>
                  <CopyText value={f.digest} display={shortDigest(f.digest)} label="digest" />
                </TD>
                <TD>
                  {url === null ? null : mock ? (
                    <Tooltip content={`Mock data: copies ${url}`}>
                      <Button variant="ghost" size="icon-sm" aria-label={`Copy download URL of ${f.name}`} onClick={() => void copyText(url)}>
                        <Link2 />
                      </Button>
                    </Tooltip>
                  ) : (
                    <Tooltip content="Download">
                      <Button variant="ghost" size="icon-sm" asChild>
                        <a href={url} aria-label={`Download ${f.name}`}>
                          <Download />
                        </a>
                      </Button>
                    </Tooltip>
                  )}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </Card>
  );
}

function UseCard({ repo, view, spec, pkgName }: { repo: Repo; view: View; spec: FormatSpec; pkgName: string }) {
  const info = useQuery(infoQuery);
  const ctx = snippetContext(info.data, repo);
  const snippets = [...spec.install(ctx, { name: pkgName }, view), ...ociSnippets(ctx, view, view.ociRepository)];
  return (
    <Card>
      <CardHeader title="Use this version" description="Native client, or any OCI tool through the facade" />
      <CardBody>
        <SnippetTabs snippets={snippets} />
      </CardBody>
    </Card>
  );
}

function attachmentIcon(a: Attachment) {
  if (a.kind === "signature") return <ShieldCheck className="size-4 text-success" />;
  if (a.kind === "attestation" || a.kind === "provenance") return <BadgeCheck className="size-4 text-primary" />;
  return <FileText className="size-4 text-muted-foreground" />;
}

const verificationTone = { verified: "success", untrusted: "warning", unsigned: "neutral", invalid: "danger", unsupported: "outline" } as const;

const verificationHelp: Record<Attachment["verification"], string> = {
  verified: "A trusted key signed it, for its predicate type, and what it signed names this variant",
  untrusted: "Signed, but by a key the server does not trust",
  unsigned: "Nothing signed it",
  invalid: "Its signature does not verify",
  unsupported: "The server cannot verify it: keyless, notation, a message signature, or too large",
};

function AttachmentsCard({ format, repoName, pkgName, view }: { format: string; repoName: string; pkgName: string; view: View }) {
  const list = useQuery(attachmentsQuery(format, repoName, pkgName, view.version, view.variant));
  return (
    <Card>
      <CardHeader
        icon={<ShieldCheck />}
        title="Signatures, SBOMs and attestations"
        description="OCI referrers of this manifest, as the index labels them; Lajstrom passes them through unchanged"
      />
      {list.isError ? (
        isUnavailable(list.error) ? (
          <EmptyState title="Not listed by this server" className="py-6">
            This server version does not list attachments; they are on /v2 as referrers of the manifest.
          </EmptyState>
        ) : (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        )
      ) : !list.data ? (
        <CardBody>
          <Skeleton className="h-16" />
        </CardBody>
      ) : list.data.attachments.length === 0 ? (
        <EmptyState title="Nothing attached" className="py-6">
          No signature, SBOM or attestation references this manifest. Sign it in CI with{" "}
          <code className="font-mono text-foreground">cosign sign</code>; it shows up here.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {list.data.attachments.map((a) => {
            const identity = a.annotations["dev.sigstore.cosign/certificate-identity"];
            const issuer = a.annotations["dev.sigstore.cosign/certificate-oidc-issuer"];
            return (
              <li key={`${a.digest}:${a.layer}`} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5">{attachmentIcon(a)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {referrerKinds[a.artifactType]?.label ?? a.kind}
                    {a.tool ? <Badge tone="outline">{a.toolVersion ? `${a.tool} ${a.toolVersion}` : a.tool}</Badge> : null}
                    <Tooltip content={a.reason ? `${verificationHelp[a.verification]}: ${a.reason}` : verificationHelp[a.verification]}>
                      <span>
                        <Badge tone={verificationTone[a.verification] ?? "neutral"}>
                          {a.verification}
                          {a.signedBy ? ` by ${a.signedBy}` : ""}
                        </Badge>
                      </span>
                    </Tooltip>
                  </div>
                  <div className="mt-0.5 font-mono text-xs break-all text-muted-foreground">{a.artifactType}</div>
                  {identity ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Keyless, identity <span className="font-mono break-all text-foreground">{identity}</span>
                      {issuer ? (
                        <>
                          {" "}
                          from <span className="font-mono break-all">{issuer}</span>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {a.predicateType ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Predicate <span className="font-mono text-foreground">{a.predicateType}</span>
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-muted-foreground">
                  <CopyText value={a.digest} display={shortDigest(a.digest)} label="referrer digest" />
                  <span>
                    {formatBytes(a.size)} · <RelativeTime iso={a.createdAt ?? a.indexedAt} />
                  </span>
                </div>
              </li>
            );
          })}
          {list.data.truncated ? (
            <li className="px-4 py-2 text-xs text-muted-foreground">More attachments than the server lists at once; the oldest are left out.</li>
          ) : null}
        </ul>
      )}
    </Card>
  );
}

function MetadataCard({ view, spec }: { view: View; spec: FormatSpec }) {
  const rows = spec.metadataRows(view.metadata);
  return (
    <Card>
      <CardHeader icon={<Braces />} title="Metadata" description="metadata.json, the metadata layer: read without unpacking the package" />
      <CardBody>
        {view.metadata === null ? (
          <p className="flex items-start gap-2 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            No readable metadata layer. The index row comes from the manifest annotations alone.
          </p>
        ) : (
          <>
            {rows.length ? <MetadataRows rows={rows} /> : null}
            <details className="group mt-3">
              <summary className="cursor-pointer text-sm text-primary select-none hover:underline">Show metadata.json</summary>
              <CodeBlock className="mt-2" caption="metadata.json" code={JSON.stringify(view.metadata, null, 2)} />
            </details>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function ManifestCard({ view }: { view: View }) {
  const info = useQuery(infoQuery);
  const host = info.data?.externalURL ? new URL(info.data.externalURL).host : window.location.host;
  if (!view.annotations || !view.manifest) {
    // The server reads the manifest from the registry on /v2, not in /api/v1 (lajstrom/lajstrom#951).
    return (
      <Card>
        <CardHeader icon={<Tags />} title="Manifest" description="On /v2 under the version's OCI repository; the registry stays the source of truth" />
        <CardBody>
          <CodeBlock caption="shell" code={`oras manifest fetch --pretty ${host}/${view.ociRepository}@${view.digest}`} />
        </CardBody>
      </Card>
    );
  }
  const entries = Object.entries(view.annotations);
  return (
    <Card>
      <CardHeader
        icon={<Tags />}
        title="Manifest annotations"
        description="The lajstrom.* keys are enough to rebuild the index: the registry stays the source of truth"
      />
      <Table>
        <TBody>
          {entries.map(([k, v]) => (
            <TR key={k}>
              <TD className="w-0 font-mono text-xs whitespace-nowrap text-muted-foreground">{k}</TD>
              <TD className="font-mono text-xs break-all">{v}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <CardBody className="border-t border-border">
        <details>
          <summary className="cursor-pointer text-sm text-primary select-none hover:underline">Show the OCI manifest</summary>
          <CodeBlock className="mt-2" caption={`${view.manifest.mediaType} · ${shortDigest(view.digest)}`} code={JSON.stringify(view.manifest, null, 2)} />
        </details>
      </CardBody>
    </Card>
  );
}

function DetailsCard({ view }: { view: View }) {
  const info = useQuery(infoQuery);
  const host = info.data?.externalURL ? new URL(info.data.externalURL).host : window.location.host;
  const reference = `${view.ociRepository}:${view.tag}`;
  const source = view.annotations?.["org.opencontainers.image.source"];
  const revision = view.annotations?.["org.opencontainers.image.revision"];
  return (
    <Card>
      <CardHeader icon={<Fingerprint />} title="Manifest" />
      <CardBody>
        <Properties className="grid-cols-[5.5rem_1fr]">
          <Property label="Tag">
            <CopyText value={view.tag} label="tag" />
          </Property>
          <Property label="Digest">
            <CopyText value={view.digest} display={shortDigest(view.digest, 16)} label="digest" />
          </Property>
          <Property label="Reference">
            <CopyText value={`${host}/${reference}`} display={reference} label="OCI reference" />
          </Property>
          <Property label="Type">
            <span className="font-mono text-xs break-all">{view.artifactType}</span>
          </Property>
          {view.variant ? <Property label="Variant">{view.variant}</Property> : null}
          <Property label="Size">
            {formatBytes(view.size)} in {view.files.length} file{view.files.length === 1 ? "" : "s"}
          </Property>
          <Property label="Published">
            <Tooltip content={formatDateTime(view.publishedAt)}>
              <span>
                <RelativeTime iso={view.publishedAt} />
              </span>
            </Tooltip>
          </Property>
          <Property label="Indexed">
            <RelativeTime iso={view.indexedAt} />
          </Property>
          <Property label="By">
            <Principal value={view.uploadedBy} />
          </Property>
          {source ? (
            <Property label="Source">
              <a href={source} className="break-all text-primary hover:underline" target="_blank" rel="noreferrer">
                {source.replace(/^https?:\/\//, "")}
              </a>
              {revision ? <span className="font-mono text-xs text-muted-foreground"> @ {revision.slice(0, 7)}</span> : null}
            </Property>
          ) : null}
        </Properties>
      </CardBody>
    </Card>
  );
}

function AttributesCard({ view, format }: { view: View; format: string }) {
  const attrs = Object.entries(view.attrs).filter(([k]) => k.startsWith(`lajstrom.${format}.`));
  if (!attrs.length) return null;
  return (
    <Card>
      <CardHeader title="Attributes" description="lajstrom.<format>.* annotations" />
      <CardBody>
        <Properties className="grid-cols-[7rem_1fr]">
          {attrs.map(([k, v]) => (
            <Property key={k} label={<span className="font-mono text-xs">{k}</span>}>
              <span className="font-mono text-xs break-all">{v}</span>
            </Property>
          ))}
        </Properties>
      </CardBody>
    </Card>
  );
}
