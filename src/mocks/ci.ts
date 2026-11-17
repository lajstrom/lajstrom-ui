// The mock's CI trust policies (docs/api.md, CI trust policies; docs/spec/rbac.md §11): those of
// the demo's configuration, read-only, and those of the API, with the rules, the steps, the
// states, the revisions and the messages of the server's internal/config/ci.go,
// internal/auth/ci and internal/api/cipolicies.go. Handlers in handlers.ts check the admin role
// first; what changes here is kept between visits (src/mocks/state.ts).
//
// The steps of a policy that writes read the request's credential (src/mocks/persona.ts). The
// demo has no OIDC login, so no sign-in of the demo has a fresh one with a second factor, and a
// policy that writes is refused as the server refuses a password's sign-in: 403, saying what is
// missing. The server of the vendored contract answers an OIDC sign-in that is not fresh the
// same; with lajstrom/lajstrom#1296 it will be 401, insufficient_user_authentication.

import type { CIGrant, CIPolicy, CIPolicyList } from "@/api/types";
import { sha256Hex } from "@/lib/sha256";

import { ciConfig, ciPolicySeeds, type CIPolicyRow, type CIPolicySpec } from "./data/ci";
import { apiPrincipal, audited, type Refusal } from "./db";
import type { Credential } from "./persona";
import { keep, persist } from "./state";

/** A refusal; a 412 has the policy's ETag now. */
export type CIRefusal = Refusal & { etag?: string };

/** A policy of the API with its revision as an ETag; one of the configuration has none. */
export type Tagged = { policy: CIPolicy; etag: string | null };

const invalid = (message: string): CIRefusal => ({ status: 400, code: "INVALID", message });
const conflict = (message: string): CIRefusal => ({ status: 409, code: "CONFLICT", message });
const forbidden = (message: string): CIRefusal => ({ status: 403, code: "FORBIDDEN", message });

const DAY = 86_400_000;
/** The longest a policy of the API that writes lives from a change (ci.WriteLifetime). */
const WRITE_LIFETIME = 180 * DAY;
/** How long a sign-in at the IdP counts as fresh (auth.FreshSignInWindow), and its leeway. */
const FRESH = 10 * 60_000;
const LEEWAY = 60_000;

const rows: CIPolicyRow[] = ciPolicySeeds();
let nextId = Math.max(...rows.map((r) => r.id)) + 1;

keep("ci", {
  save: () => ({ rows, nextId }),
  load: (data) => {
    const d = data as { rows?: unknown; nextId?: unknown };
    if (!Array.isArray(d.rows) || typeof d.nextId !== "number") return;
    rows.splice(0, rows.length, ...(d.rows as CIPolicyRow[]));
    nextId = d.nextId;
  },
});

// --- The rules of a policy (config.CheckCIPolicy) ---------------------------------------------

type ClaimKind = "id" | "name" | "pattern" | "value";

const PLATFORMS: Record<string, { claims: Record<string, ClaimKind>; ids: string[]; writeConditions: string[]; event: string; pullRequests: string[] }> = {
  github: {
    claims: {
      repository_id: "id",
      repository_owner_id: "id",
      actor_id: "id",
      repository: "name",
      repository_owner: "name",
      actor: "name",
      ref: "pattern",
      environment: "pattern",
      workflow_ref: "pattern",
      job_workflow_ref: "pattern",
      ref_type: "value",
      ref_protected: "value",
      event_name: "value",
      runner_environment: "value",
      repository_visibility: "value",
    },
    ids: ["repository_id", "repository_owner_id"],
    writeConditions: ["ref", "environment"],
    event: "event_name",
    pullRequests: ["pull_request", "pull_request_target", "pull_request_review", "pull_request_review_comment"],
  },
  gitlab: {
    claims: {
      project_id: "id",
      namespace_id: "id",
      user_id: "id",
      project_path: "name",
      namespace_path: "name",
      user_login: "name",
      ref: "pattern",
      ref_path: "pattern",
      environment: "pattern",
      ci_config_ref_uri: "pattern",
      ref_type: "value",
      ref_protected: "value",
      environment_protected: "value",
      pipeline_source: "value",
      runner_environment: "value",
      deployment_tier: "value",
      project_visibility: "value",
    },
    ids: ["project_id", "namespace_id"],
    writeConditions: ["ref", "ref_path", "environment"],
    event: "pipeline_source",
    pullRequests: ["merge_request_event", "external_pull_request_event"],
  },
};

