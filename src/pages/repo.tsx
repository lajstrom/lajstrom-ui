import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ArrowRight, ChevronRight, File, Folder, FolderOpen, PackageOpen, Plug, Search as SearchIcon } from "lucide-react";
import type { ReactNode } from "react";

import { callerQuery, infoQuery, packagesQuery, repoQuery } from "@/api/queries";
import type { PackageList, PackageSummary, Repo } from "@/api/types";
import { AccessBadge, CursorPagination, ErrorState, FormatMark, PageHeader, RelativeTime } from "@/components/common";
import { DemoCommandsNote, SnippetTabs } from "@/components/snippets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/input";
import { EmptyState, Segmented, Skeleton } from "@/components/ui/misc";
import { SortableTH, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { can } from "@/lib/access";
import { cn } from "@/lib/cn";
import { formatBytes, formatNumber, pluralize, shortDigest } from "@/lib/format";
import { formatSpec, snippetContext, type FormatSpec } from "@/lib/formats";
import { facetParam, variantShort } from "@/lib/variants";

import { RepoActivity, RepoDetails, RepoMaintenance } from "./repo-tabs";

export type RepoSearch = {
  tab?: "packages" | "connect" | "details" | "maintenance" | "activity";
  /** Names that start with it: the server's filter of the package list. */
  prefix?: string;
  sort?: "name" | "updated" | "versions" | "size";
  order?: "asc" | "desc";
  cursor?: string;
  dir?: string;
  suite?: string;
  component?: string;
  arch?: string;
  packaging?: string;
};


function useRepoSearch() {
  const search = useSearch({ strict: false }) as RepoSearch;
  const navigate = useNavigate();
  const set = (patch: Partial<RepoSearch>, opts: { resetCursor?: boolean } = { resetCursor: true }) =>
    void navigate({
      to: ".",
      search: (prev: RepoSearch) => ({ ...prev, ...(opts.resetCursor ? { cursor: undefined } : {}), ...patch }),
      replace: true,
    });
  return [search, set] as const;
}

export function RepoPage() {
  const { format = "", repo: name = "" } = useParams({ strict: false }) as { format?: string; repo?: string };
  const [search, setSearch] = useRepoSearch();
  const repo = useQuery(repoQuery(format, name));
  const who = useQuery(callerQuery);
  const spec = formatSpec(format);
  const tab = search.tab ?? "packages";

  if (repo.isError) {
    return (
      <>
        <PageHeader crumbs={[{ label: "Repositories", to: "/" }, { label: `${format}/${name}` }]} title={`${format}/${name}`} />
        <Card>
          <ErrorState error={repo.error} onRetry={() => void repo.refetch()} />
        </Card>
      </>
    );
  }

  const r = repo.data;
  const canManage = r ? can(r, "manage") : false;
  const tabs: { id: NonNullable<RepoSearch["tab"]>; label: string; show: boolean }[] = [
    { id: "packages", label: spec.noun.many[0]!.toUpperCase() + spec.noun.many.slice(1), show: true },
    { id: "connect", label: "Connect", show: true },
    { id: "details", label: "Details", show: true },
    { id: "maintenance", label: "Maintenance", show: canManage },
    { id: "activity", label: "Activity", show: who.data?.admin ?? false },
  ];

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Repositories", to: "/" }, { label: format, to: "/", search: { format } }, { label: name }]}
        icon={<FormatMark format={format} className="h-6 min-w-10 text-[11px]" />}
        title={name}
        badges={
          r ? (
            <>
              <AccessBadge repo={r} />
              <Badge tone="outline">{r.kind}</Badge>
            </>
          ) : null
        }
        description={
          r ? (
            <span className="tabular">
              {r.stats ? (
                <>
                  {pluralize(r.stats.packages, spec.noun.one, spec.noun.many)} · {pluralize(r.stats.versions, "version")} ·{" "}
                  {formatBytes(r.stats.size)} ·{" "}
                </>
              ) : null}
              {r.registry ? (
                <>
                  stored in <span className="font-mono text-foreground">{r.registry}</span>
                </>
              ) : (
                <>a group of {r.group?.members.join(", ")}</>
              )}
              {r.stats ? (
                <>
                  {" "}
                  · last publish <RelativeTime iso={r.stats.lastPushAt} />
                </>
              ) : null}
            </span>
          ) : (
            <Skeleton className="h-4 w-96" />
          )
        }
        actions={
          tab !== "connect" ? (
            <Button onClick={() => setSearch({ tab: "connect" }, { resetCursor: false })}>
              <Plug />
              Connect a client
            </Button>
          ) : null
        }
      />

      <div role="tablist" aria-label="Repository sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-border scrollbar-thin">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              onClick={() => setSearch({ tab: t.id === "packages" ? undefined : t.id }, { resetCursor: false })}
              className={cn(
                "-mb-px shrink-0 cursor-pointer border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
                tab === t.id && "border-primary text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
      </div>

      {!r ? (
        <Card>
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        </Card>
      ) : tab === "connect" ? (
        <ConnectTab repo={r} spec={spec} />
      ) : tab === "details" ? (
        <RepoDetails repo={r} />
      ) : tab === "maintenance" && canManage ? (
        <RepoMaintenance repo={r} />
      ) : tab === "activity" ? (
        <RepoActivity repo={r} />
      ) : (
        <PackagesTab repo={r} spec={spec} search={search} setSearch={setSearch} />
      )}
    </>
  );
}

function ConnectTab({ repo, spec }: { repo: Repo; spec: FormatSpec }) {
  const info = useQuery(infoQuery);
  const facets = useQuery({ ...packagesQuery(repo.format, repo.name, { limit: 1 }), select: (d: PackageList) => d.facets });
  const ctx = snippetContext(info.data, repo, facets.data);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="space-y-4">
        <DemoCommandsNote host={ctx.host} />
        {spec.connect(ctx).map((g) => (
          <Card key={g.title}>
            <CardHeader title={g.title} description={g.description} />
            <CardBody>
              <SnippetTabs snippets={g.snippets} noDemoLine />
            </CardBody>
          </Card>
        ))}
      </div>
      <aside className="space-y-4">
        <Card>
          <CardHeader title="Credentials" />
          <CardBody className="space-y-2 text-sm text-muted-foreground">
            <p>
              One credential works for every protocol: your user name with a{" "}
              <strong className="text-foreground">personal access token</strong>, or a{" "}
              <strong className="text-foreground">deploy token</strong> bound to this repo for CI.
            </p>
            <p>
              The snippets read them from <code className="font-mono text-foreground">$LAJSTROM_USER</code> and{" "}
              <code className="font-mono text-foreground">$LAJSTROM_TOKEN</code>.
            </p>
            {!ctx.readNeedsAuth ? (
              <p className="text-success">Downloads from this repo need no credentials (anonymous read).</p>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Endpoint" />
          <CardBody className="space-y-1 text-sm">
            <div className="font-mono text-xs break-all">
              {ctx.baseUrl}/{repo.format}/{repo.name}/
            </div>
            <p className="text-xs text-muted-foreground">
              One URL per repo; OCI clients use{" "}
              <span className="font-mono">
                {ctx.host}/{repo.format}/{repo.name}/…
              </span>{" "}
              through the facade.
            </p>
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}

function QuickConnect({ repo, spec, facets }: { repo: Repo; spec: FormatSpec; facets: PackageList["facets"] | undefined }) {
  const info = useQuery(infoQuery);
  const [, setSearch] = useRepoSearch();
  const ctx = snippetContext(info.data, repo, facets);
  const first = spec.connect(ctx)[0];
  if (!first) return null;
  return (
    <Card className="mb-4">
      <CardHeader
        icon={<Plug />}
        title={first.title}
        description={first.description}
        actions={
          <Button variant="ghost" size="sm" onClick={() => setSearch({ tab: "connect" }, { resetCursor: false })}>
            All options
            <ArrowRight />
          </Button>
        }
      />
      <CardBody>
        <SnippetTabs snippets={first.snippets.slice(0, 3)} />
      </CardBody>
    </Card>
  );
}

type PackagesTabProps = {
  repo: Repo;
  spec: FormatSpec;
  search: RepoSearch;
  setSearch: (patch: Partial<RepoSearch>, opts?: { resetCursor?: boolean }) => void;
};

function PackagesTab({ repo, spec, search, setSearch }: PackagesTabProps) {
  const isRaw = repo.format === "raw";
  const browsing = isRaw && !search.prefix;
  const facetValues = search as Record<string, string | undefined>;
  const attr = spec.facets
    .map((f) => [f.key, facetValues[facetParam(f.key)]] as const)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:${v}`);
  const params = {
    prefix: search.prefix,
    attr,
    sort: search.sort,
    order: search.order,
    cursor: search.cursor,
    dir: browsing ? (search.dir ?? "") : undefined,
  };
  const pkgs = useQuery(packagesQuery(repo.format, repo.name, params));
  const data = pkgs.data;
  const sort = search.sort ?? "name";
  const order = search.order ?? (sort === "name" ? "asc" : "desc");
  const sortBy = (col: NonNullable<RepoSearch["sort"]>) =>
    setSearch({
      sort: col === "name" && sort !== "name" ? undefined : col,
      order: sort === col ? (order === "asc" ? "desc" : "asc") : col === "name" ? undefined : "desc",
    });
  const filtered = Boolean(search.prefix || attr.length);
  // Facets in the answer: the server takes the proposed filters, sort and directories
  // (lajstrom/lajstrom#955); without them the list is by name, filtered by prefix.
  const proposed = data?.facets !== undefined;
  const facts = data?.packages.some((p) => p.versions !== undefined) ?? false;
  const inDirs = browsing && data?.directories !== undefined;
  const sorting = proposed ? { sort, order, sortBy } : null;

  return (
    <>
      {(repo.stats?.packages ?? 0) > 0 ? <QuickConnect repo={repo} spec={spec} facets={data?.facets} /> : null}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <SearchInput
            value={search.prefix ?? ""}
            onValueChange={(v) => setSearch({ prefix: v || undefined })}
            placeholder={isRaw ? "Paths that start with…" : `${spec.noun.many[0]!.toUpperCase()}${spec.noun.many.slice(1)} that start with…`}
            className="w-full sm:w-72"
          />
          {spec.facets.map((f) => {
            const values = data?.facets?.[f.key] ?? [];
            if (values.length < 2) return null;
            const p = facetParam(f.key);
            return (
              <Segmented
                key={f.key}
                aria-label={f.label}
                value={facetValues[p] ?? "__all"}
                onChange={(v) => setSearch({ [p]: v === "__all" ? undefined : v })}
                options={[
                  { value: "__all", label: <span className="text-muted-foreground">{f.label}: all</span> },
                  ...values.map((v) => ({ value: v.value, label: v.value, count: v.count })),
                ]}
              />
            );
          })}
          {filtered ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSearch(Object.fromEntries([["prefix", undefined], ...spec.facets.map((f) => [facetParam(f.key), undefined])]))}
            >
              Clear filters
            </Button>
          ) : null}
          <span className={cn("ml-auto text-xs text-muted-foreground tabular", pkgs.isFetching && "animate-skeleton")}>
            {data
              ? `${pluralize(data.packages.length + (data.directories?.length ?? 0), inDirs ? "item" : spec.noun.one, inDirs ? "items" : spec.noun.many)}${data.next ? " on this page" : ""}`
              : null}
          </span>
        </div>

        {inDirs ? <RawPath dir={search.dir ?? ""} onDir={(dir) => setSearch({ dir: dir || undefined })} /> : null}

        {pkgs.isError ? (
          <ErrorState error={pkgs.error} onRetry={() => void pkgs.refetch()} />
        ) : !data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : data.packages.length === 0 && !(data.directories?.length ?? 0) ? (
          filtered ? (
            <EmptyState icon={<SearchIcon />} title={`No ${spec.noun.many} match`}>
              Nothing matches the search or the filters. Clear them to see everything.
            </EmptyState>
          ) : (
            <EmptyRepo repo={repo} spec={spec} />
          )
        ) : (
          <Table>
            <THead>
              <TR>
                <Sortable col="name" sorting={sorting}>
                  {isRaw ? "Path" : "Name"}
                </Sortable>
                {facts ? (
                  <>
                    <TH>{isRaw ? "Current version" : "Latest version"}</TH>
                    {spec.columns.map((c) => (
                      <TH key={c.key}>{c.label}</TH>
                    ))}
                    <Sortable col="versions" sorting={sorting} className="text-right">
                      Versions
                    </Sortable>
                    <Sortable col="size" sorting={sorting} className="text-right">
                      Size
                    </Sortable>
                    <Sortable col="updated" sorting={sorting}>
                      Updated
                    </Sortable>
                  </>
                ) : (
                  <TH>First published</TH>
                )}
              </TR>
            </THead>
            <TBody>
              {data.directories?.map((d) => (
                <TR key={d.path} className="cursor-pointer hover:bg-surface" onClick={() => setSearch({ dir: d.path })}>
                  <TD colSpan={2 + spec.columns.length}>
                    <span className="flex items-center gap-2 font-medium">
                      <Folder className="size-4 fill-primary/15 text-primary" />
                      {d.name}/
                    </span>
                  </TD>
                  <TD className="text-right text-muted-foreground tabular">{pluralize(d.files, "file")}</TD>
                  <TD className="text-right tabular whitespace-nowrap">{formatBytes(d.size)}</TD>
                  <TD className="text-muted-foreground">
                    <RelativeTime iso={d.updatedAt} />
                  </TD>
                </TR>
              ))}
              {data.packages.map((p) => (
                <PackageRow key={p.name} repo={repo} spec={spec} pkg={p} dir={inDirs ? (search.dir ?? "") : ""} facts={facts} />
              ))}
            </TBody>
          </Table>
        )}
        {data ? (
          <CursorPagination
            shown={data.packages.length}
            next={data.next}
            cursor={search.cursor}
            onCursor={(cursor) => setSearch({ cursor }, { resetCursor: false })}
            noun={spec.noun.many}
          />
        ) : null}
      </Card>
    </>
  );
}

function RawPath({ dir, onDir }: { dir: string; onDir: (dir: string) => void }) {
  const parts = dir.split("/").filter(Boolean);
  return (
    <div className="flex items-center gap-1 border-b border-border bg-surface px-4 py-2 text-sm">
      <FolderOpen className="mr-1 size-4 text-muted-foreground" />
      <button type="button" onClick={() => onDir("")} className="cursor-pointer rounded px-1 font-medium hover:bg-muted">
        /
      </button>
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-1">
          <ChevronRight className="size-3.5 text-muted-foreground" />
          <button
            type="button"
            onClick={() => onDir(parts.slice(0, i + 1).join("/") + "/")}
            className="cursor-pointer rounded px-1 font-medium hover:bg-muted"
          >
            {p}
          </button>
        </span>
      ))}
    </div>
  );
}

type SortCol = NonNullable<RepoSearch["sort"]>;
type Sorting = { sort: SortCol; order: "asc" | "desc"; sortBy: (col: SortCol) => void } | null;

/** A column header that sorts when the server takes the proposed sort, else a plain one. */
function Sortable({ col, sorting, className, children }: { col: SortCol; sorting: Sorting; className?: string; children: ReactNode }) {
  if (!sorting) return <TH className={className}>{children}</TH>;
  return (
    <SortableTH active={sorting.sort === col} direction={sorting.order} onSort={() => sorting.sortBy(col)} className={className}>
      {children}
    </SortableTH>
  );
}

function PackageRow({ repo, spec, pkg, dir, facts }: { repo: Repo; spec: FormatSpec; pkg: PackageSummary; dir: string; facts: boolean }) {
  const navigate = useNavigate();
  const isRaw = repo.format === "raw";
  const label: ReactNode = isRaw ? pkg.name.slice(dir.length) : pkg.name;
  const latestVariants = pkg.latestVariants ?? [];
  const open = () => void navigate({ to: "/$format/$repo/$", params: { format: repo.format, repo: repo.name, _splat: pkg.name } });
  return (
    <TR
      className="cursor-pointer transition-colors hover:bg-surface"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button")) return;
        open();
      }}
    >
      <TD className="max-w-[28rem]">
        <div className="flex min-w-0 items-center gap-2">
          {isRaw ? <File className="size-4 shrink-0 text-muted-foreground" /> : null}
          <div className="min-w-0">
            <Link
              to="/$format/$repo/$"
              params={{ format: repo.format, repo: repo.name, _splat: pkg.name }}
              className={cn("block truncate font-medium hover:underline", repo.format === "maven" && "font-mono text-[13px]")}
            >
              {label}
            </Link>
            {pkg.summary ? <div className="truncate text-xs text-muted-foreground">{pkg.summary}</div> : null}
          </div>
        </div>
      </TD>
      {facts ? (
        <>
          <TD>
            <div className="flex flex-wrap items-center gap-1.5">
              <Tooltip content={isRaw ? "Version of a raw file: the first 16 hex digits of its sha256" : null}>
                <span className="font-mono text-[13px]">{isRaw ? shortDigest(pkg.latestVersion ?? "", 8) : pkg.latestVersion}</span>
              </Tooltip>
              {latestVariants.length > 0 ? (
                <Tooltip content={`${spec.variantLabel}: ${latestVariants.join(", ")}`}>
                  <span className="flex gap-1">
                    {latestVariants.slice(0, 3).map((v) => (
                      <Badge key={v} tone="outline" shape="square" className="px-1.5 font-mono text-[11px]">
                        {variantShort(v)}
                      </Badge>
                    ))}
                    {latestVariants.length > 3 ? (
                      <Badge tone="outline" shape="square" className="px-1.5 text-[11px]">
                        +{latestVariants.length - 3}
                      </Badge>
                    ) : null}
                  </span>
                </Tooltip>
              ) : null}
            </div>
          </TD>
          {spec.columns.map((c) => (
            <TD key={c.key} className="font-mono text-xs text-muted-foreground">
              {pkg.attrs?.[c.key] ?? "—"}
            </TD>
          ))}
          <TD className="text-right tabular">{pkg.versions === undefined ? "—" : formatNumber(pkg.versions)}</TD>
          <TD className="text-right tabular whitespace-nowrap">{pkg.size === undefined ? "—" : formatBytes(pkg.size)}</TD>
          <TD className="text-muted-foreground">
            <RelativeTime iso={pkg.updatedAt ?? null} />
          </TD>
        </>
      ) : (
        <TD className="text-muted-foreground">
          <RelativeTime iso={pkg.createdAt} />
        </TD>
      )}
    </TR>
  );
}


function EmptyRepo({ repo, spec }: { repo: Repo; spec: FormatSpec }) {
  const info = useQuery(infoQuery);
  const ctx = snippetContext(info.data, repo);
  const publish = spec.connect(ctx).find((g) => /publish|upload|deploy|push/i.test(g.title));
  return (
    <EmptyState icon={<PackageOpen />} title={`No ${spec.noun.many} yet`} className="py-10">
      <p>Publish the first one; it lands in the registry and shows up here.</p>
      {publish ? <SnippetTabs snippets={publish.snippets.slice(0, 2)} className="mt-4 text-left" /> : null}
    </EmptyState>
  );
}
