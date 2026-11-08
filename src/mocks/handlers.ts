// The mock /api/v1. Paths and status codes follow docs/api-proposal.md; errors use the
// envelope of docs/spec/http-routing.md §4.

import { delay, http, HttpResponse, type PathParams } from "msw";

import type { ApiErrorBody } from "@/api/types";

import { authenticate, createToken, revokeToken, type Refusal } from "./auth";
import * as db from "./db";
import { getPersona, setPersona } from "./persona";

function fail(status: number, code: ApiErrorBody["error"]["code"], message: string) {
  return HttpResponse.json<ApiErrorBody>({ error: { code, message } }, { status });
}

/** 401 with the Basic challenge, as the server answers it on /api/ (docs/auth.md). */
function unauthorized(message: string) {
  return HttpResponse.json<ApiErrorBody>(
    { error: { code: "FORBIDDEN", message } },
    { status: 401, headers: { "WWW-Authenticate": 'Basic realm="lajstrom"' } },
  );
}

function refusal(r: Refusal) {
  return fail(r.status, r.code, r.message);
}

type Resolver = Parameters<typeof http.get>[1];

/** Answers like the server: a short latency, then the authentication every route does
 * (docs/auth.md). The persona is set after the latency, right before the resolver reads the
 * database, so that concurrent requests do not see each other's principal. */
function answered(resolver: Resolver): Resolver {
  return async (info) => {
    await latency();
    const authn = authenticate(info.request);
    if ("refused" in authn) return unauthorized("credentials are needed: the ones sent were refused");
    setPersona(authn.principal);
    return resolver(info);
  };
}

const get = (path: string, resolver: Resolver) => http.get(path, answered(resolver));
const post = (path: string, resolver: Resolver) => http.post(path, answered(resolver));
const del = (path: string, resolver: Resolver) => http.delete(path, answered(resolver));

