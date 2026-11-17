import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { ApiError, apiGet, apiGetTagged, apiPath, isUnavailable } from "./client";
import type {
  AttachmentList,
  AuditList,
  Binding,
  CIPolicy,
  CIPolicyList,
  DeliveryList,
  ManifestList,
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
  Webhook,
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
  /** The server's filter: names that start with it. */
  prefix?: string;
  /** Attribute filters, <full key>:<value>; a sort and its order. */
  attr?: string[];
  sort?: string;
  order?: string;
  /** The keys whose facets the answer has, over the whole repo. */
  facet?: string[];
  cursor?: string;
  limit?: number;
};

export const packagesQuery = (format: string, repo: string, params: PackageParams) =>
  queryOptions({
    queryKey: ["repos", format, repo, "packages", params],
    queryFn: ({ signal }) =>
      apiGet<PackageList>(apiPath("repos", format, repo, "packages"), { ...params, limit: params.limit ?? 50 }, signal),
    placeholderData: keepPreviousData,
  });

/** GET …/packages/{name}; null from a server before it, and the package page
 * derives what it shows from the versions. */
export const packageQuery = (format: string, repo: string, name: string) =>
  queryOptions({
    queryKey: ["repos", format, repo, "package", name],
    queryFn: async ({ signal }) => {
      try {
        return await apiGet<PackageDetail>(apiPath("repos", format, repo, "packages", name), undefined, signal);
      } catch (err) {
        if (isUnavailable(err)) return null;
        throw err;
      }
    },
  });

/** Every version of a package, newest first. */
export const versionsQuery = (format: string, repo: string, name: string) =>
  queryOptions({
    queryKey: ["repos", format, repo, "package", name, "versions"],
    queryFn: ({ signal }) => allPages<VersionSummary>(apiPath("repos", format, repo, "packages", name, "versions"), "versions", signal),
  });

/** One version with all its variants; the page picks one. */
export const versionQuery = (format: string, repo: string, name: string, version: string) =>
  queryOptions({
    queryKey: ["repos", format, repo, "package", name, "versions", version],
    queryFn: ({ signal }) => apiGet<VersionDetail>(apiPath("repos", format, repo, "packages", name, "versions", version), undefined, signal),
  });

/** The attachments of a version, newest first, of one variant. */
export const attachmentsQuery = (format: string, repo: string, name: string, version: string, variant: string) =>
  queryOptions({
    queryKey: ["repos", format, repo, "package", name, "versions", version, "attachments", variant],
    queryFn: ({ signal }) =>
      apiGet<AttachmentList>(apiPath("repos", format, repo, "packages", name, "versions", version, "attachments"), { variant }, signal),
  });

/** The manifest of one variant of a version, read from the registry by the server; null from a
 * server before GET …/manifest, or when the registry does not answer (503): the page then names
 * the command that reads it on /v2. */
export const manifestQuery = (format: string, repo: string, name: string, version: string, variant: string) =>
  queryOptions({
    queryKey: ["repos", format, repo, "package", name, "versions", version, "manifest", variant],
    queryFn: async ({ signal }) => {
      try {
        const list = await apiGet<ManifestList>(
          apiPath("repos", format, repo, "packages", name, "versions", version, "manifest"),
          { variant },
          signal,
        );
        return list.manifests[0] ?? null;
      } catch (err) {
        if (isUnavailable(err) || (err instanceof ApiError && err.status === 503)) return null;
        throw err;
      }
    },
    // The digest names it: the answer of a variant does not change.
    staleTime: Infinity,
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

/** The open deploy sessions of a maven repo. */
export const sessionsQuery = (format: string, repo: string) =>
  queryOptions({
    queryKey: ["repos", format, repo, "sessions"],
    queryFn: ({ signal }) => allPages<PublishSession>(apiPath("repos", format, repo, "sessions"), "sessions", signal),
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

/** One live user, by its name or its uid (admin). Below usersQuery's key: a change that fetches
 * the users again fetches it too. */
export const userQuery = (user: string) =>
  queryOptions({
    queryKey: ["users", user],
    queryFn: ({ signal }) => apiGet<User>(apiPath("users", user), undefined, signal),
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

/** The deploy tokens over a mask (admin), or those over one mask as it was written. */
export const maskTokensQuery = (repoMask: string) =>
  queryOptions({
    queryKey: ["deploy-tokens", repoMask],
    queryFn: ({ signal }) =>
      apiGet<{ tokens: Token[] }>(apiPath("deploy-tokens"), { repoMask: repoMask || undefined }, signal).then((r) => r.tokens),
  });

/** Every token (proposed, admin): GET /api/v1/tokens. */
export const tokensQuery = queryOptions({
  queryKey: ["tokens"],
  queryFn: ({ signal }) => apiGet<{ tokens: Token[] }>(apiPath("tokens"), undefined, signal).then((r) => r.tokens),
});

// Webhooks (docs/api.md, Webhooks): a repo's under the repo, for manage on it; every mask's
// under /api/v1/webhooks, for the admin role. The routes below each are the same.

/** Where the routes of webhooks are: under a repo, the webhooks whose mask is the repo; null,
 * /api/v1/webhooks, those of every mask. */
export type WebhookScope = { format: string; repo: string } | null;

/** The path of the scope's webhooks, or of one of them and what is below it. */
export function webhooksPath(scope: WebhookScope, ...rest: (string | number)[]): string {
  return scope ? apiPath("repos", scope.format, scope.repo, "webhooks", ...rest) : apiPath("webhooks", ...rest);
}

/** The query key of the scope's list; the delivery logs of its webhooks are below it. */
export const webhooksKey = (scope: WebhookScope): string[] => (scope ? ["repos", scope.format, scope.repo, "webhooks"] : ["webhooks"]);

/** The webhooks of the scope, by id; never a secret. */
export const webhooksQuery = (scope: WebhookScope) =>
  queryOptions({
    queryKey: webhooksKey(scope),
    queryFn: ({ signal }) => apiGet<{ webhooks: Webhook[] }>(webhooksPath(scope), undefined, signal).then((r) => r.webhooks),
  });

/** One page of a webhook's delivery log, newest first. */
export const deliveriesQuery = (scope: WebhookScope, id: number, cursor: string | undefined) =>
  queryOptions({
    queryKey: [...webhooksKey(scope), id, "deliveries", cursor ?? ""],
    queryFn: ({ signal }) => apiGet<DeliveryList>(webhooksPath(scope, id, "deliveries"), { cursor, limit: 20 }, signal),
    placeholderData: keepPreviousData,
  });

// CI trust policies (docs/api.md, CI trust policies): the admin's. The list has no revisions; a
// change is made on the policy as its GET answered it, with its ETag.

/** The key of the policies; each policy's is below it, so that a change fetches both again. */
export const ciPoliciesKey = ["ci-policies"];

/** Every policy, those of the configuration first, and, proposed, the server's issuers. */
export const ciPoliciesQuery = queryOptions({
  queryKey: ciPoliciesKey,
  queryFn: ({ signal }) => apiGet<CIPolicyList>(apiPath("ci", "policies"), undefined, signal),
});

/** One policy and its ETag, the revision that a change of it names in If-Match; a policy of the
 * configuration has none. */
export const ciPolicyQuery = (name: string) =>
  queryOptions({
    queryKey: [...ciPoliciesKey, name],
    queryFn: ({ signal }) => apiGetTagged<CIPolicy>(apiPath("ci", "policies", name), signal),
  });
