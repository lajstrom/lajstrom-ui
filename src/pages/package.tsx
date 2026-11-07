import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangle, Info, Package as PackageIcon } from "lucide-react";
import { useMemo } from "react";

import { infoQuery, packageQuery, repoQuery, versionsQuery } from "@/api/queries";
import type { PackageDetail, Repo } from "@/api/types";
import { ErrorState, FormatMark, PageHeader, Principal, RelativeTime, SignedBadge } from "@/components/common";
import { SnippetTabs } from "@/components/snippets";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyText } from "@/components/ui/code-block";
import { Properties, Property, Skeleton } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { formatBytes, formatNumber, pluralize, shortDigest } from "@/lib/format";
import { formatSpec, snippetContext, type FormatSpec } from "@/lib/formats";
import { variantShort } from "@/lib/variants";

import { MetadataRows } from "./metadata";
import { groupVersions, packageCrumbs, type VersionGroup } from "./package-model";
import { VersionPage } from "./version";

/** /$format/$repo/<package name>[/-/<version>]: the splat keeps raw paths and maven coordinates whole. */
export function PackageRoute() {
  const { format = "", repo = "", _splat = "" } = useParams({ strict: false }) as Record<string, string | undefined>;
  const i = _splat.indexOf("/-/");
  const name = i === -1 ? _splat : _splat.slice(0, i);
  const version = i === -1 ? null : _splat.slice(i + 3);
  return version ? (
    <VersionPage format={format} repoName={repo} name={name} version={version} />
  ) : (
    <PackagePage format={format} repoName={repo} name={name} />
  );
}

