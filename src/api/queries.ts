import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { ApiError, apiGet, apiPath, isUnavailable } from "./client";
import type {
  AuditPage,
  Binding,
  PackageDetail,
  PackageList,
  PublishSession,
  Registry,
  ReindexReport,
  Repo,
  SearchResult,
  ServerInfo,
  Token,
  User,
  VersionDetail,
  VersionSummary,
  WhoAmI,
} from "./types";

/** A repo as the server answers it: everything but `prefix`, which the UI derives. */
type RepoAnswer = Omit<Repo, "prefix"> & { prefix?: string };

/** `<format>/<name>` is the repo's path on every protocol (docs/api.md, Repos). */
export function normalizeRepo(r: RepoAnswer): Repo {
  return { ...r, prefix: r.prefix ?? `${r.format}/${r.name}` };
}

/** GET /api/v1/info (proposed), or, from a server without it, what /-/version tells. */
export const infoQuery = queryOptions({
  queryKey: ["info"],
  queryFn: async ({ signal }): Promise<ServerInfo> => {
    try {
      return await apiGet<ServerInfo>(apiPath("info"), undefined, signal);
    } catch (err) {
      if (!isUnavailable(err)) throw err;
    }
    const v = await apiGet<Pick<ServerInfo, "version" | "commit" | "date">>("/-/version", undefined, signal);
    return { ...v, externalURL: window.location.origin, formats: [] };
  },
  staleTime: Infinity,
});

const anonymous: WhoAmI = { principal: "anonymous", kind: "anonymous", name: "" };

/** The caller. The server answers 401 to a request without credentials: that is anonymous. */
export const whoamiQuery = queryOptions({
  queryKey: ["whoami"],
  queryFn: async ({ signal }) => {
    try {
      return await apiGet<WhoAmI>(apiPath("whoami"), undefined, signal);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return anonymous;
      throw err;
    }
  },
  staleTime: 5 * 60_000,
});

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

export const reindexQuery = (format: string, repo: string) =>
  queryOptions({
    queryKey: ["repos", format, repo, "reindex"],
    queryFn: ({ signal }) => apiGet<ReindexReport>(apiPath("repos", format, repo, "reindex"), undefined, signal),
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

export type AuditParams = { repo?: string; principal?: string; action?: string; since?: string; cursor?: string };

export const auditQuery = (params: AuditParams) =>
  queryOptions({
    queryKey: ["audit", params],
    queryFn: ({ signal }) => apiGet<AuditPage>(apiPath("audit"), { ...params, limit: 50 }, signal),
    placeholderData: keepPreviousData,
  });

export const usersQuery = queryOptions({
  queryKey: ["users"],
  queryFn: ({ signal }) => apiGet<{ users: User[] }>(apiPath("users"), undefined, signal).then((r) => r.users),
});

export const bindingsQuery = queryOptions({
  queryKey: ["bindings"],
  queryFn: ({ signal }) => apiGet<{ bindings: Binding[] }>(apiPath("bindings"), undefined, signal).then((r) => r.bindings),
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