const ROLES = ["reader", "writer", "maintainer"];
const writesRole = (role: string) => role === "writer" || role === "maintainer";
const writes = (p: { grants: CIGrant[] }) => p.grants.some((g) => writesRole(g.role));

/** Go's %q of a string, near enough: JSON's quoting. */
const q = (s: string) => JSON.stringify(s);

const IDENTITY = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REPO_NAME = /^[a-z0-9]+(?:[-._][a-z0-9]+)*$/;

function maskProblem(mask: string): string | null {
  const i = mask.indexOf("/");
  const format = mask.slice(0, i);
  const repo = mask.slice(i + 1);
  if (i < 0 || repo.includes("/")) return `${q(mask)} is not <format>/<repo>`;
  if (format !== "*" && !IDENTITY.test(format)) return `${q(mask)}: the format is * or a format's name`;
  if (repo !== "*" && (repo.length > 64 || !REPO_NAME.test(repo))) return `${q(mask)}: the repo is * or a repo's name`;
  return null;
}

function valueProblem(kind: ClaimKind, v: string): string | null {
  if (v === "") return "is empty";
  if (v.replace(/\*/g, "") === "") return "is only *, which is no condition: leave the claim out";
  if (kind === "id" && !/^[0-9]+$/.test(v)) return "is not an id, decimal digits";
  if (kind !== "pattern" && v.includes("*")) return "has *, a wildcard in ref, environment and workflow claims only";
  return null;
}

/** The problems of a policy by the rules of rbac.md §11, each starting with its field. */
function problems(p: CIPolicySpec): string[] {
  const out: string[] = [];
  if (p.name.length > 63 || !IDENTITY.test(p.name)) out.push(`name: ${q(p.name)} is not lowercase letters and digits with single hyphens, at most 63 bytes`);
  else if (p.name === "spiffe") out.push(`name: ${q(p.name)} is reserved for SPIFFE IDs`);
  const platform = ciConfig.issuers.find((i) => i.name === p.issuer)?.platform;
  const pf = platform ? PLATFORMS[platform] : undefined;
  if (!platform || !pf) return [...out, `issuer: ${q(p.issuer)} is no issuer of auth.ci.issuers`];
  for (const c of Object.keys(p.claims).sort()) {
    const kind = pf.claims[c];
    if (!kind) {
      out.push(`claims.${c}: is not a claim a policy of ${platform} names`);
      continue;
    }
    if (p.claims[c]!.length === 0) out.push(`claims.${c}: must have a value`);
    for (const v of p.claims[c]!) {
      const why = valueProblem(kind, v);
      if (why) out.push(`claims.${c}: ${q(v)} ${why}`);
    }
  }
  if (!pf.ids.some((c) => c in p.claims)) out.push(`claims: must name the project by an id, ${pf.ids.join(" or ")}: a name can be registered again by anyone`);
  if (p.grants.length === 0) out.push("grants: must grant a role on a mask");
  p.grants.forEach((g, i) => {
    // A body may name any role: the type is what the server answers.
    const role: string = g.role;
    if (role === "admin") out.push(`grants[${i}].role: admin is not for a CI token: reader, writer or maintainer`);
    else if (!ROLES.includes(role)) out.push(`grants[${i}].role: ${q(role)} is not reader, writer or maintainer`);
    const why = maskProblem(g.mask);
    if (why) out.push(`grants[${i}].mask: ${why}`);
  });
  if (!writes(p)) return out;
  if (!pf.writeConditions.some((c) => c in p.claims)) {
    out.push(`claims: a policy that grants writer or maintainer needs ${pf.writeConditions.join(", ")}: without it every branch and pull request publishes`);
  }
  const events = p.claims[pf.event];
  if (events?.length && events.every((e) => pf.pullRequests.includes(e))) out.push(`claims.${pf.event}: names only pull requests, which never write`);
  return out;
}

// --- A request's body -------------------------------------------------------------------------

/** Go's encoding/json's name of a JSON value of the wrong type. */
const kind = (v: unknown) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v === "boolean" ? "bool" : typeof v);

