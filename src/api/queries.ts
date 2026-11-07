import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { apiGet, apiPath } from "./client";
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

export const infoQuery = queryOptions({
  queryKey: ["info"],
  queryFn: ({ signal }) => apiGet<ServerInfo>(apiPath("info"), undefined, signal),
  staleTime: Infinity,
});

export const whoamiQuery = queryOptions({
  queryKey: ["whoami"],
  queryFn: ({ signal }) => apiGet<WhoAmI>(apiPath("whoami"), undefined, signal),
  staleTime: 5 * 60_000,
});

export const reposQuery = queryOptions({
  queryKey: ["repos"],
  queryFn: ({ signal }) => apiGet<{ repos: Repo[] }>(apiPath("repos"), undefined, signal).then((r) => r.repos),
});

export const repoQuery = (format: string, repo: string) =>
  queryOptions({
    queryKey: ["repos", format, repo],
    queryFn: ({ signal }) => apiGet<Repo>(apiPath("repos", format, repo), undefined, signal),
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

export const tokensQuery = queryOptions({
  queryKey: ["tokens"],
  queryFn: ({ signal }) => apiGet<{ tokens: Token[] }>(apiPath("tokens"), undefined, signal).then((r) => r.tokens),
});
