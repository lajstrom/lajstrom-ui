// The mock of the server's /api/v1: the paths and status codes of docs/api.md and
// docs/api-proposal.md, and the error envelope of docs/spec/http-routing.md §4.

import { delay, http, HttpResponse, type PathParams } from "msw";

import type { ApiErrorBody } from "@/api/types";

import { authenticate, createToken, revokeToken, type Refusal } from "./auth";
import * as db from "./db";
import { getPersona, setPersona } from "./persona";

function fail(status: number, code: ApiErrorBody["error"]["code"], message: string) {
  return HttpResponse.json<ApiErrorBody>({ error: { code, message } }, { status });
}

/** 401 with the Basic challenge, as the server answers it: the envelope on /api/, plain text
 * on the frontends (docs/auth.md). */
function unauthorized(message: string, api = true) {
  const challenge = { "WWW-Authenticate": 'Basic realm="lajstrom"' };
  return api
    ? HttpResponse.json<ApiErrorBody>({ error: { code: "UNAUTHENTICATED", message } }, { status: 401, headers: challenge })
    : text(401, message, challenge);
}

/** An error of a protocol frontend: plain text, like the server's. */
function text(status: number, message: string, headers: Record<string, string> = {}) {
  return new HttpResponse(`${message}\n`, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...headers } });
}

/** A repo as the server answers it: without prefix, which the UI derives (src/api/queries.ts). */
function repoJson({ prefix: _prefix, ...repo }: db.MockRepo) {
  return repo;
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
    if ("refused" in authn) {
      return unauthorized("credentials are needed: the ones sent were refused", new URL(info.request.url).pathname.startsWith("/api/"));
    }
    setPersona(authn.principal);
    return resolver(info);
  };
}

const get = (path: string, resolver: Resolver) => http.get(path, answered(resolver));
const post = (path: string, resolver: Resolver) => http.post(path, answered(resolver));
const del = (path: string, resolver: Resolver) => http.delete(path, answered(resolver));
const patch = (path: string, resolver: Resolver) => http.patch(path, answered(resolver));

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

/** A repo the caller may act on through the API: 404 when it may not read it, 403 when it may
 * read it but lacks the action (rbac.md §3). */