/** The fields of a body that the server reads, and those it ignores (CIPolicy). */
const READ = ["name", "issuer", "claims", "grants", "expiresAt"];
const IGNORED = ["source", "state", "renewal", "createdBy", "createdAt", "updatedBy", "updatedAt", "approvedBy", "approvedAt"];

type Body = CIPolicySpec & { expiresAt?: number };

/** The body of a POST or a PUT as the server decodes it: an unknown field refused, the ignored
 * ones ignored, null as absent. */
function decodePolicy(body: unknown): Body | CIRefusal {
  if (body === null || body === undefined) return invalid("body: must be a JSON object");
  if (typeof body !== "object" || Array.isArray(body)) return invalid(`body: must be a JSON object, not ${kind(body)}`);
  const b = body as Record<string, unknown>;
  const unknown = Object.keys(b).find((k) => !READ.includes(k) && !IGNORED.includes(k));
  if (unknown) return invalid(`body: unknown field ${q(unknown)}`);
  const out: Body = { name: "", issuer: "", claims: {}, grants: [] };
  for (const k of ["name", "issuer"] as const) {
    if (b[k] === null || b[k] === undefined) continue;
    if (typeof b[k] !== "string") return invalid(`${k}: must not be a JSON ${kind(b[k])}`);
    out[k] = b[k];
  }
  if (b.claims !== null && b.claims !== undefined) {
    if (typeof b.claims !== "object" || Array.isArray(b.claims)) return invalid(`claims: must not be a JSON ${kind(b.claims)}`);
    for (const [c, values] of Object.entries(b.claims as Record<string, unknown>)) {
      if (values === null) {
        out.claims[c] = [];
        continue;
      }
      if (!Array.isArray(values)) return invalid(`claims: must not be a JSON ${kind(values)}`);
      const bad = values.find((v) => typeof v !== "string");
      if (bad !== undefined) return invalid(`claims: must not be a JSON ${kind(bad)}`);
      out.claims[c] = values as string[];
    }
  }
  if (b.grants !== null && b.grants !== undefined) {
    if (!Array.isArray(b.grants)) return invalid(`grants: must not be a JSON ${kind(b.grants)}`);
    for (const g of b.grants as unknown[]) {
      if (typeof g !== "object" || g === null || Array.isArray(g)) return invalid(`grants: must not be a JSON ${kind(g)}`);
      const extra = Object.keys(g).find((k) => k !== "role" && k !== "mask");
      if (extra) return invalid(`body: unknown field ${q(extra)}`);
      const { role = "", mask = "" } = g as Record<string, unknown>;
      if (typeof role !== "string" || typeof mask !== "string") return invalid(`grants.${typeof role !== "string" ? "role" : "mask"}: must not be a JSON ${kind(typeof role !== "string" ? role : mask)}`);
      out.grants.push({ role: role as CIGrant["role"], mask });
    }
  }
  const at = expiresAt(b.expiresAt);
  if (typeof at === "object") return at;
  if (at !== undefined) out.expiresAt = at;
  return out;
}

/** An RFC 3339 time of a body, in milliseconds; undefined when absent. */
function expiresAt(v: unknown): number | undefined | CIRefusal {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== "string") return invalid(`expiresAt: must not be a JSON ${kind(v)}`);
  const t = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(v) ? Date.parse(v) : NaN;
  if (Number.isNaN(t)) return invalid(`body: parsing time ${q(v)} as "2006-01-02T15:04:05Z07:00": not an RFC 3339 time`);
  return t;
}

// --- The steps of a policy that writes (internal/auth/ci/write.go) ----------------------------

/** Methods of authentication of RFC 8176 by the kind of factor (auth.SecondFactor). */
const FACTORS: Record<string, string[]> = {
  knowledge: ["pwd", "pin", "kba"],
  possession: ["hwk", "swk", "otp", "sms", "tel", "sc", "pop"],
  inherence: ["fpt", "face", "iris", "retina", "vbm"],
};

/** Whether an amr shows a second factor: mfa, or methods of two kinds, with auth.oidc.mfa empty
 * (the demo's). */
function secondFactor(amr: string[]): boolean {
  if (amr.includes("mfa")) return true;
  return Object.values(FACTORS).filter((methods) => methods.some((m) => amr.includes(m))).length >= 2;
}

