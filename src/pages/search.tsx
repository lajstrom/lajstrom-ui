import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Fingerprint, Search as SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { searchQuery } from "@/api/queries";
import { ErrorState, FormatMark, PageHeader, RelativeTime } from "@/components/common";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/input";
import { EmptyState, Segmented, Skeleton } from "@/components/ui/misc";
import { shortDigest } from "@/lib/format";
import { formatOrder, formats } from "@/lib/formats";

export function SearchPage() {
  const search = useSearch({ strict: false }) as { q?: string; format?: string };
  const navigate = useNavigate();
  const [input, setInput] = useState(search.q ?? "");
  const q = search.q ?? "";
  const results = useQuery(searchQuery(q, search.format, 100));

  useEffect(() => {
    const t = setTimeout(() => {
      if (input !== q) void navigate({ to: "/search", search: (p: Record<string, unknown>) => ({ ...p, q: input || undefined }), replace: true });
    }, 200);
    return () => clearTimeout(t);
  }, [input, q, navigate]);

  return (
    <>
      <PageHeader
        title="Search"
        description="Package names and summaries across every repository you can read. A sha256 digest, or its first 8+ hex digits, finds the manifest or file it belongs to."
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <SearchInput
            autoFocus
            value={input}
            onValueChange={setInput}
            placeholder="requests, nginx, com.acme, sha256:9f3a…"
            className="w-full sm:w-96"
          />
          <Segmented
            aria-label="Format"
            value={search.format ?? "all"}
            onChange={(v) => void navigate({ to: "/search", search: { q: q || undefined, format: v === "all" ? undefined : v }, replace: true })}
            options={[{ value: "all", label: "All formats" }, ...formatOrder.map((f) => ({ value: f, label: formats[f].label }))]}
          />
          {results.data && q ? (
            <span className="ml-auto text-xs text-muted-foreground">
              {results.data.total} result{results.data.total === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        {!q ? (
          <EmptyState icon={<SearchIcon />} title="Search everything">
            Type a name, or paste a digest from a CI log or a vulnerability report.
          </EmptyState>
        ) : results.isError ? (
          <ErrorState error={results.error} onRetry={() => void results.refetch()} />
        ) : !results.data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : results.data.hits.length === 0 ? (
          <EmptyState icon={<SearchIcon />} title={`Nothing matches “${q}”`}>
            Search covers repositories you can read. Digests match by prefix.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {results.data.hits.map((h) =>
              h.kind === "package" ? (
                <li key={`${h.format}/${h.repo}/${h.name}`}>
                  <Link
                    to="/$format/$repo/$"
                    params={{ format: h.format, repo: h.repo, _splat: h.name }}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface"
                  >
                    <FormatMark format={h.format} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{h.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">{h.latestVersion}</span>
                      </div>
                      {h.summary ? <div className="truncate text-xs text-muted-foreground">{h.summary}</div> : null}
                    </div>
                    <div className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
                      <div className="font-mono">
                        {h.format}/{h.repo}
                      </div>
                      <RelativeTime iso={h.updatedAt} />
                    </div>
                  </Link>
                </li>
              ) : (
                <li key={`${h.digest}:${h.matched}`}>
                  <Link
                    to="/$format/$repo/$"
                    params={{ format: h.format, repo: h.repo, _splat: `${h.name}/-/${h.version}` }}
                    search={h.variant ? { variant: h.variant } : {}}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface"
                  >
                    <Fingerprint className="size-4 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {h.name} <span className="font-mono text-sm text-muted-foreground">{h.version}</span>
                        {h.variant ? <span className="text-sm text-muted-foreground"> ({h.variant})</span> : null}
                      </div>
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {h.matched === "manifest" ? "manifest" : `file ${h.matched}`} · {shortDigest(h.digest, 20)}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {h.format}/{h.repo}
                    </span>
                  </Link>
                </li>
              ),
            )}
          </ul>
        )}
      </Card>
    </>
  );
}
