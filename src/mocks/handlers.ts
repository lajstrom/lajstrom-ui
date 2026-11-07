// The mock /api/v1. Paths and status codes follow docs/api-proposal.md; errors use the
// envelope of docs/spec/http-routing.md §4.

import { delay, http, HttpResponse, type PathParams } from "msw";

import type { ApiErrorBody, Repo } from "@/api/types";

import * as db from "./db";

function fail(status: number, code: ApiErrorBody["error"]["code"], message: string) {
  return HttpResponse.json<ApiErrorBody>({ error: { code, message } }, { status });
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
function repoOr404(params: PathParams): Repo | Response {
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
  http.get("*/-/version", async () => {
    await latency();
    const { version, commit, date } = db.serverInfo;
    return HttpResponse.json({ version, commit, date });
  }),

  http.get("*/api/v1/info", async () => {
    await latency();
    return HttpResponse.json(db.serverInfo);
  }),

  http.get("*/api/v1/whoami", async () => {
    await latency();
    return HttpResponse.json(db.whoami());
  }),

  http.get("*/api/v1/repos", async ({ request }) => {
    await latency();
    const format = new URL(request.url).searchParams.get("format");
    const repos = db.listRepos().filter((r) => !format || r.format === format);
    return HttpResponse.json({ repos });
  }),

  http.get("*/api/v1/repos/:format/:repo", async ({ params }) => {
    await latency();
    const repo = repoOr404(params);
    return repo instanceof Response ? repo : HttpResponse.json(repo);
  }),

  http.get("*/api/v1/repos/:format/:repo/packages", async ({ params, request }) => {
    await latency();
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

  http.get("*/api/v1/repos/:format/:repo/packages/:name", async ({ params }) => {
    await latency();
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    const pkg = db.getPackage(repo, decode(params.name));
    return pkg ? HttpResponse.json(pkg) : fail(404, "NOT_FOUND", `package ${decode(params.name)} not found in ${repo.prefix}`);
  }),

  http.get("*/api/v1/repos/:format/:repo/packages/:name/versions", async ({ params }) => {
    await latency();
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    const versions = db.listVersions(repo, decode(params.name));
    return versions
      ? HttpResponse.json({ versions })
      : fail(404, "NOT_FOUND", `package ${decode(params.name)} not found in ${repo.prefix}`);
  }),

  http.get("*/api/v1/repos/:format/:repo/packages/:name/versions/:digest", async ({ params }) => {
    await latency();
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    const v = db.getVersion(repo, decode(params.name), decode(params.digest));
    return v ? HttpResponse.json(v) : fail(404, "NOT_FOUND", `manifest ${decode(params.digest)} not found`);
  }),

  http.get("*/api/v1/repos/:format/:repo/reindex", async ({ params }) => {
    await latency();
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    if (!repo.permissions.includes("manage")) return fail(403, "FORBIDDEN", "the reindex report needs manage on the repo");
    return HttpResponse.json(db.reindexReport(repo));
  }),

  http.get("*/api/v1/repos/:format/:repo/sessions", async ({ params }) => {
    await latency();
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    return HttpResponse.json({ sessions: db.listSessions(repo) });
  }),

  http.get("*/api/v1/repos/:format/:repo/deploy-tokens", async ({ params }) => {
    await latency();
    const repo = repoOr404(params);
    if (repo instanceof Response) return repo;
    if (!repo.permissions.includes("manage")) return fail(403, "FORBIDDEN", "deploy tokens need manage on the repo");
    return HttpResponse.json({ tokens: db.tokens.filter((t) => t.kind === "deploy" && t.repo === repo.prefix) });
  }),

  http.get("*/api/v1/search", async ({ request }) => {
    await latency();
    const sp = new URL(request.url).searchParams;
    return HttpResponse.json(db.search(sp.get("q") ?? "", sp.get("format"), num(sp.get("limit"), 20)));
  }),

  http.get("*/api/v1/registries", async () => {
    await latency();
    return adminOr403() ?? HttpResponse.json({ registries: db.listRegistries() });
  }),

  http.get("*/api/v1/audit", async ({ request }) => {
    await latency();
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

  http.get("*/api/v1/users", async () => {
    await latency();
    return adminOr403() ?? HttpResponse.json({ users: db.users });
  }),

  http.get("*/api/v1/bindings", async () => {
    await latency();
    return adminOr403() ?? HttpResponse.json({ bindings: db.bindings });
  }),

  http.get("*/api/v1/tokens", async () => {
    await latency();
    return adminOr403() ?? HttpResponse.json({ tokens: db.tokens });
  }),

  http.get("*/api/v1/*", async () => {
    await latency();
    return fail(404, "NOT_FOUND", "no such endpoint in the mock API");
  }),
];
