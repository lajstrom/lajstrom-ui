// The mock of the server's /api/v1: the paths and status codes of docs/api.md and
// docs/api-proposal.md, and the error envelope of docs/spec/http-routing.md §4.

import { delay, http, HttpResponse, type PathParams } from "msw";

import type { ApiErrorBody } from "@/api/types";
import type { User } from "@/api/types";

import { authenticate, byPassword, createToken, login, revokeToken, tokenView, type DpopRefusal, type Refusal } from "./auth";
import * as approvals from "./approvals";
import { bootstrapOpen, exchangeBootstrapToken } from "./bootstrap";
import * as ci from "./ci";
import * as db from "./db";
import { getCredential, getPersona, setPersona } from "./persona";
import { changeReason, withReason } from "./reason";
import * as hooks from "./webhooks";

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

/** 401 with the DPoP challenge of RFC 9449 §7.1, as the server answers a refused proof or a
 * refused token of a sign-in on /api/ (docs/spec/http-routing.md §4). Date is the server's clock,
 * by which a UI whose clock is off signs its proofs again. */
function dpopRefused(r: DpopRefusal) {
  const challenge = `DPoP error="${r.error}"${r.why ? `, error_description="${r.why}"` : ""}, algs="ES256"`;
  return HttpResponse.json<ApiErrorBody>(
    { error: { code: "UNAUTHENTICATED", message: r.message ?? r.why ?? "credentials are needed: the ones sent were refused" } },
    { status: 401, headers: { "WWW-Authenticate": challenge, Date: new Date().toUTCString() } },
  );
}

/** An error of a protocol frontend: plain text, like the server's. */
function text(status: number, message: string, headers: Record<string, string> = {}) {
  return new HttpResponse(`${message}\n`, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...headers } });
}

/** A repo as the server answers it: without prefix, which the UI derives (src/api/queries.ts). */
/** A repo as the server answers it: a group and an oci repo, which index no versions, have no
 * stats. */
function repoJson({ prefix: _prefix, seedReindex: _seedReindex, stats, ...repo }: db.MockRepo) {
  return repo.kind === "group" || repo.format === "oci" ? repo : { ...repo, stats };
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
    const authn = await authenticate(info.request);
    const api = new URL(info.request.url).pathname.startsWith("/api/");
    if ("refused" in authn) {
      if (authn.dpop) return dpopRefused(authn.dpop);
      return unauthorized(authn.message ?? "credentials are needed: the ones sent were refused", api);
    }
    if ("mustChange" in authn) return api ? fail(403, "FORBIDDEN", db.MUST_CHANGE) : text(403, db.MUST_CHANGE);
    setPersona(authn.principal, authn.credential);
    return resolver(info);
  };
}

const get = (path: string, resolver: Resolver) => http.get(path, answered(resolver));
const post = (path: string, resolver: Resolver) => http.post(path, answered(resolver));
const put = (path: string, resolver: Resolver) => http.put(path, answered(resolver));
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

/** A change of the control plane with its reason (src/mocks/reason.ts), asked after the role and
 * before anything is written: the body, read unless read is null, goes to make without its
 * changeReason; a reason the server refuses is its 400. own: a change of the person's own
 * credentials, which needs none. */
async function changeWith(
  request: Request,
  make: (body: unknown) => Response,
  { own = false, read = body }: { own?: boolean; read?: ((request: Request) => Promise<unknown>) | null } = {},
): Promise<Response> {
  const r = changeReason(request, read ? await read(request) : undefined, own);
  if ("status" in r) return refusal(r);
  return withReason(r.reason, () => make(r.body));
}

/** The 202 of a change that waits for a second admin, with the request's Location, or the
 * refusal of the request. */
