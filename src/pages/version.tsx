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

import { infoQuery, packageQuery, repoQuery, versionQuery, versionsQuery } from "@/api/queries";
import type { Referrer, Repo, VersionDetail } from "@/api/types";
import { ErrorState, FormatMark, PageHeader, Principal, RelativeTime } from "@/components/common";
import { SnippetTabs } from "@/components/snippets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CodeBlock, CopyText } from "@/components/ui/code-block";
import { EmptyState, Properties, Property, Segmented, Skeleton } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { config } from "@/app/config";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/cn";
import { formatBytes, formatDateTime, shortDigest } from "@/lib/format";
import { formatSpec, snippetContext, type FormatSpec } from "@/lib/formats";
import { variantShort } from "@/lib/variants";
import { ociSnippets, referrerKinds } from "@/lib/formats/common";

import { MetadataRows } from "./metadata";
import { groupVersions, packageCrumbs } from "./package-model";

type Props = { format: string; repoName: string; name: string; version: string };

export function VersionPage({ format, repoName, name, version }: Props) {
  const spec = formatSpec(format);
  const search = useSearch({ strict: false }) as { variant?: string };
  const navigate = useNavigate();
  const repo = useQuery(repoQuery(format, repoName));
  const pkg = useQuery(packageQuery(format, repoName, name));
  const versions = useQuery(versionsQuery(format, repoName, name));

  const group = versions.data ? groupVersions(versions.data).find((g) => g.version === version) : undefined;
  const selected = group?.manifests.find((m) => m.variant === search.variant) ?? group?.manifests[0];
  const detail = useQuery({ ...versionQuery(format, repoName, name, selected?.digest ?? ""), enabled: Boolean(selected) });
  const isLatest = pkg.data?.latestVersion === version;
  const isRaw = format === "raw";

  const crumbs = packageCrumbs(format, repoName, name, version);
  if (versions.isError || (versions.data && !group)) {
    return (
      <>
        <PageHeader crumbs={crumbs} title={`${name} ${version}`} />
        <Card>
          {versions.isError ? (
            <ErrorState error={versions.error} onRetry={() => void versions.refetch()} />
          ) : (
            <EmptyState icon={<AlertTriangle />} title="Version not found">
              {name} has no version {version} in {format}/{repoName}.
            </EmptyState>
          )}
        </Card>
      </>
    );
  }

  const d = detail.data;
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
            {selected?.attrs["pypi.nonstandard"] === "true" ? (
              <Tooltip content="Not a PEP 440 version: accepted and flagged lajstrom.pypi.nonstandard=true">
                <Badge tone="warning">non-standard version</Badge>
              </Tooltip>
            ) : null}
            {selected?.degraded ? (
              <Tooltip content="The metadata layer is missing or unreadable; reindex kept the row from annotations only">
                <Badge tone="warning">degraded</Badge>
              </Tooltip>
            ) : null}
          </>
        }
        description={
          selected ? (
            <span>
              Published <RelativeTime iso={selected.createdAt} /> by <Principal value={selected.uploadedBy} />
              {group && group.manifests.length > 1 ? ` · ${group.manifests.length} ${spec.variantLabel?.toLowerCase()}s` : null}
            </span>
          ) : (
            <Skeleton className="h-4 w-72" />
          )
        }
      />

      {group && group.manifests.length > 1 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{spec.variantLabel}:</span>
          <Segmented
            aria-label={spec.variantLabel ?? "Variant"}
            value={selected?.variant ?? ""}
            onChange={(v) => void navigate({ to: ".", search: { variant: v }, replace: true })}
            options={group.manifests.map((m) => ({
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

      {detail.isError ? (
        <Card>
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        </Card>
      ) : !d || !repo.data || !pkg.data ? (
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
            <FilesCard detail={d} spec={spec} />
            <UseCard repo={repo.data} detail={d} spec={spec} pkgName={name} ociRepository={pkg.data.ociRepository} />
            <SupplyChainCard detail={d} />
            <MetadataCard detail={d} spec={spec} />
            <ManifestCard detail={d} />
          </div>
          <aside className="min-w-0 space-y-4">
            <DetailsCard detail={d} />
            <AttributesCard detail={d} />
          </aside>
        </div>
      )}
    </>
  );
}

function FilesCard({ detail, spec }: { detail: VersionDetail; spec: FormatSpec }) {
  const info = useQuery(infoQuery);
  const base = (info.data?.externalURL ?? window.location.origin).replace(/\/$/, "");
  const mock = config().mock;
  return (
    <Card>
      <CardHeader
        icon={<FileText />}
        title="Files"
        description={`${detail.files.length} file layer${detail.files.length === 1 ? "" : "s"} · ${formatBytes(detail.size)}${detail.metadata ? " · plus metadata.json" : ""}`}
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
          {detail.files.map((f) => {
            const url = base + f.path;
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
                  {mock ? (
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

function UseCard({
  repo,
  detail,
  spec,
  pkgName,
  ociRepository,
}: {
  repo: Repo;
  detail: VersionDetail;
  spec: FormatSpec;
  pkgName: string;
  ociRepository: string;
}) {
  const info = useQuery(infoQuery);
  const pkg = useQuery(packageQuery(repo.format, repo.name, pkgName));
  const ctx = snippetContext(info.data, repo);
  if (!pkg.data) return null;
  const snippets = [...spec.install(ctx, pkg.data, detail), ...ociSnippets(ctx, detail, ociRepository)];
  return (
    <Card>
      <CardHeader title="Use this version" description="Native client, or any OCI tool through the facade" />
      <CardBody>
        <SnippetTabs snippets={snippets} />
      </CardBody>
    </Card>
  );
}

function referrerIcon(r: Referrer) {
  if (r.kind === "signature") return <ShieldCheck className="size-4 text-success" />;
  if (r.kind === "attestation") return <BadgeCheck className="size-4 text-primary" />;
  return <FileText className="size-4 text-muted-foreground" />;
}

function SupplyChainCard({ detail }: { detail: VersionDetail }) {
  const refs = detail.referrerList;
  return (
    <Card>
      <CardHeader
        icon={<ShieldCheck />}
        title="Signatures and attestations"
        description="OCI referrers whose subject is this manifest; Lajstrom passes them through unchanged"
      />
      {refs.length === 0 ? (
        <EmptyState title="Nothing attached" className="py-6">
          No signature, SBOM or attestation references this manifest. Sign it in CI with{" "}
          <code className="font-mono text-foreground">cosign sign</code>; it shows up here.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {refs.map((r) => {
            const identity = r.annotations["dev.sigstore.cosign/certificate-identity"];
            const issuer = r.annotations["dev.sigstore.cosign/certificate-oidc-issuer"];
            const predicate = r.annotations["in-toto.io/predicate-type"];
            return (
              <li key={r.digest} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5">{referrerIcon(r)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {referrerKinds[r.artifactType]?.label ?? r.artifactType}
                    {r.tool ? <Badge tone="outline">{r.tool}</Badge> : null}
                  </div>
                  <div className="mt-0.5 font-mono text-xs break-all text-muted-foreground">{r.artifactType}</div>
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
                  {predicate ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Predicate <span className="font-mono text-foreground">{predicate}</span>
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-muted-foreground">
                  <CopyText value={r.digest} display={shortDigest(r.digest)} label="referrer digest" />
                  <span>
                    {formatBytes(r.size)} · <RelativeTime iso={r.createdAt} />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function MetadataCard({ detail, spec }: { detail: VersionDetail; spec: FormatSpec }) {
  const rows = spec.metadataRows(detail.metadata);
  return (
    <Card>
      <CardHeader icon={<Braces />} title="Metadata" description="metadata.json, the metadata layer: read without unpacking the package" />
      <CardBody>
        {detail.metadata === null ? (
          <p className="flex items-start gap-2 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            No readable metadata layer. The index row comes from the manifest annotations alone.
          </p>
        ) : (
          <>
            {rows.length ? <MetadataRows rows={rows} /> : null}
            <details className="group mt-3">
              <summary className="cursor-pointer text-sm text-primary select-none hover:underline">Show metadata.json</summary>
              <CodeBlock className="mt-2" caption="metadata.json" code={JSON.stringify(detail.metadata, null, 2)} />
            </details>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function ManifestCard({ detail }: { detail: VersionDetail }) {
  const entries = Object.entries(detail.annotations);
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
          <CodeBlock className="mt-2" caption={`${detail.manifest.mediaType} · ${shortDigest(detail.digest)}`} code={JSON.stringify(detail.manifest, null, 2)} />
        </details>
      </CardBody>
    </Card>
  );
}

function DetailsCard({ detail }: { detail: VersionDetail }) {
  const source = detail.annotations["org.opencontainers.image.source"];
  const revision = detail.annotations["org.opencontainers.image.revision"];
  return (
    <Card>
      <CardHeader icon={<Fingerprint />} title="Manifest" />
      <CardBody>
        <Properties className="grid-cols-[5.5rem_1fr]">
          <Property label="Tag">
            <CopyText value={detail.tag} label="tag" />
          </Property>
          <Property label="Digest">
            <CopyText value={detail.digest} display={shortDigest(detail.digest, 16)} label="digest" />
          </Property>
          <Property label="Reference">
            <CopyText value={detail.ociReference} display={detail.ociReference.split("/").slice(1).join("/")} label="OCI reference" />
          </Property>
          <Property label="Type">
            <span className="font-mono text-xs break-all">{detail.artifactType}</span>
          </Property>
          {detail.variant ? <Property label="Variant">{detail.variant}</Property> : null}
          <Property label="Size">
            {formatBytes(detail.size)} in {detail.fileCount} file{detail.fileCount === 1 ? "" : "s"}
          </Property>
          <Property label="Created">
            <Tooltip content={formatDateTime(detail.createdAt)}>
              <span>
                <RelativeTime iso={detail.createdAt} />
              </span>
            </Tooltip>
          </Property>
          <Property label="Indexed">
            <RelativeTime iso={detail.indexedAt} />
          </Property>
          <Property label="By">
            <Principal value={detail.uploadedBy} />
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

function AttributesCard({ detail }: { detail: VersionDetail }) {
  const attrs = Object.entries(detail.attrs);
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
