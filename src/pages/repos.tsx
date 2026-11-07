import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Boxes, Database, HardDrive, Package, Upload } from "lucide-react";
import { useMemo } from "react";

import { reposQuery, whoamiQuery } from "@/api/queries";
import type { FormatName, Repo } from "@/api/types";
import { AccessBadge, ErrorState, FormatMark, PageHeader, RelativeTime } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/input";
import { EmptyState, Segmented, Skeleton } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { formatBytes, formatNumber } from "@/lib/format";
import { formatOrder, formats } from "@/lib/formats";

type Search = { format?: string; q?: string };

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 shadow-card">
      <div className="flex size-8 items-center justify-center rounded-md bg-primary-soft text-primary-soft-foreground [&_svg]:size-4">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <Tooltip content={hint}>
          <div className="truncate text-base font-semibold tabular">{value}</div>
        </Tooltip>
      </div>
    </div>
  );
}

export function ReposPage() {
  const search = useSearch({ strict: false }) as Search;
  const navigate = useNavigate();
  const repos = useQuery(reposQuery);
  const who = useQuery(whoamiQuery);
  const format = search.format ?? "all";
  const q = search.q ?? "";

  const setSearch = (patch: Partial<Search>) =>
    void navigate({ to: "/", search: (prev: Search) => ({ ...prev, ...patch }), replace: true });

  const all = useMemo(() => repos.data ?? [], [repos.data]);
  const filtered = useMemo(
    () =>
      all
        .filter((r) => format === "all" || r.format === format)
        .filter((r) => !q || r.prefix.includes(q.toLowerCase()))
        .sort((a, b) => formatOrder.indexOf(a.format) - formatOrder.indexOf(b.format) || a.name.localeCompare(b.name)),
    [all, format, q],
  );

  const totals = useMemo(() => {
    const t = { packages: 0, versions: 0, size: 0, last: null as string | null, registries: new Set<string>() };
    for (const r of all) {
      t.packages += r.stats.packages;
      t.versions += r.stats.versions;
      t.size += r.stats.size;
      t.registries.add(r.registry);
      if (r.stats.lastPushAt && (!t.last || r.stats.lastPushAt > t.last)) t.last = r.stats.lastPushAt;
    }
    return t;
  }, [all]);

  const counts = (f: FormatName) => all.filter((r) => r.format === f).length;

  return (
    <>
      <PageHeader
        title="Repositories"
        description="Every artifact lives in your OCI registry; Lajstrom serves it through the native protocol of its format."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {repos.isPending ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[62px]" />)
        ) : (
          <>
            <Stat icon={<Boxes />} label="Repositories" value={all.length} hint={`${totals.registries.size} backend registries`} />
            <Stat icon={<Package />} label="Packages" value={formatNumber(totals.packages)} hint={`${formatNumber(totals.versions)} versions`} />
            <Stat icon={<HardDrive />} label="Stored in registries" value={formatBytes(totals.size)} hint="Sum of file layers; blobs are deduplicated by the registry" />
            <Stat icon={<Upload />} label="Last publish" value={<RelativeTime iso={totals.last} />} />
          </>
        )}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Segmented
            aria-label="Format"
            value={format}
            onChange={(v) => setSearch({ format: v === "all" ? undefined : v })}
            options={[
              { value: "all", label: "All", count: all.length },
              ...formatOrder.map((f) => ({ value: f, label: formats[f].label, count: counts(f) })),
            ]}
          />
          <SearchInput
            value={q}
            onValueChange={(v) => setSearch({ q: v || undefined })}
            placeholder="Filter repositories"
            className="ml-auto w-full sm:w-64"
          />
        </div>

        {repos.isError ? (
          <ErrorState error={repos.error} onRetry={() => void repos.refetch()} />
        ) : repos.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Database />} title={all.length ? "No repositories match" : "No repositories you can read"}>
            {all.length
              ? "Try another format or clear the filter."
              : "Ask an admin for a binding, or sign in. Repositories with anonymous read show up for everyone."}
          </EmptyState>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Repository</TH>
                <TH className="text-right">Packages</TH>
                <TH className="text-right">Versions</TH>
                <TH className="text-right">Size</TH>
                <TH>Registry</TH>
                <TH>Access</TH>
                <TH>Last publish</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((r) => (
                <RepoRow key={r.prefix} repo={r} showWrite={!(who.data?.admin ?? true)} />
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}

function RepoRow({ repo, showWrite }: { repo: Repo; showWrite: boolean }) {
  const navigate = useNavigate();
  const spec = formats[repo.format];
  return (
    <TR
      className="cursor-pointer transition-colors hover:bg-surface"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button")) return;
        void navigate({ to: "/$format/$repo", params: { format: repo.format, repo: repo.name } });
      }}
    >
      <TD>
        <div className="flex items-center gap-2.5">
          <FormatMark format={repo.format} />
          <Link
            to="/$format/$repo"
            params={{ format: repo.format, repo: repo.name }}
            className="font-medium hover:underline"
          >
            <span className="text-muted-foreground">{repo.format}/</span>
            {repo.name}
          </Link>
          {repo.kind !== "hosted" ? <Badge tone="outline">{repo.kind}</Badge> : null}
          {showWrite && repo.permissions.includes("write") ? (
            <Tooltip content={`You can publish here (${repo.permissions.join(", ")})`}>
              <Badge tone="primary">can publish</Badge>
            </Tooltip>
          ) : null}
        </div>
      </TD>
      <TD className="text-right tabular">
        <Tooltip content={`${repo.stats.packages} ${repo.stats.packages === 1 ? spec.noun.one : spec.noun.many}`}>
          <span>{formatNumber(repo.stats.packages)}</span>
        </Tooltip>
      </TD>
      <TD className="text-right tabular">
        <Tooltip content={`${repo.stats.manifests} manifests (one per version and ${spec.variantLabel?.toLowerCase() ?? "version"})`}>
          <span>{formatNumber(repo.stats.versions)}</span>
        </Tooltip>
      </TD>
      <TD className="text-right tabular whitespace-nowrap">{formatBytes(repo.stats.size)}</TD>
      <TD>
        <span className="font-mono text-xs text-muted-foreground">{repo.registry}</span>
      </TD>
      <TD>
        <AccessBadge repo={repo} />
      </TD>
      <TD className="text-muted-foreground">
        <RelativeTime iso={repo.stats.lastPushAt} />
      </TD>
    </TR>
  );
}