function waiting(made: ReturnType<typeof approvals.requestBinding>): Response {
  if ("status" in made) return refusal(made);
  return HttpResponse.json(made, { status: 202, headers: { Location: `/api/v1/approvals/${made.id}` } });
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

/** The admin role, for users and bindings: 401 without credentials, 403 without the role. */
function adminOnly(): Response | null {
  return getPersona() === "anonymous" ? unauthorized("credentials are needed") : adminOr403();
}

/** The live user of the path, by its name or its uid, or the server's 404. */
function liveUser(params: PathParams): User | Response {
  const ref = decode(params.user);
  return db.userByRef(ref) ?? fail(404, "NOT_FOUND", `user ${ref} does not exist`);
}

/** A repo the caller may act on through the API: 404 when it may not read it, 403 when it may
 * read it but lacks the action (rbac.md §3). */
function repoFor(params: PathParams, action: "write" | "delete" | "manage"): db.MockRepo | Response {
  const repo = repoOr404(params);
  if (repo instanceof Response) return repo;
  return repo.permissions.includes(action) ? repo : fail(403, "FORBIDDEN", `this needs ${action} on ${repo.prefix}`);
}

// Webhooks (docs/api.md, Webhooks): the routes under a repo and those under /api/v1/webhooks
// answer alike, in the scope of the route; src/mocks/webhooks.ts keeps them.

/** The mask of a webhook route's scope: the repo's, for manage on it, decided before the repo is
 * looked up (401, then 404 or 403: rbac.md §3); "" under /api/v1/webhooks, for the admin role,
 * before the body is read. */
function webhookScope(params: PathParams): string | Response {
  if (getPersona() === "anonymous") return unauthorized("credentials are needed");
  if (params.format === undefined) return adminOr403() ?? "";
  const repo = repoFor(params, "manage");
  return repo instanceof Response ? repo : repo.prefix;
}

/** The webhook {id} of the route's scope: under a repo, one of another mask is 404. */
function webhookOf(params: PathParams) {
  const mask = webhookScope(params);
  if (mask instanceof Response) return mask;
  const w = hooks.webhookIn(mask, decode(params.id));
  return "status" in w ? refusal(w) : w;
}

const webhookList: Resolver = async ({ params }) => {
  const mask = webhookScope(params);
  return mask instanceof Response ? mask : HttpResponse.json({ webhooks: hooks.listWebhooks(mask) });
};

const webhookCreate: Resolver = async ({ params, request }) => {
  const mask = webhookScope(params);
  if (mask instanceof Response) return mask;
  return changeWith(request, (b) => {
    const created = hooks.createWebhook(mask, b, `user:${getPersona()}`);
    if ("status" in created) return refusal(created);
    const location = mask ? `/api/v1/repos/${mask}/webhooks/${created.id}` : `/api/v1/webhooks/${created.id}`;
    return HttpResponse.json(created, { status: 201, headers: { Location: location } });
  });
};

const webhookGet: Resolver = async ({ params }) => {
  const w = webhookOf(params);
  return w instanceof Response ? w : HttpResponse.json(w);
};

const webhookUpdate: Resolver = async ({ params, request }) => {
  const w = webhookOf(params);
  if (w instanceof Response) return w;
  return changeWith(request, (b) => {
    const updated = hooks.updateWebhook(w, b, `user:${getPersona()}`);
    return "status" in updated ? refusal(updated) : HttpResponse.json(updated);
  });
};

const webhookDelete: Resolver = async ({ params, request }) => {
  const w = webhookOf(params);
  if (w instanceof Response) return w;
  return changeWith(
    request,
    () => {
      hooks.deleteWebhook(w, `user:${getPersona()}`);
      return new HttpResponse(null, { status: 204 });
    },
    { read: null },
  );
};

const webhookSecret: Resolver = async ({ params, request }) => {
  const w = webhookOf(params);
  if (w instanceof Response) return w;
  return changeWith(
    request,
    () => {
      const secret = hooks.rotateSecret(w, `user:${getPersona()}`);
      return "status" in secret ? refusal(secret) : HttpResponse.json(secret);
    },
    { read: null },
  );
};

const webhookTest: Resolver = async ({ params }) => {
  const w = webhookOf(params);
  if (w instanceof Response) return w;
  const delivery = hooks.testWebhook(w);
  return "status" in delivery ? refusal(delivery) : HttpResponse.json(delivery);
};

const webhookDeliveries: Resolver = async ({ params, request }) => {
  const w = webhookOf(params);
  if (w instanceof Response) return w;
  const sp = new URL(request.url).searchParams;
  const page = hooks.listDeliveries(w, sp.get("limit"), sp.get("cursor"));
  return "status" in page ? refusal(page) : HttpResponse.json(page);
};

// CI trust policies (docs/api.md, CI trust policies): the admin role, checked before the body is
// read; src/mocks/ci.ts keeps them. A policy of the API answers its revision as its ETag.

/** The admin of a CI policy route and its credential, read before the body is awaited. */
function ciAdmin(): { by: string; cred: ReturnType<typeof getCredential> } | Response {
  const denied = adminOnly();
  return denied ?? { by: `user:${getPersona()}`, cred: getCredential() };
}

/** A refusal of src/mocks/ci.ts; a 412 has the ETag of the policy now. */
function ciRefusal(r: ci.CIRefusal) {
  return HttpResponse.json<ApiErrorBody>({ error: { code: r.code, message: r.message } }, { status: r.status, headers: r.etag ? { ETag: r.etag } : {} });
}

/** A policy with its ETag, when it has one. */
function ciPolicy(t: ci.Tagged, status = 200, headers: Record<string, string> = {}) {
  return HttpResponse.json(t.policy, { status, headers: { ...headers, ...(t.etag ? { ETag: t.etag } : {}) } });
}

/** The body of a renewal, which may be left out. */
async function optionalBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return "not JSON";
  }
}