/** A duration as Go's time.Duration prints it, to the second: 1h2m3s, 12m0s, 45s. */
function goDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h${m}m${s % 60}s` : m ? `${m}m${s % 60}s` : `${s}s`;
}

const HOW = "sign in again in a web UI through OIDC (prompt=login), with a second factor";

/** Why the credential is no fresh sign-in with a second factor at now, or null (auth.FreshSignIn):
 * 403, its message ending in what to do. */
function freshSignIn(cred: Credential, now: number): string | null {
  const signIn = cred.kind === "sign-in" ? cred.signIn : undefined;
  if (!signIn) {
    const name = cred.kind === "password" ? "a password" : "a personal access token, or a web UI's token of a password or of a login without auth_time";
    return `this needs a sign-in with a second factor within the last 10 minutes, and the request's credential is ${name}: ${HOW}`;
  }
  const age = now - signIn.at;
  if (age > FRESH) {
    return `this needs a sign-in with a second factor within the last 10 minutes, and this sign-in authenticated at the identity provider ${goDuration(age)} ago: ${HOW}`;
  }
  if (age < -LEEWAY) return `the sign-in's auth_time is ahead of this server's clock: ${HOW}`;
  if (!secondFactor(signIn.amr)) return `this needs a sign-in with a second factor, and this sign-in's amr (${signIn.amr.join(" ") || "none"}) shows none: ${HOW}`;
  return null;
}

/** Whether every repo of inner, one of outer matches too (config.MaskWithin). */
function maskWithin(inner: string, outer: string): boolean {
  if (maskProblem(inner) || maskProblem(outer)) return false;
  const [f, r] = inner.split("/");
  const [of, or] = outer.split("/");
  return (of === "*" || of === f) && (or === "*" || or === r);
}

/** The first grant that writes outside auth.ci.apiWriteRepos, refused naming it. */
function writeRepos(grants: CIGrant[]): CIRefusal | null {
  const i = grants.findIndex((g) => writesRole(g.role) && !ciConfig.apiWriteRepos.some((outer) => maskWithin(g.mask, outer)));
  if (i < 0) return null;
  const allowed = ciConfig.apiWriteRepos.length
    ? `${ciConfig.apiWriteRepos.join(", ")}; write to other repos in the configuration (auth.ci.policies)`
    : "none: write it in the configuration (auth.ci.policies)";
  return forbidden(`grants[${i}]: ${grants[i]!.role} on ${grants[i]!.mask} is outside auth.ci.apiWriteRepos, ${allowed}`);
}

/** What a create, a change or a renewal of a policy with grants that write takes at now, and its
 * expiry: the repos, the expiry asked, the sign-in (writeSteps). */
function writeSteps(grants: CIGrant[], asked: number | undefined, cred: Credential, now: number): number | CIRefusal {
  const refused = writeRepos(grants);
  if (refused) return refused;
  if (asked !== undefined && asked <= now) return invalid("expiresAt: must be in the future");
  if (asked !== undefined && asked > now + WRITE_LIFETIME) return invalid("expiresAt: must be at most 180 days ahead, a policy that grants write is renewed");
  const why = freshSignIn(cred, now);
  if (why) return forbidden(`a policy of the API that grants write: ${why}`);
  return asked ?? now + WRITE_LIFETIME;
}

/** The state and the expiry of a policy as a create or a change leaves it (steps): one that
 * reads counts at once and does not expire. */
function steps(p: Body, cred: Credential, now: number): Pick<CIPolicyRow, "state" | "expiresAt"> | CIRefusal {
  if (!writes(p)) {
    if (p.expiresAt !== undefined) return invalid("expiresAt: a policy that grants reader only does not expire");
    return { state: "active" };
  }
  const exp = writeSteps(p.grants, p.expiresAt, cred, now);
  if (typeof exp === "object") return exp;
  return { state: waits(), expiresAt: iso(exp) };
}

/** The state of a policy that writes once its steps are taken. */
const waits = () => (ciConfig.apiWriteApproval === "none" ? "active" : "pending");

// --- Revisions (internal/api/etag.go) ---------------------------------------------------------

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");