function PackagePage({ format, repoName, name }: { format: string; repoName: string; name: string }) {
  const spec = formatSpec(format);
  const repo = useQuery(repoQuery(format, repoName));
  const pkg = useQuery(packageQuery(format, repoName, name));
  const versions = useQuery(versionsQuery(format, repoName, name));
  const groups = useMemo(() => groupVersions(versions.data ?? []), [versions.data]);
  const isRaw = format === "raw";

  if (pkg.isError) {
    return (
      <>
        <PageHeader crumbs={packageCrumbs(format, repoName, name)} title={name} />
        <Card>
          <ErrorState error={pkg.error} onRetry={() => void pkg.refetch()} />
        </Card>
      </>
    );
  }

  const p = pkg.data;
  const nonstandard = versions.data?.some((v) => v.attrs["pypi.nonstandard"] === "true");
  return (
    <>
      <PageHeader
        crumbs={packageCrumbs(format, repoName, name)}
        icon={<FormatMark format={format} className="h-6 min-w-10 text-[11px]" />}
        title={<span className={cn(format === "maven" && "font-mono text-lg")}>{isRaw ? name.split("/").at(-1) : name}</span>}
        badges={
          p?.latestVersion ? (
            <Tooltip content={isRaw ? "Current version: the path resolves to it" : "Latest version"}>
              <Badge tone="primary" className="font-mono">
                {isRaw ? shortDigest(p.latestVersion, 8) : p.latestVersion}
              </Badge>
            </Tooltip>
          ) : null
        }
        description={p ? p.summary : <Skeleton className="h-4 w-80" />}
      />

      {nonstandard ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Some versions are not valid PEP 440 versions. Lajstrom accepted them and flagged them{" "}
            <code className="font-mono">lajstrom.pypi.nonstandard=true</code>; pip may sort them unexpectedly.
          </span>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="min-w-0 self-start">
          <CardHeader
            title="Versions"
            description={
              versions.data
                ? `${pluralize(groups.length, "version")}${spec.variantLabel ? `, ${pluralize(versions.data.length, "manifest")} (one per ${spec.variantLabel.toLowerCase()})` : ""} · tags are immutable`
                : null
            }
          />
          {versions.isError ? (
            <ErrorState error={versions.error} />
          ) : !versions.data ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : (
            <VersionsTable format={format} repo={repoName} name={name} spec={spec} groups={groups} />
          )}
        </Card>

        <aside className="min-w-0 space-y-4">
          {repo.data && p ? <InstallCard repo={repo.data} pkg={p} spec={spec} /> : <Skeleton className="h-40" />}
          {p ? <AboutCard pkg={p} spec={spec} format={format} /> : null}
          {p ? <PackageFacts pkg={p} format={format} repoName={repoName} spec={spec} /> : null}
        </aside>
      </div>
    </>
  );
}

function VersionsTable({
  format,
  repo,
  name,
  spec,
  groups,
}: {
  format: string;
  repo: string;
  name: string;
  spec: FormatSpec;
  groups: VersionGroup[];
}) {
  const navigate = useNavigate();
  const isRaw = format === "raw";
  const open = (g: VersionGroup, variant?: string) =>
    void navigate({
      to: "/$format/$repo/$",
      params: { format, repo, _splat: `${name}/-/${g.version}` },
      search: variant ? { variant } : {},
    });
  return (
    <Table>
      <THead>
        <TR>
          <TH>Version</TH>
          {spec.variantLabel ? <TH>{spec.variantLabel}</TH> : null}
          {format === "apt" ? <TH>Suite</TH> : null}
          <TH className="text-right">Size</TH>
          <TH>Published</TH>
          <TH>By</TH>
        </TR>
      </THead>
      <TBody>
        {groups.map((g, i) => (
          <TR
            key={g.version}
            className="cursor-pointer transition-colors hover:bg-surface"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a,button")) return;
              open(g);
            }}
          >
            <TD>
              <div className="flex items-center gap-2">
                <Link
                  to="/$format/$repo/$"
                  params={{ format, repo, _splat: `${name}/-/${g.version}` }}
                  className="font-mono text-[13px] font-medium hover:underline"
                >
                  {isRaw ? shortDigest(g.version, 16) : g.version}
                </Link>
                {i === 0 ? <Badge tone="primary">{isRaw ? "current" : "latest"}</Badge> : null}
                <SignedBadge count={g.signatures} compact />
                {g.degraded ? (
                  <Tooltip content="Metadata layer missing or unreadable: indexed from annotations only">
                    <Badge tone="warning">degraded</Badge>
                  </Tooltip>
                ) : null}
              </div>
            </TD>
            {spec.variantLabel ? (
              <TD>
                <div className="flex flex-wrap gap-1">
                  {g.manifests.map((m) => (
                    <Tooltip key={m.digest} content={`${m.variant} · tag ${m.tag}`}>
                      <button
                        type="button"
                        onClick={() => open(g, m.variant)}
                        className="cursor-pointer rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                      >
                        {variantShort(m.variant)}
                      </button>
                    </Tooltip>
                  ))}
                </div>
              </TD>
            ) : null}
            {format === "apt" ? (
              <TD className="font-mono text-xs text-muted-foreground">
                {g.manifests[0]?.attrs["deb.suite"]}/{g.manifests[0]?.attrs["deb.component"]}
              </TD>
            ) : null}
            <TD className="text-right tabular whitespace-nowrap">{formatBytes(g.size)}</TD>
            <TD className="text-muted-foreground">
              <RelativeTime iso={g.createdAt} />
            </TD>
            <TD className="text-muted-foreground">
              <Principal value={g.uploadedBy} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function InstallCard({ repo, pkg, spec }: { repo: Repo; pkg: PackageDetail; spec: FormatSpec }) {
  const info = useQuery(infoQuery);
  const ctx = snippetContext(info.data, repo);
  return (
    <Card>
      <CardHeader title={repo.format === "raw" ? "Download" : "Install"} description={repo.format === "raw" ? "Always the current version" : `Latest: ${pkg.latestVersion}`} />
      <CardBody>
        <SnippetTabs snippets={spec.install(ctx, pkg)} />
      </CardBody>
    </Card>
  );
}

function AboutCard({ pkg, spec, format }: { pkg: PackageDetail; spec: FormatSpec; format: string }) {
  const rows = spec.metadataRows(pkg.latestMetadata);
  if (!rows.length) {
    return pkg.latestMetadata === null && format !== "raw" ? (
      <Card>
        <CardHeader title="About" />
        <CardBody className="flex items-start gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          The newest manifest has no readable metadata layer.
        </CardBody>
      </Card>
    ) : null;
  }
  return (
    <Card>
      <CardHeader title="About" description="From the metadata layer of the newest manifest" />
      <CardBody>
        <MetadataRows rows={rows.filter((r) => !["Summary", "Description", "File", "Package type"].includes(r.label))} compact />
      </CardBody>
    </Card>
  );
}

function PackageFacts({ pkg, format, repoName, spec }: { pkg: PackageDetail; format: string; repoName: string; spec: FormatSpec }) {
  const info = useQuery(infoQuery);
  const host = info.data ? new URL(info.data.externalURL).host : "";
  return (
    <Card>
      <CardHeader icon={<PackageIcon />} title={`${spec.noun.one[0]!.toUpperCase()}${spec.noun.one.slice(1)}`} />
      <CardBody>
        <Properties className="grid-cols-[6.5rem_1fr]">
          <Property label="Name">
            <span className="font-mono text-[12.5px] break-all">{pkg.name}</span>
          </Property>
          {pkg.nameOci !== pkg.name ? (
            <Property label="OCI path">
              <Tooltip content="EscapeName of manifest-profile.md §4.1: lowercase, escaped">
                <span className="font-mono text-[12.5px] break-all">{pkg.nameOci}</span>
              </Tooltip>
            </Property>
          ) : null}
          <Property label="OCI repo">
            <CopyText value={`${host}/${pkg.ociRepository}`} display={pkg.ociRepository} label="OCI repository" />
          </Property>
          <Property label="Versions">
            {formatNumber(pkg.versions)}
            {pkg.manifests !== pkg.versions ? <span className="text-muted-foreground"> ({pkg.manifests} manifests)</span> : null}
          </Property>
          <Property label="Total size">{formatBytes(pkg.size)}</Property>
          <Property label="First published">
            <RelativeTime iso={pkg.createdAt} />
          </Property>
          <Property label="Updated">
            <RelativeTime iso={pkg.updatedAt} />
          </Property>
          <Property label="Repository">
            <Link to="/$format/$repo" params={{ format, repo: repoName }} className="text-primary hover:underline">
              {format}/{repoName}
            </Link>
          </Property>
        </Properties>
      </CardBody>
    </Card>
  );
}
