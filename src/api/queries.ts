import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { ApiError, apiGet, apiPath, isUnavailable } from "./client";
import type {
  AuditList,
  Binding,
  PackageDetail,
  PackageList,
  PublishSession,
  Registry,
  ReindexRun,
  Repo,
  SearchResult,
  ServerInfo,
  Token,
  User,
  VersionDetail,
  VersionSummary,
} from "./types";

/** A repo as the server answers it: everything but `prefix`, which the UI derives. */
type RepoAnswer = Omit<Repo, "prefix"> & { prefix?: string };

/** `<format>/<name>` is the repo's path on every protocol (docs/api.md, Repos). */
export function normalizeRepo(r: RepoAnswer): Repo {
  return { ...r, prefix: r.prefix ?? `${r.format}/${r.name}` };
}

/** Every page of one of the server's lists, following `next`: users and bindings, which an
 * admin reads whole. */
async function allPages<T>(path: string, key: string, signal: AbortSignal): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 100; pages++) {
    const page = await apiGet<Record<string, unknown> & { next?: string }>(path, { cursor }, signal);
    items.push(...((page[key] as T[] | undefined) ?? []));
    cursor = page.next;
    if (!cursor) break;
  }
  return items;
}

/** GET /api/v1/info. It answers without credentials too, so it is also who the caller is: a
 * change of session resets every query (main.tsx). */
export const infoQuery = queryOptions({
  queryKey: ["info"],
  queryFn: ({ signal }) => apiGet<ServerInfo>(apiPath("info"), undefined, signal),
  staleTime: Infinity,
});

/** The caller, from /api/v1/info: its principal, and whether it reaches the admin role. */
export const callerQuery = queryOptions({ ...infoQuery, select: (info: ServerInfo) => info.caller });

export const reposQuery = queryOptions({
  queryKey: ["repos"],
  queryFn: ({ signal }) =>
    apiGet<{ repos: RepoAnswer[] }>(apiPath("repos"), undefined, signal).then((r) => r.repos.map(normalizeRepo)),
});

export const repoQuery = (format: string, repo: string) =>
  queryOptions({
    queryKey: ["repos", format, repo],
    queryFn: ({ signal }) => apiGet<RepoAnswer>(apiPath("repos", format, repo), undefined, signal).then(normalizeRepo),
  });

export type PackageParams = {
  q?: string;
  attr?: string[];
  sort?: string;
  order?: "asc" | "desc";
  cursor?: string;
  limit?: number;
  dir?: string;
};

export const packagesQuery = (format: string, repo: string, params: PackageParams) =>
  queryOptions({
    queryKey: ["repos", format, repo, "packages", params],
    queryFn: ({ signal }) =>
      apiGet<PackageList>(apiPath("repos", format, repo, "packages"), { ...params, limit: params.limit ?? 50 }, signal),
    placeholderData: keepPreviousData,
  });

export const packageQuery = (format: string, repo: string, name: string) =>
  queryOptions({
    queryKey: ["repos", format, repo, "package", name],
    queryFn: ({ signal }) => apiGet<PackageDetail>(apiPath("repos", format, repo, "packages", name), undefined, signal),
  });

export const versionsQuery = (format: string, repo: string, name: string) =>
  queryOptions({
    queryKey: ["repos", format, repo, "package", name, "versions"],
    queryFn: ({ signal }) =>
      apiGet<{ versions: VersionSummary[] }>(apiPath("repos", format, repo, "packages", name, "versions"), undefined, signal).then(
        (r) => r.versions,
      ),
  });

export const versionQuery = (format: string, repo: string, name: string, digest: string) =>
  queryOptions({
    queryKey: ["repos", format, repo, "package", name, "versions", digest],
    queryFn: ({ signal }) =>
      apiGet<VersionDetail>(apiPath("repos", format, repo, "packages", name, "versions", digest), undefined, signal),
    staleTime: Infinity, // a manifest never changes: tags are immutable, digests are content.
  });

/** The latest reindex run that covered the repo; null when none has (the server's 404, for a
 * repo the page has already read). */
export const reindexQuery = (format: string, repo: string) =>
  queryOptions({
    queryKey: ["repos", format, repo, "reindex"],
    queryFn: async ({ signal }) => {
      try {
        return await apiGet<ReindexRun>(apiPath("repos", format, repo, "reindex"), undefined, signal);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404 && !isUnavailable(err)) return null;
        throw err;
      }
    },
  });

export const sessionsQuery = (format: string, repo: string) =>
  queryOptions({
    queryKey: ["repos", format, repo, "sessions"],
    queryFn: ({ signal }) =>
      apiGet<{ sessions: PublishSession[] }>(apiPath("repos", format, repo, "sessions"), undefined, signal).then((r) => r.sessions),
  });

export const deployTokensQuery = (format: string, repo: string) =>
  queryOptions({
    queryKey: ["repos", format, repo, "deploy-tokens"],
    queryFn: ({ signal }) =>
      apiGet<{ tokens: Token[] }>(apiPath("repos", format, repo, "deploy-tokens"), undefined, signal).then((r) => r.tokens),
  });

export const searchQuery = (q: string, format?: string, limit = 20) =>
  queryOptions({
    queryKey: ["search", q, format ?? "", limit],
    queryFn: ({ signal }) => apiGet<SearchResult>(apiPath("search"), { q, format, limit }, signal),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

export const registriesQuery = queryOptions({
  queryKey: ["registries"],
  queryFn: ({ signal }) => apiGet<{ registries: Registry[] }>(apiPath("registries"), undefined, signal).then((r) => r.registries),
});

export type AuditParams = { repo?: string; principal?: string; action?: string; state?: string; since?: string; cursor?: string };

export const auditQuery = (params: AuditParams) =>
  queryOptions({
    queryKey: ["audit", params],
    queryFn: ({ signal }) => apiGet<AuditList>(apiPath("audit"), { ...params, limit: 50 }, signal),
    placeholderData: keepPreviousData,
  });

export const usersQuery = queryOptions({
  queryKey: ["users"],
  queryFn: ({ signal }) => allPages<User>(apiPath("users"), "users", signal),
});

export const bindingsQuery = queryOptions({
  queryKey: ["bindings"],
  queryFn: ({ signal }) => allPages<Binding>(apiPath("bindings"), "bindings", signal),
});

/** The personal access tokens of a user, the revoked and expired ones included. */
export const userTokensQuery = (user: string) =>
  queryOptions({
    queryKey: ["users", user, "tokens"],
    queryFn: ({ signal }) => apiGet<{ tokens: Token[] }>(apiPath("users", user, "tokens"), undefined, signal).then((r) => r.tokens),
  });

/** Every token (proposed, admin): GET /api/v1/tokens. */
export const tokensQuery = queryOptions({
  queryKey: ["tokens"],
  queryFn: ({ signal }) => apiGet<{ tokens: Token[] }>(apiPath("tokens"), undefined, signal).then((r) => r.tokens),
});