/** The ETag of a row: the first 12 bytes of the sha256 of ci_policies/<id>/<revision>, base64url. */
export function etagOf(r: Pick<CIPolicyRow, "id" | "revision">): string {
  const bytes = sha256Hex(`ci_policies/${r.id}/${r.revision}`)
    .slice(0, 24)
    .match(/../g)!
    .map((h) => parseInt(h, 16));
  return `"${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}"`;
}

/** The entity tags of an If-Match or If-None-Match; null for *, undefined without the header. */
function parseTags(header: string, v: string | null): string[] | null | undefined | CIRefusal {
  if (v === null) return undefined;
  if (v.trim() === "*") return null;
  const tags = v
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const bad = tags.length === 0 || tags.some((t) => !/^(W\/)?"[^"]*"$/.test(t));
  if (bad) return invalid(`${header}: ${q(v)} is not * or a list of entity tags, such as the "…" of the ETag a GET answered`);
  return tags;
}

/** 412 when If-Match names no revision the row has: nothing changed. */
function checkCondition(tags: string[] | null | undefined, r: CIPolicyRow): CIRefusal | null {
  if (!tags) return null;
  const now = etagOf(r);
  if (tags.includes(now)) return null;
  return { status: 412, code: "CONFLICT", message: `CI trust policy ${r.name} changed since it was read: its ETag is now ${now}; read it again and send the change again`, etag: now };
}

// --- The resource -----------------------------------------------------------------------------

const expired = (r: CIPolicyRow, now: number) => r.state === "expired" || (r.expiresAt !== undefined && Date.parse(r.expiresAt) <= now);

/** A row as the API shows it at now: past its expiry, expired, marked or not. */
function fromRow(r: CIPolicyRow, now: number): CIPolicy {
  return {
    name: r.name,
    issuer: r.issuer,
    claims: structuredClone(r.claims),
    grants: r.grants.map((g) => ({ ...g })),
    ...(r.expiresAt ? { expiresAt: r.expiresAt } : {}),
    source: "api",
    state: expired(r, now) ? "expired" : r.state,
    ...(r.renewalExpiresAt ? { renewal: { expiresAt: r.renewalExpiresAt } } : {}),
    createdBy: apiPrincipal(r.createdBy),
    createdAt: r.createdAt,
    updatedBy: apiPrincipal(r.updatedBy),
    updatedAt: r.updatedAt,
    ...(r.approvedBy ? { approvedBy: apiPrincipal(r.approvedBy) } : {}),
    ...(r.approvedAt ? { approvedAt: r.approvedAt } : {}),
  };
}

/** A policy of the configuration: always active, claims by name. */
function fromConfig(p: CIPolicySpec): CIPolicy {
  const claims = Object.fromEntries(Object.keys(p.claims).sort().map((c) => [c, [...p.claims[c]!]]));
  return { name: p.name, issuer: p.issuer, claims, grants: p.grants.map((g) => ({ ...g })), source: "config", state: "active" };
}

const configPolicy = (name: string) => ciConfig.policies.find((p) => p.name === name);
const readOnly = (name: string) =>
  configPolicy(name) ? conflict(`policy ${name} is declared in the configuration (auth.ci.policies): it changes there`) : null;
const notFound = (name: string): CIRefusal => ({ status: 404, code: "NOT_FOUND", message: `policy ${name} does not exist` });

/** The audit row of a change (ci.Service.changed): the policy as the change left it, the
 * previous one of a change, a renewal and an approval, and the origin. */
function record(action: string, r: CIPolicyRow, by: string, previous?: CIPolicyRow): void {
  const details: Record<string, unknown> = { issuer: r.issuer, claims: r.claims, grants: r.grants, state: r.state };
  if (r.expiresAt) details.expiresAt = r.expiresAt;
  if (r.renewalExpiresAt) details.renewalExpiresAt = r.renewalExpiresAt;
  if (previous) details.previous = { issuer: previous.issuer, claims: previous.claims, grants: previous.grants, state: previous.state };
  audited({ principal: by, action, repo: "", subject: r.name, details: { ...structuredClone(details), source: "api" } });
}

/** What a change keeps of a row: what never changes. */
const pick = (r: CIPolicyRow) => ({ id: r.id, revision: r.revision, name: r.name, createdBy: r.createdBy, createdAt: r.createdAt, updatedAt: r.updatedAt });

