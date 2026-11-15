// The changes of a proxy repo (docs/adr/0003-changes-realistic-by-default.md): a purge of its
// upstream cache and a prefetch are realistic. Both are jobs on the server that the server
// answers when they have ended (docs/api.md), so there is no status to poll: the change is
// pending until the answer, and a prefetch's answer is its result.

import { useMutation } from "@tanstack/react-query";

import { realistic } from "@/api/change";
import { prefetch, purgeUpstreamCache } from "@/api/mutations";
import type { PrefetchItemResult, PrefetchRequest, Repo } from "@/api/types";
import { can } from "@/lib/access";
import { notify } from "@/lib/notices";

/** Whether the UI offers the purge and the prefetch: a proxy, manage (rbac.md §7). */
export const managesUpstream = (repo: Repo) => repo.kind === "proxy" && can(repo, "manage");

/** One item a line, or separated by commas or spaces; what follows # is a comment; each once,
 * in order. */
export function listItems(text: string): string[] {
  const items = text
    .split("\n")
    .map((line) => line.replace(/#.*/, ""))
    .flatMap((line) => line.split(/[\s,]+/))
    .filter(Boolean);
  return [...new Set(items)];
}

/** At most this many names or images a request (docs/api.md, Prefetch). */
export const PREFETCH_MAX = 100;

/** The body of a prefetch: images and their platforms for an oci proxy, names otherwise. */
export function prefetchRequest(repo: Pick<Repo, "format">, items: string[], opts: { platforms: string[]; allVersions: boolean }): PrefetchRequest {
  if (repo.format === "oci") return { images: items, ...(opts.platforms.length ? { platforms: opts.platforms } : {}) };
  return { names: items, ...(opts.allVersions ? { allVersions: true } : {}) };
}

/** How many results have each status, in the order fetched, held, shared, failed. */
export function countResults(results: PrefetchItemResult[]): [PrefetchItemResult["status"], number][] {
  const order: PrefetchItemResult["status"][] = ["fetched", "held", "shared", "failed"];
  return order.map((s) => [s, results.filter((r) => r.status === s).length] as [PrefetchItemResult["status"], number]).filter(([, n]) => n > 0);
}

/** The names, or the images, of the failed results, each once: what a second run sends. */
export const failedItems = (results: PrefetchItemResult[]) => [...new Set(results.filter((r) => r.status === "failed").map((r) => r.name))];

/** Purges the proxy's cache of its upstream, or of one name; the audit log shows it. */
export function usePurge(repo: Repo) {
  const { onSuccess: refetch } = realistic(["audit"]);
  return useMutation({
    mutationFn: (name: string) => purgeUpstreamCache(repo.format, repo.name, name.trim() || undefined),
    onSuccess: async (data, name, result, context) => {
      await refetch(data, name, result, context);
      notify({
        tone: "success",
        title: name.trim() ? `Purged ${name.trim()} from the cache of ${repo.prefix}` : `Purged the cache of ${repo.prefix}`,
        description: `The next read asks the upstream ${repo.upstream?.name ?? ""} again; what the repo fetched stays.`,
      });
    },
  });
}

/** Prefetches names or images; the answer holds a result per version, or per image, platform
 * and blob. What the repo holds, and its audit rows, are fetched again. */
export function usePrefetch(repo: Repo) {
  return useMutation({
    mutationFn: (req: PrefetchRequest) => prefetch(repo.format, repo.name, req),
    ...realistic(["repos", repo.format, repo.name], ["audit"]),
  });
}