/** The JSON body, or a 400 like the server's for a body that is not JSON. */
async function body(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** A user's own tokens, or anyone's for the admin (docs/api.md, Tokens: who may). */
function ownOr403(user: string): Response | null {
  const me = getPersona();
  if (me === "anonymous") return unauthorized("credentials are needed");
  return me === user || db.isAdmin(me) ? null : fail(403, "FORBIDDEN", `the tokens of ${user} are ${user}'s or the admin's`);
}

/** Mimic network and database time, so loading states are visible but short. */
async function latency() {
  await delay(90 + Math.floor(Math.random() * 220));
}

function decode(v: PathParams[string]): string {
  const s = typeof v === "string" ? v : v ? [...v].join("/") : "";
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The repo of the path, or a 404 that does not tell whether it exists (rbac.md §3). */
function repoOr404(params: PathParams): db.MockRepo | Response {
  const repo = db.getRepo(decode(params.format), decode(params.repo));
  return repo ?? fail(404, "NOT_FOUND", `repo ${decode(params.format)}/${decode(params.repo)} not found`);
}

function adminOr403(): Response | null {
  return db.isAdmin() ? null : fail(403, "FORBIDDEN", "this needs the admin role (system resource, rbac.md §2)");
}

const num = (v: string | null, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : fallback;
};

export const handlers = [
  get("*/-/version", async () => {
    const { version, commit, date } = db.serverInfo;
    return HttpResponse.json({ version, commit, date });
  }),

  get("*/api/v1/info", async () => {
    return HttpResponse.json(db.serverInfo);
  }),

  get("*/api/v1/whoami", async () => {
    if (getPersona() === "anonymous") return unauthorized("credentials are needed");
    return HttpResponse.json(db.whoami());
  }),

  get("*/api/v1/repos", async ({ request }) => {
    const format = new URL(request.url).searchParams.get("format");
    const repos = db.listRepos().filter((r) => !format || r.format === format);
    return HttpResponse.json({ repos });
  }),

  get("*/api/v1/repos/:format/:repo", async ({ params }) => {
    const repo = repoOr404(params);
    return repo instanceof Response ? repo : HttpResponse.json(repo);
  }),

  get("*/api/v1/repos/:format/:repo/packages", async ({ params, request }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    const sp = new URL(request.url).searchParams;
    return HttpResponse.json(
      db.listPackages(repo, {
        q: sp.get("q") ?? undefined,
        attr: sp.getAll("attr"),
        sort: sp.get("sort") ?? undefined,
        order: sp.get("order") ?? undefined,
        limit: num(sp.get("limit"), 50),
        cursor: sp.get("cursor") ?? undefined,
        dir: sp.has("dir") ? (sp.get("dir") ?? "") : null,
      }),
    );
  }),

  get("*/api/v1/repos/:format/:repo/packages/:name", async ({ params }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    const pkg = db.getPackage(repo, decode(params.name));
    return pkg ? HttpResponse.json(pkg) : fail(404, "NOT_FOUND", `package ${decode(params.name)} not found in ${repo.prefix}`);
  }),

  get("*/api/v1/repos/:format/:repo/packages/:name/versions", async ({ params }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    const versions = db.listVersions(repo, decode(params.name));
    return versions
      ? HttpResponse.json({ versions })
      : fail(404, "NOT_FOUND", `package ${decode(params.name)} not found in ${repo.prefix}`);
  }),

  get("*/api/v1/repos/:format/:repo/packages/:name/versions/:digest", async ({ params }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    const v = db.getVersion(repo, decode(params.name), decode(params.digest));
    return v ? HttpResponse.json(v) : fail(404, "NOT_FOUND", `manifest ${decode(params.digest)} not found`);
  }),

  get("*/api/v1/repos/:format/:repo/reindex", async ({ params }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    if (!repo.permissions.includes("manage")) return fail(403, "FORBIDDEN", "the reindex report needs manage on the repo");
    return HttpResponse.json(db.reindexReport(repo));
  }),

  get("*/api/v1/repos/:format/:repo/sessions", async ({ params }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    return HttpResponse.json({ sessions: db.listSessions(repo) });
  }),

  get("*/api/v1/repos/:format/:repo/deploy-tokens", async ({ params }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    if (!repo.permissions.includes("manage")) return fail(403, "FORBIDDEN", "deploy tokens need manage on the repo");
    return HttpResponse.json({ tokens: db.tokens.filter((t) => t.kind === "deploy" && t.repo === repo.prefix) });
  }),

  get("*/api/v1/search", async ({ request }) => {
    const sp = new URL(request.url).searchParams;
    return HttpResponse.json(db.search(sp.get("q") ?? "", sp.get("format"), num(sp.get("limit"), 20)));
  }),

  get("*/api/v1/registries", async () => {
    return adminOr403() ?? HttpResponse.json({ registries: db.listRegistries() });
  }),

  get("*/api/v1/audit", async ({ request }) => {
    const denied = adminOr403();
    if (denied) return denied;
    const sp = new URL(request.url).searchParams;
    return HttpResponse.json(
      db.listAudit({
        repo: sp.get("repo") ?? undefined,
        principal: sp.get("principal") ?? undefined,
        action: sp.get("action") ?? undefined,
        since: sp.get("since") ?? undefined,
        until: sp.get("until") ?? undefined,
        limit: num(sp.get("limit"), 50),
        cursor: sp.get("cursor") ?? undefined,
      }),
    );
  }),

  get("*/api/v1/users", async () => {
    return adminOr403() ?? HttpResponse.json({ users: db.users });
  }),

  get("*/api/v1/bindings", async () => {
    return adminOr403() ?? HttpResponse.json({ bindings: db.bindings });
  }),

  get("*/api/v1/tokens", async () => {
    return adminOr403() ?? HttpResponse.json({ tokens: db.tokens });
  }),

  get("*/api/v1/users/:name/tokens", async ({ params }) => {
    const user = decode(params.name);
    if (!db.users.some((u) => u.name === user)) return fail(404, "NOT_FOUND", `user ${user} not found`);
    const denied = ownOr403(user);
    if (denied) return denied;
    return HttpResponse.json({ tokens: db.tokens.filter((t) => t.kind === "pat" && t.user === user) });
  }),

  post("*/api/v1/users/:name/tokens", async ({ params, request }) => {
    const user = decode(params.name);
    if (!db.users.some((u) => u.name === user)) return fail(404, "NOT_FOUND", `user ${user} not found`);
    const denied = ownOr403(user);
    if (denied) return denied;
    const created = createToken({ user }, await body(request));
    if ("status" in created) return refusal(created);
    return HttpResponse.json(created, { status: 201, headers: { Location: `/api/v1/users/${user}/tokens/${created.id}` } });
  }),

  del("*/api/v1/users/:name/tokens/:id", async ({ params }) => {
    const user = decode(params.name);
    if (!db.users.some((u) => u.name === user)) return fail(404, "NOT_FOUND", `user ${user} not found`);
    const denied = ownOr403(user);
    if (denied) return denied;
    return revokeToken({ user }, Number(decode(params.id)))
      ? new HttpResponse(null, { status: 204 })
      : fail(404, "NOT_FOUND", `user ${user} has no token ${decode(params.id)}`);
  }),

  post("*/api/v1/repos/:format/:repo/deploy-tokens", async ({ params, request }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    if (!repo.permissions.includes("manage")) return fail(403, "FORBIDDEN", "deploy tokens need manage on the repo");
    const created = createToken({ repo: repo.prefix }, await body(request));
    if ("status" in created) return refusal(created);
    return HttpResponse.json(created, { status: 201, headers: { Location: `/api/v1/repos/${repo.prefix}/deploy-tokens/${created.id}` } });
  }),

  del("*/api/v1/repos/:format/:repo/deploy-tokens/:id", async ({ params }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    if (!repo.permissions.includes("manage")) return fail(403, "FORBIDDEN", "deploy tokens need manage on the repo");
    return revokeToken({ repo: repo.prefix }, Number(decode(params.id)))
      ? new HttpResponse(null, { status: 204 })
      : fail(404, "NOT_FOUND", `${repo.prefix} has no deploy token ${decode(params.id)}`);
  }),

  get("*/api/v1/*", async () => {
    return fail(404, "NOT_FOUND", "no such endpoint in the mock API");
  }),
];