/** Stores the change of a row: a new revision, its time and its row. */
function stored(r: CIPolicyRow, now: number): CIPolicyRow {
  r.revision++;
  r.updatedAt = iso(now);
  rows.splice(
    rows.findIndex((x) => x.id === r.id),
    1,
    r,
  );
  return r;
}

// --- The operations ---------------------------------------------------------------------------

/** GET /api/v1/ci/policies: the configuration's in its order, then the API's by id; and the
 * issuers, as the UI proposes. */
export function listCIPolicies(now = Date.now()): CIPolicyList {
  return {
    policies: [...ciConfig.policies.map(fromConfig), ...[...rows].sort((a, b) => a.id - b.id).map((r) => fromRow(r, now))],
    issuers: ciConfig.issuers.map((i) => ({ ...i })),
  };
}

/** GET …/{name}: one of the API with its ETag, 304 for an If-None-Match that names it. */
export function getCIPolicy(name: string, ifNoneMatch: string | null, now = Date.now()): (Tagged & { notModified?: boolean }) | CIRefusal {
  const c = configPolicy(name);
  if (c) return { policy: fromConfig(c), etag: null };
  const r = rows.find((x) => x.name === name);
  if (!r) return notFound(name);
  const tags = parseTags("If-None-Match", ifNoneMatch);
  if (tags !== undefined && tags !== null && "status" in tags) return tags;
  const etag = etagOf(r);
  const notModified = tags === null || (tags !== undefined && tags.some((t) => t.replace(/^W\//, "") === etag));
  return { policy: fromRow(r, now), etag, ...(notModified ? { notModified } : {}) };
}

/** POST /api/v1/ci/policies, by the mock principal by with the credential cred. */
export function createCIPolicy(body: unknown, by: string, cred: Credential, now = Date.now()): Tagged | CIRefusal {
  const p = decodePolicy(body);
  if ("status" in p) return p;
  const broken = problems(p);
  if (broken.length) return invalid(broken.join("; "));
  if (configPolicy(p.name)) return conflict(`policy ${p.name} is a policy of the configuration (auth.ci.policies)`);
  const s = steps(p, cred, now);
  if ("status" in s) return s;
  if (rows.some((r) => r.name === p.name)) return conflict(`policy ${p.name} exists already`);
  const at = iso(now);
  const r: CIPolicyRow = { id: nextId++, revision: 1, name: p.name, issuer: p.issuer, claims: p.claims, grants: p.grants, ...s, createdBy: by, createdAt: at, updatedBy: by, updatedAt: at };
  rows.push(r);
  record("ci.policy.create", r, by);
  persist();
  return { policy: fromRow(r, now), etag: etagOf(r) };
}

/** The row of name, the If-Match of the request checked on it. */
function conditioned(name: string, ifMatch: string | null): { row: CIPolicyRow; tags: string[] | null | undefined } | CIRefusal {
  const tags = parseTags("If-Match", ifMatch);
  if (tags && "status" in tags) return tags;
  const row = rows.find((x) => x.name === name);
  if (!row) return notFound(name);
  const changed = checkCondition(tags, row);
  return changed ?? { row, tags };
}

/** PUT …/{name}: the issuer, the claims, the grants and the expiry replaced; a change that leaves
 * it writing takes the steps of a create and waits for an approval again. */
export function replaceCIPolicy(name: string, body: unknown, ifMatch: string | null, by: string, cred: Credential, now = Date.now()): Tagged | CIRefusal {
  const badTags = parseTags("If-Match", ifMatch);
  if (badTags && "status" in badTags) return badTags;
  const p = decodePolicy(body);
  if ("status" in p) return p;
  if (p.name !== "" && p.name !== name) return invalid(`name: ${q(p.name)} is not the policy's, ${name}: a policy is not renamed`);
  p.name = name;
  const ro = readOnly(name);
  if (ro) return ro;
  const broken = problems(p);
  if (broken.length) return invalid(broken.join("; "));
  const s = steps(p, cred, now);
  if ("status" in s) return s;
  const c = conditioned(name, ifMatch);
  if ("status" in c) return c;
  // The change is the whole policy: no renewal waits, and no approval holds for it.
  const old = c.row;
  const r: CIPolicyRow = { ...pick(old), issuer: p.issuer, claims: p.claims, grants: p.grants, ...s, updatedBy: by };
  stored(r, now);
  record("ci.policy.update", r, by, old);
  persist();
  return { policy: fromRow(r, now), etag: etagOf(r) };
}

/** DELETE …/{name}: no step, a policy that writes too. */
export function deleteCIPolicy(name: string, ifMatch: string | null, by: string): CIRefusal | null {
  const badTags = parseTags("If-Match", ifMatch);
  if (badTags && "status" in badTags) return badTags;
  const ro = readOnly(name);
  if (ro) return ro;
  const c = conditioned(name, ifMatch);
  if ("status" in c) return c;
  rows.splice(rows.indexOf(c.row), 1);
  record("ci.policy.delete", c.row, by);
  persist();
  return null;
}

/** POST …/{name}/renew: a new expiry, under the steps of a change. The renewal of a policy that
 * counts waits beside it; that of an expired one waits pending. */
export function renewCIPolicy(name: string, body: unknown, ifMatch: string | null, by: string, cred: Credential, now = Date.now()): Tagged | CIRefusal {
  const badTags = parseTags("If-Match", ifMatch);
  if (badTags && "status" in badTags) return badTags;
  let asked: number | undefined;
  if (body !== null && body !== undefined) {
    if (typeof body !== "object" || Array.isArray(body)) return invalid(`body: must be a JSON object, not ${kind(body)}`);
    const extra = Object.keys(body).find((k) => k !== "expiresAt");
    if (extra) return invalid(`body: unknown field ${q(extra)}`);
    const at = expiresAt((body as { expiresAt?: unknown }).expiresAt);
    if (typeof at === "object") return at;
    asked = at;
  }
  const ro = readOnly(name);
  if (ro) return ro;
  const c = conditioned(name, ifMatch);
  if ("status" in c) return c;
  const old = c.row;
  if (!writes(old)) return conflict(`policy ${name} grants reader only: it does not expire`);
  if (old.state === "pending") return conflict(`policy ${name} waits for an admin's approval: approve it, or change it with its new expiresAt`);
  const exp = writeSteps(old.grants, asked, cred, now);
  if (typeof exp === "object") return exp;
  const r: CIPolicyRow = { ...old, updatedBy: by };
  delete r.renewalExpiresAt;
  if (waits() === "active") {
    r.expiresAt = iso(exp);
    r.state = "active";
  } else if (expired(old, now)) {
    r.expiresAt = iso(exp);
    r.state = "pending";
    delete r.approvedBy;
    delete r.approvedAt;
  } else {
    r.renewalExpiresAt = iso(exp);
  }
  stored(r, now);
  record("ci.policy.renew", r, by, old);
  persist();
  return { policy: fromRow(r, now), etag: etagOf(r) };
}

/** POST …/{name}/approve: what waits, a pending policy or its renewal, by an admin other than
 * the one who made the change, with the ETag of the revision approved. */
export function approveCIPolicy(name: string, ifMatch: string | null, by: string, cred: Credential, now = Date.now()): Tagged | CIRefusal {
  const tags = parseTags("If-Match", ifMatch);
  if (tags && "status" in tags) return tags;
  const ro = readOnly(name);
  if (ro) return ro;
  if (!tags) return invalid("If-Match: an approval names the revision it approves: send the ETag of the policy as you read it");
  const why = freshSignIn(cred, now);
  if (why) return forbidden(`an approval: ${why}`);
  const c = conditioned(name, ifMatch);
  if ("status" in c) return c;
  const old = c.row;
  const r: CIPolicyRow = { ...old };
  if (old.state === "pending") r.state = "active";
  else if (old.renewalExpiresAt) {
    r.expiresAt = old.renewalExpiresAt;
    delete r.renewalExpiresAt;
    r.state = "active";
  } else return conflict(`policy ${name} waits for no approval`);
  if (by === old.updatedBy) return forbidden(`policy ${name}: the admin who made the change that waits does not approve it: another admin does`);
  if (!r.expiresAt || Date.parse(r.expiresAt) <= now) return conflict(`policy ${name}: its expiry passed before the approval: renew it`);
  const outside = writeRepos(old.grants);
  if (outside) return outside;
  r.approvedBy = by;
  r.approvedAt = iso(now);
  stored(r, now);
  record("ci.policy.approve", r, by, old);
  persist();
  return { policy: fromRow(r, now), etag: etagOf(r) };
}