const num = (v: string | null, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : fallback;
};

export const handlers = [
  get("*/api/v1/info", async () => {
    return HttpResponse.json({ ...db.serverInfo, caller: db.caller() });
  }),

  // The sign-in of a web UI, with a DPoP proof (docs/api.md, Sign in): its Authorization is
  // ignored (src/mocks/auth.ts). A refusal has the server's Date, for a proof refused for its iat.
  post("*/api/v1/login", async ({ request }) => {
    const made = await login(request, await body(request));
    if ("status" in made) {
      return HttpResponse.json<ApiErrorBody>(
        { error: { code: made.code, message: made.message } },
        { status: made.status, headers: { Date: new Date().toUTCString() } },
      );
    }
    return HttpResponse.json(made, { status: 201, headers: { Location: `/api/v1/users/${made.user}/tokens/${made.id}` } });
  }),

  get("*/api/v1/whoami", async () => {
    if (getPersona() === "anonymous") return unauthorized("credentials are needed");
    return HttpResponse.json(db.whoami());
  }),

  // The first admin, for the bootstrap token in the body, which is the credential (docs/api.md).
  // How the demo's server, which has its admin, takes it: src/mocks/bootstrap.ts.
  post("*/api/v1/bootstrap", async ({ request }) => {
    if (!bootstrapOpen()) return fail(404, "NOT_FOUND", `POST ${new URL(request.url).pathname} is not an endpoint of this version (docs/api.md)`);
    const made = exchangeBootstrapToken(await body(request));
    if ("status" in made) {
      return HttpResponse.json<ApiErrorBody>(
        { error: { code: made.code, message: made.message } },
        { status: made.status, headers: made.retryAfter ? { "Retry-After": String(made.retryAfter) } : {} },
      );
    }
    return HttpResponse.json(made, { status: 201, headers: { Location: `/api/v1/users/${made.name}` } });
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
        facet: sp.getAll("facet"),
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

  del("*/api/v1/repos/:format/:repo/packages/:name/versions/:version", async ({ params, request }) => {
    const repo = repoFor(params, "delete");
    if (repo instanceof Response) return repo;
    const sp = new URL(request.url).searchParams;
    const refused = db.deleteVersion(
      repo,
      decode(params.name),
      decode(params.version),
      {
        variant: sp.get("variant"),
        force: sp.get("force") === "true",
        ifMatch: request.headers.get("If-Match"),
        ifUnmodifiedSince: request.headers.get("If-Unmodified-Since"),
      },
      `user:${getPersona()}`,
    );
    return refused ? refusal(refused) : new HttpResponse(null, { status: 204 });
  }),

  // The colon of the custom method is escaped: unescaped, it would start a parameter.
  post("*/api/v1/repos/:format/:repo/versions\\:delete", async ({ params, request }) => {
    const repo = repoFor(params, "delete");
    if (repo instanceof Response) return repo;
    const result = db.deleteVersions(repo, await body(request), `user:${getPersona()}`);
    return "status" in result ? refusal(result) : HttpResponse.json(result);
  }),

  put("*/api/v1/repos/:format/:repo/packages/:name/versions/:version/yank", async ({ params, request }) => {
    const repo = repoFor(params, "write");
    if (repo instanceof Response) return repo;
    if (new URL(request.url).searchParams.has("variant")) return fail(400, "INVALID", "a yank is of the whole version: no ?variant=");
    // The body is optional: none, {} or a reason that is null or "" yank without a reason.
    const b = await body(request);
    if (b !== null && (typeof b !== "object" || Array.isArray(b))) return fail(400, "INVALID", "the body is a JSON object");
    const fields = (b ?? {}) as Record<string, unknown>;
    const extra = Object.keys(fields).find((k) => k !== "reason");
    if (extra) return fail(400, "INVALID", `unknown field ${extra}`);
    const reason = fields.reason ?? "";
    if (typeof reason !== "string") return fail(400, "INVALID", "reason: a string or null");
    if (new TextEncoder().encode(reason).length > 4096) return fail(400, "INVALID", "reason: at most 4096 bytes");
    const refused = db.yankVersion(repo, decode(params.name), decode(params.version), reason, `user:${getPersona()}`);
    return refused ? refusal(refused) : new HttpResponse(null, { status: 204 });
  }),

  del("*/api/v1/repos/:format/:repo/packages/:name/versions/:version/yank", async ({ params }) => {
    const repo = repoFor(params, "write");
    if (repo instanceof Response) return repo;
    const refused = db.yankVersion(repo, decode(params.name), decode(params.version), null, `user:${getPersona()}`);
    return refused ? refusal(refused) : new HttpResponse(null, { status: 204 });
  }),

  get("*/api/v1/repos/:format/:repo/packages/:name/versions/:version/attachments", async ({ params, request }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    const variant = new URL(request.url).searchParams.get("variant");
    const list = db.listAttachments(repo, decode(params.name), decode(params.version), variant);
    return list ? HttpResponse.json(list) : fail(404, "NOT_FOUND", `version ${decode(params.version)} of ${decode(params.name)} not found in ${repo.prefix}`);
  }),

  get("*/api/v1/repos/:format/:repo/packages/:name/versions/:version/manifest", async ({ params, request }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    const variant = new URL(request.url).searchParams.get("variant");
    const list = db.getManifests(repo, decode(params.name), decode(params.version), variant);
    if (!list) return fail(404, "NOT_FOUND", `version ${decode(params.version)} of ${decode(params.name)} not found in ${repo.prefix}`);
    // One variant's answer is named by its digest.
    const headers: Record<string, string> = { "Cache-Control": "no-cache" };
    if (list.manifests.length === 1) headers.ETag = `"${list.manifests[0]!.digest}"`;
    return HttpResponse.json(list, { headers });
  }),

  get("*/api/v1/repos/:format/:repo/packages/:name/versions/:version/referrers", async ({ params, request }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    const sp = new URL(request.url).searchParams;
    const list = db.listReferrers(repo, decode(params.name), decode(params.version), sp.get("variant"), sp.get("artifactType"));
    return list ? HttpResponse.json(list) : fail(404, "NOT_FOUND", `version ${decode(params.version)} of ${decode(params.name)} not found in ${repo.prefix}`);
  }),

  get("*/api/v1/repos/:format/:repo/reindex", async ({ params }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    if (!repo.permissions.includes("manage")) return fail(403, "FORBIDDEN", "the reindex run needs manage on the repo");
    const run = db.reindexRun(repo);
    return run ? HttpResponse.json(run) : fail(404, "NOT_FOUND", `no reindex run has covered ${repo.prefix}`);
  }),

  // A proxy's cache and a prefetch (docs/api.md): manage on the repo, checked before the body.
  del("*/api/v1/repos/:format/:repo/upstream-cache", async ({ params, request }) => {
    const repo = repoFor(params, "manage");
    if (repo instanceof Response) return repo;
    const refused = db.purgeUpstreamCache(repo, new URL(request.url).searchParams.get("name"), `user:${getPersona()}`);
    return refused ? refusal(refused) : new HttpResponse(null, { status: 204 });
  }),

  post("*/api/v1/repos/:format/:repo/prefetch", async ({ params, request }) => {
    const repo = repoFor(params, "manage");
    if (repo instanceof Response) return repo;
    const result = db.prefetch(repo, await body(request), `user:${getPersona()}`);
    if ("status" in result) return refusal(result);
    // The answer comes when every fetch has ended: a moment per image.
    await delay(Math.min(3000, 400 * new Set(result.results.map((r) => r.name)).size));
    return HttpResponse.json(result);
  }),

  get("*/api/v1/repos/:format/:repo/sessions", async ({ params }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    if (!repo.permissions.includes("manage")) return fail(403, "FORBIDDEN", "deploy sessions need manage on the repo");
    return HttpResponse.json({ sessions: db.listSessions(repo) });
  }),

  get("*/api/v1/repos/:format/:repo/deploy-tokens", async ({ params }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    if (!repo.permissions.includes("manage")) return fail(403, "FORBIDDEN", "deploy tokens need manage on the repo");
    return HttpResponse.json({ tokens: db.tokens.filter((t) => t.kind === "deploy" && t.repo === repo.prefix).map((t) => tokenView(t)) });
  }),

  get("*/api/v1/search", async ({ request }) => {
    const sp = new URL(request.url).searchParams;
    return HttpResponse.json(db.search(sp.get("q") ?? "", sp.get("format"), num(sp.get("limit"), 20), sp.get("cursor")));
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
    return adminOr403() ?? HttpResponse.json({ users: db.listUsers() });
  }),

  get("*/api/v1/bindings", async ({ request }) => {
    return adminOr403() ?? HttpResponse.json({ bindings: db.listBindings(new URL(request.url).searchParams.get("principal")) });
  }),

  // Users and bindings: the admin role only, asked before the body is read (docs/api.md).
  post("*/api/v1/users", async ({ request }) => {
    const denied = adminOnly();
    if (denied) return denied;
    return changeWith(request, (b) => {
      const created = db.createUser(b, `user:${getPersona()}`);
      if ("status" in created) return refusal(created);
      return HttpResponse.json(created, { status: 201, headers: { Location: `/api/v1/users/${created.name}` } });
    });
  }),

  get("*/api/v1/users/:user", async ({ params }) => {
    const user = adminOnly() ?? liveUser(params);
    return user instanceof Response ? user : HttpResponse.json(db.userView(user));
  }),

  patch("*/api/v1/users/:user", async ({ params, request }) => {
    const user = adminOnly() ?? liveUser(params);
    if (user instanceof Response) return user;
    return changeWith(request, (b) => {
      const updated = db.updateUser(user, b, `user:${getPersona()}`);
      return "status" in updated ? refusal(updated) : HttpResponse.json(db.userView(updated));
    });
  }),

  del("*/api/v1/users/:user", async ({ params, request }) => {
    const user = adminOnly() ?? liveUser(params);
    if (user instanceof Response) return user;
    return changeWith(
      request,
      () => {
        const refused = db.deleteUser(user, `user:${getPersona()}`);
        return refused ? refusal(refused) : new HttpResponse(null, { status: 204 });
      },
      { read: null },
    );
  }),

  post("*/api/v1/users/:user/password", async ({ params, request }) => {
    const b = await body(request);
    // With currentPassword, the user's own change: the one route of users that is not the admin
    // role's, whose credential is the current password (rbac.md §1, A user's own password).
    if (typeof b === "object" && b !== null && "currentPassword" in b) {
      return changeWith(
        request,
        (own) => {
          const refused = db.changeOwnPassword(decode(params.user), own);
          return refused ? refusal(refused) : new HttpResponse(null, { status: 204 });
        },
        { own: true, read: async () => b },
      );
    }
    const user = adminOnly() ?? liveUser(params);
    if (user instanceof Response) return user;
    return changeWith(
      request,
      (req) => {
        const refused = db.setPassword(user, req, `user:${getPersona()}`);
        return refused ? refusal(refused) : new HttpResponse(null, { status: 204 });
      },
      { read: async () => b },
    );
  }),

  post("*/api/v1/users/:user/unlock", async ({ params, request }) => {
    const user = adminOnly() ?? liveUser(params);
    if (user instanceof Response) return user;
    return changeWith(
      request,
      () => {
        db.unlockUser(user, `user:${getPersona()}`);
        return new HttpResponse(null, { status: 204 });
      },
      { read: null },
    );
  }),

  post("*/api/v1/bindings", async ({ request }) => {
    const denied = adminOnly();
    if (denied) return denied;
    return changeWith(request, (b) => {
      // With auth.approval second-admin, a binding of the role admin or on */* is a request for a
      // second admin in its place (rbac.md §13).
      const req = typeof b === "object" && b !== null ? (b as Record<string, unknown>) : {};
      if (db.serverInfo.approval === "second-admin" && approvals.bindingWaits(String(req.role), String(req.repoMask))) {
        return waiting(approvals.requestBinding(b, `user:${getPersona()}`));
      }
      const created = db.createBinding(b, `user:${getPersona()}`);
      if ("status" in created) return refusal(created);
      return HttpResponse.json(created, { status: 201, headers: { Location: `/api/v1/bindings/${created.id}` } });
    });
  }),

  del("*/api/v1/bindings/:id", async ({ params, request }) => {
    const denied = adminOnly();
    if (denied) return denied;
    return changeWith(
      request,
      () => {
        const refused = db.deleteBinding(decode(params.id), `user:${getPersona()}`);
        return refused ? refusal(refused) : new HttpResponse(null, { status: 204 });
      },
      { read: null },
    );
  }),

  get("*/api/v1/ci/policies", async () => {
    return adminOnly() ?? HttpResponse.json(ci.listCIPolicies());
  }),

  post("*/api/v1/ci/policies", async ({ request }) => {
    const admin = ciAdmin();
    if (admin instanceof Response) return admin;
    return changeWith(request, (b) => {
      const made = ci.createCIPolicy(b, admin.by, admin.cred);
      if ("status" in made) return ciRefusal(made);
      return ciPolicy(made, 201, { Location: `/api/v1/ci/policies/${made.policy.name}` });
    });
  }),

  get("*/api/v1/ci/policies/:name", async ({ params, request }) => {
    const denied = adminOnly();
    if (denied) return denied;
    const got = ci.getCIPolicy(decode(params.name), request.headers.get("If-None-Match"));
    if ("status" in got) return ciRefusal(got);
    return got.notModified ? new HttpResponse(null, { status: 304, headers: { ETag: got.etag! } }) : ciPolicy(got);
  }),

  put("*/api/v1/ci/policies/:name", async ({ params, request }) => {
    const admin = ciAdmin();
    if (admin instanceof Response) return admin;
    const ifMatch = request.headers.get("If-Match");
    return changeWith(request, (b) => {
      const changed = ci.replaceCIPolicy(decode(params.name), b, ifMatch, admin.by, admin.cred);
      return "status" in changed ? ciRefusal(changed) : ciPolicy(changed);
    });
  }),

  del("*/api/v1/ci/policies/:name", async ({ params, request }) => {
    const admin = ciAdmin();
    if (admin instanceof Response) return admin;
    return changeWith(
      request,
      () => {
        const refused = ci.deleteCIPolicy(decode(params.name), request.headers.get("If-Match"), admin.by);
        return refused ? ciRefusal(refused) : new HttpResponse(null, { status: 204 });
      },
      { read: null },
    );
  }),

  post("*/api/v1/ci/policies/:name/renew", async ({ params, request }) => {
    const admin = ciAdmin();
    if (admin instanceof Response) return admin;
    const ifMatch = request.headers.get("If-Match");
    return changeWith(
      request,
      (b) => {
        // A body of nothing but the reason is a renewal without one.
        const rest = typeof b === "object" && b !== null && !Object.keys(b).length ? null : b;
        const renewed = ci.renewCIPolicy(decode(params.name), rest, ifMatch, admin.by, admin.cred);
        return "status" in renewed ? ciRefusal(renewed) : ciPolicy(renewed);
      },
      { read: optionalBody },
    );
  }),

  post("*/api/v1/ci/policies/:name/approve", async ({ params, request }) => {
    const admin = ciAdmin();
    if (admin instanceof Response) return admin;
    return changeWith(
      request,
      () => {
        const approved = ci.approveCIPolicy(decode(params.name), request.headers.get("If-Match"), admin.by, admin.cred);
        return "status" in approved ? ciRefusal(approved) : ciPolicy(approved);
      },
      { read: null },
    );
  }),

  // The requests for a second admin (rbac.md §13): the admin role first; an approval takes the
  // admin's password as its credential, then a reason, like a rejection.
  get("*/api/v1/approvals", async ({ request }) => {
    const denied = adminOnly();
    if (denied) return denied;
    const sp = new URL(request.url).searchParams;
    const page = approvals.listApprovals(sp.get("state"), sp.get("cursor"), num(sp.get("limit"), 100));
    return "status" in page ? refusal(page) : HttpResponse.json(page);
  }),

  get("*/api/v1/approvals/:id", async ({ params }) => {
    const denied = adminOnly();
    if (denied) return denied;
    const a = approvals.getApproval(decode(params.id));
    return "status" in a ? refusal(a) : HttpResponse.json(a);
  }),

  post("*/api/v1/approvals/:id/approve", async ({ params, request }) => {
    const denied = adminOnly();
    if (denied) return denied;
    const cred = approvals.mayApprove(getCredential());
    if (cred) return refusal(cred);
    return changeWith(
      request,
      () => {
        const a = approvals.approve(decode(params.id), `user:${getPersona()}`);
        return "status" in a ? refusal(a) : HttpResponse.json(a);
      },
      { read: null },
    );
  }),

  post("*/api/v1/approvals/:id/reject", async ({ params, request }) => {
    const denied = adminOnly();
    if (denied) return denied;
    return changeWith(
      request,
      () => {
        const a = approvals.reject(decode(params.id), `user:${getPersona()}`);
        return "status" in a ? refusal(a) : HttpResponse.json(a);
      },
      { read: null },
    );
  }),

  get("*/api/v1/tokens", async () => {
    return adminOr403() ?? HttpResponse.json({ tokens: db.tokens.map((t) => tokenView(t)) });
  }),

  // Deploy tokens over a mask: the admin's, created with the admin's password only (docs/api.md).
  get("*/api/v1/deploy-tokens", async ({ request }) => {
    if (getPersona() === "anonymous") return unauthorized("credentials are needed");
    const denied = adminOr403();
    if (denied) return denied;
    const mask = new URL(request.url).searchParams.get("repoMask");
    return HttpResponse.json({ tokens: db.tokens.filter((t) => t.repoMask !== undefined && (!mask || t.repoMask === mask)).map((t) => tokenView(t)) });
  }),

  post("*/api/v1/deploy-tokens", async ({ request }) => {
    if (getPersona() === "anonymous") return unauthorized("credentials are needed");
    const denied = adminOr403();
    if (denied) return denied;
    if (!byPassword(request)) return fail(403, "FORBIDDEN", "a deploy token over a mask is created with the admin's password, not with a token");
    return changeWith(request, (b) => {
      if (typeof b !== "object" || b === null || Array.isArray(b)) return fail(400, "INVALID", "the body must be a JSON object");
      const { repoMask, ...rest } = b as Record<string, unknown>;
      const bad = db.maskRefusal(repoMask);
      if (bad) return refusal(bad);
      // With auth.approval second-admin, one whose scopes hold write waits for a second admin.
      if (db.serverInfo.approval === "second-admin" && Array.isArray(rest.scopes) && approvals.maskTokenWaits(rest.scopes as string[])) {
        return waiting(approvals.requestMaskToken(repoMask as string, rest, `user:${getPersona()}`));
      }
      const created = createToken({ repoMask: repoMask as string }, rest);
      if ("status" in created) return refusal(created);
      return HttpResponse.json(created, { status: 201, headers: { Location: `/api/v1/deploy-tokens/${created.id}` } });
    });
  }),

  del("*/api/v1/deploy-tokens/:id", async ({ params, request }) => {
    if (getPersona() === "anonymous") return unauthorized("credentials are needed");
    const denied = adminOr403();
    if (denied) return denied;
    return changeWith(
      request,
      () =>
        revokeToken("mask", Number(decode(params.id)))
          ? new HttpResponse(null, { status: 204 })
          : fail(404, "NOT_FOUND", `no deploy token over a mask has the id ${decode(params.id)}`),
      { read: null },
    );
  }),

  get("*/api/v1/users/:user/tokens", async ({ params }) => {
    const user = db.userByRef(decode(params.user))?.name;
    if (!user) return fail(404, "NOT_FOUND", `user ${decode(params.user)} not found`);
    const denied = ownOr403(user);
    if (denied) return denied;
    return HttpResponse.json({ tokens: db.tokens.filter((t) => t.kind === "pat" && t.user === user) });
  }),

  post("*/api/v1/users/:user/tokens", async ({ params, request }) => {
    const user = db.userByRef(decode(params.user))?.name;
    if (!user) return fail(404, "NOT_FOUND", `user ${decode(params.user)} not found`);
    const denied = ownOr403(user);
    if (denied) return denied;
    return changeWith(
      request,
      (b) => {
        const created = createToken({ user }, b);
        if ("status" in created) return refusal(created);
        return HttpResponse.json(created, { status: 201, headers: { Location: `/api/v1/users/${user}/tokens/${created.id}` } });
      },
      // A person's own tokens take a reason and never need one; another user's are a change of
      // the control plane (rbac.md §13).
      { own: getPersona() === user },
    );
  }),

  del("*/api/v1/users/:user/tokens/:id", async ({ params, request }) => {
    const user = db.userByRef(decode(params.user))?.name;
    if (!user) return fail(404, "NOT_FOUND", `user ${decode(params.user)} not found`);
    const denied = ownOr403(user);
    if (denied) return denied;
    return changeWith(
      request,
      () =>
        revokeToken({ user }, Number(decode(params.id)))
          ? new HttpResponse(null, { status: 204 })
          : fail(404, "NOT_FOUND", `user ${user} has no token ${decode(params.id)}`),
      { own: getPersona() === user, read: null },
    );
  }),

  post("*/api/v1/repos/:format/:repo/deploy-tokens", async ({ params, request }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    if (!repo.permissions.includes("manage")) return fail(403, "FORBIDDEN", "deploy tokens need manage on the repo");
    return changeWith(request, (b) => {
      const created = createToken({ repo: repo.prefix }, b);
      if ("status" in created) return refusal(created);
      return HttpResponse.json(created, { status: 201, headers: { Location: `/api/v1/repos/${repo.prefix}/deploy-tokens/${created.id}` } });
    });
  }),

  del("*/api/v1/repos/:format/:repo/deploy-tokens/:id", async ({ params, request }) => {
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    if (!repo.permissions.includes("manage")) return fail(403, "FORBIDDEN", "deploy tokens need manage on the repo");
    return changeWith(
      request,
      () =>
        revokeToken({ repo: repo.prefix }, Number(decode(params.id)))
          ? new HttpResponse(null, { status: 204 })
          : fail(404, "NOT_FOUND", `${repo.prefix} has no deploy token ${decode(params.id)}`),
      { read: null },
    );
  }),

  post("*/api/v1/repos", async ({ request }) => {
    const me = getPersona();
    if (me === "anonymous") return unauthorized("credentials are needed");
    if (!db.isAdmin(me)) return fail(403, "FORBIDDEN", "creating a repo needs the admin role");
    return changeWith(request, (b) => {
      const created = db.createRepo(b, `user:${me}`);
      if ("status" in created) return refusal(created);
      return HttpResponse.json(repoJson(created), { status: 201, headers: { Location: `/api/v1/repos/${created.prefix}` } });
    });
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
    return changeWith(request, (b) => {
      const updated = db.updateRepo(repo, b, `user:${me}`);
      return "status" in updated ? refusal(updated) : HttpResponse.json(repoJson(updated));
    });
  }),

  del("*/api/v1/repos/:format/:repo", async ({ params, request }) => {
    const repo = repoFor(params, "manage");
    if (repo instanceof Response) return repo;
    return changeWith(
      request,
      () => {
        const refused = db.deleteRepo(repo, new URL(request.url).searchParams.get("force") === "true", `user:${getPersona()}`);
        return refused ? refusal(refused) : new HttpResponse(null, { status: 204 });
      },
      { read: null },
    );
  }),

  // Webhooks: a repo's, for manage on it, and those of every mask, for the admin role.
  get("*/api/v1/repos/:format/:repo/webhooks", webhookList),
  post("*/api/v1/repos/:format/:repo/webhooks", webhookCreate),
  get("*/api/v1/repos/:format/:repo/webhooks/:id", webhookGet),
  patch("*/api/v1/repos/:format/:repo/webhooks/:id", webhookUpdate),
  del("*/api/v1/repos/:format/:repo/webhooks/:id", webhookDelete),
  post("*/api/v1/repos/:format/:repo/webhooks/:id/secret", webhookSecret),
  post("*/api/v1/repos/:format/:repo/webhooks/:id/test", webhookTest),
  get("*/api/v1/repos/:format/:repo/webhooks/:id/deliveries", webhookDeliveries),
  get("*/api/v1/webhooks", webhookList),
  post("*/api/v1/webhooks", webhookCreate),
  get("*/api/v1/webhooks/:id", webhookGet),
  patch("*/api/v1/webhooks/:id", webhookUpdate),
  del("*/api/v1/webhooks/:id", webhookDelete),
  post("*/api/v1/webhooks/:id/secret", webhookSecret),
  post("*/api/v1/webhooks/:id/test", webhookTest),
  get("*/api/v1/webhooks/:id/deliveries", webhookDeliveries),

  // Any other request under /api/ gets the server's answer to a path it does not know.
  http.all(
    "*/api/v1/*",
    answered(({ request }) =>
      fail(404, "NOT_FOUND", `${request.method} ${new URL(request.url).pathname} is not an endpoint of this version (docs/api.md)`),
    ),
  ),
];