function repoFor(params: PathParams, action: "write" | "delete" | "manage"): db.MockRepo | Response {
  const repo = repoOr404(params);
  if (repo instanceof Response) return repo;
  return repo.permissions.includes(action) ? repo : fail(403, "FORBIDDEN", `this needs ${action} on ${repo.prefix}`);
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
    return HttpResponse.json({ ...db.serverInfo, caller: db.caller() });
  }),

  get("*/api/v1/whoami", async () => {
    if (getPersona() === "anonymous") return unauthorized("credentials are needed");
    return HttpResponse.json(db.whoami());
  }),

  get("*/api/v1/repos", async ({ request }) => {
    const format = new URL(request.url).searchParams.get("format");
    const repos = db.listRepos().filter((r) => !format || r.format === format);
    return HttpResponse.json({ repos: repos.map(repoJson) });
  }),

  get("*/api/v1/repos/:format/:repo", async ({ params }) => {
    const repo = repoOr404(params);
    return repo instanceof Response ? repo : HttpResponse.json(repoJson(repo));
  }),

  get("*/api/v1/repos/:format/:repo/packages", async ({ params, request }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    const sp = new URL(request.url).searchParams;
    return HttpResponse.json(
      db.listPackages(repo, {
        prefix: sp.get("prefix") ?? undefined,
        q: sp.get("q") ?? undefined,
        attr: sp.getAll("attr"),
        sort: sp.get("sort") ?? undefined,
        order: sp.get("order") ?? undefined,
        limit: num(sp.get("limit"), 100),
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

  get("*/api/v1/repos/:format/:repo/packages/:name/versions", async ({ params, request }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    const versions = db.listVersions(repo, decode(params.name));
    if (!versions) return fail(404, "NOT_FOUND", `package ${decode(params.name)} not found in ${repo.prefix}`);
    const sp = new URL(request.url).searchParams;
    const { page, next } = db.paginate(versions, num(sp.get("limit"), 100), sp.get("cursor"));
    return HttpResponse.json({ versions: page, ...(next ? { next } : {}) });
  }),

  get("*/api/v1/repos/:format/:repo/packages/:name/versions/:version", async ({ params, request }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    const variant = new URL(request.url).searchParams.get("variant");
    const v = db.getVersion(repo, decode(params.name), decode(params.version), variant);
    return v ? HttpResponse.json(v) : fail(404, "NOT_FOUND", `version ${decode(params.version)} of ${decode(params.name)} not found in ${repo.prefix}`);
  }),

  get("*/api/v1/repos/:format/:repo/packages/:name/versions/:version/attachments", async ({ params, request }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    const variant = new URL(request.url).searchParams.get("variant");
    const list = db.listAttachments(repo, decode(params.name), decode(params.version), variant);
    return list ? HttpResponse.json(list) : fail(404, "NOT_FOUND", `version ${decode(params.version)} of ${decode(params.name)} not found in ${repo.prefix}`);
  }),

  get("*/api/v1/repos/:format/:repo/reindex", async ({ params }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    if (!repo.permissions.includes("manage")) return fail(403, "FORBIDDEN", "the reindex run needs manage on the repo");
    return HttpResponse.json(db.reindexRun(repo));
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
        state: sp.get("state") ?? undefined,
        since: sp.get("since") ?? undefined,
        until: sp.get("until") ?? undefined,
        limit: num(sp.get("limit"), 100),
        cursor: sp.get("cursor") ?? undefined,
      }),
    );
  }),

  get("*/api/v1/users", async () => {
    return adminOr403() ?? HttpResponse.json({ users: db.users });
  }),

  get("*/api/v1/bindings", async ({ request }) => {
    return adminOr403() ?? HttpResponse.json({ bindings: db.listBindings(new URL(request.url).searchParams.get("principal")) });
  }),

  get("*/api/v1/tokens", async () => {
    return adminOr403() ?? HttpResponse.json({ tokens: db.tokens });
  }),

  get("*/api/v1/users/:name/tokens", async ({ params }) => {
    const user = db.userByRef(decode(params.name))?.name;
    if (!user) return fail(404, "NOT_FOUND", `user ${decode(params.name)} not found`);
    const denied = ownOr403(user);
    if (denied) return denied;
    return HttpResponse.json({ tokens: db.tokens.filter((t) => t.kind === "pat" && t.user === user) });
  }),

  post("*/api/v1/users/:name/tokens", async ({ params, request }) => {
    const user = db.userByRef(decode(params.name))?.name;
    if (!user) return fail(404, "NOT_FOUND", `user ${decode(params.name)} not found`);
    const denied = ownOr403(user);
    if (denied) return denied;
    const created = createToken({ user }, await body(request));
    if ("status" in created) return refusal(created);
    return HttpResponse.json(created, { status: 201, headers: { Location: `/api/v1/users/${user}/tokens/${created.id}` } });
  }),

  del("*/api/v1/users/:name/tokens/:id", async ({ params }) => {
    const user = db.userByRef(decode(params.name))?.name;
    if (!user) return fail(404, "NOT_FOUND", `user ${decode(params.name)} not found`);
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

  post("*/api/v1/repos", async ({ request }) => {
    const me = getPersona();
    if (me === "anonymous") return unauthorized("credentials are needed");
    if (!db.isAdmin(me)) return fail(403, "FORBIDDEN", "creating a repo needs the admin role");
    const created = db.createRepo(await body(request), `user:${me}`);
    if ("status" in created) return refusal(created);
    return HttpResponse.json(repoJson(created), { status: 201, headers: { Location: `/api/v1/repos/${created.prefix}` } });
  }),

  post("*/api/v1/repos/:format/:repo/reindex", async ({ params, request }) => {
    const repo = repoFor(params, "manage");
    if (repo instanceof Response) return repo;
    // The body is optional: an empty one means the defaults (docs/api.md, Reindex).
    const text = await request.text();
    let options: unknown;
    try {
      options = text ? JSON.parse(text) : null;
    } catch {
      return fail(400, "INVALID", "the body must be JSON");
    }
    const run = db.startReindex(repo, options, `user:${getPersona()}`);
    return "status" in run ? refusal(run) : HttpResponse.json(run, { status: 202 });
  }),

  patch("*/api/v1/repos/:format/:repo", async ({ params, request }) => {
    const me = getPersona();
    const repo = repoFor(params, "manage");
    if (repo instanceof Response) return repo;
    const updated = db.updateRepo(repo, await body(request), `user:${me}`);
    return "status" in updated ? refusal(updated) : HttpResponse.json(repoJson(updated));
  }),

  del("*/api/v1/repos/:format/:repo", async ({ params, request }) => {
    const repo = repoFor(params, "manage");
    if (repo instanceof Response) return repo;
    const refused = db.deleteRepo(repo, new URL(request.url).searchParams.get("force") === "true", `user:${getPersona()}`);
    return refused ? refusal(refused) : new HttpResponse(null, { status: 204 });
  }),

  get("*/api/v1/*", async () => {
    return fail(404, "NOT_FOUND", "no such endpoint in the mock API");
  }),
];
