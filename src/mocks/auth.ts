// Authentication and tokens of the mock, after the server's docs/auth.md and docs/api.md:
// Basic with a password or a personal access token, Bearer with a personal access token, and on
// /api/ DPoP with the token of a sign-in (POST /api/v1/login) and a proof of its key
// (src/mocks/dpop.ts); refused credentials answered 401. In the demo a user's password is the
// user's name: admin / admin, alice / alice; a disabled user is refused whatever the password,
// and an inactive one is disabled once its credential has verified (src/mocks/db.ts,
// authenticated).

import type { CreatedToken, LoginToken, Token, TokenRequest, TokenScope } from "@/api/types";
import { sha256Hex } from "@/lib/sha256";

import { passwords, serverInfo, tokens, users } from "./data/system";
import { authenticated } from "./db";
import { spendProof, verifyProof } from "./dpop";
import type { Credential, SignIn } from "./persona";
import { keep, persist } from "./state";

/** Why a request's DPoP credentials are refused: the challenge of RFC 9449 §7.1, with the reason
 * of a refused proof. */
export type DpopRefusal = { error: "invalid_dpop_proof" | "invalid_token"; why?: string; message?: string };

/** The principal of a request, a user name or "anonymous", and its credential; or the reason it
 * is refused, with the DPoP challenge on /api/ when the token is a sign-in's or came as DPoP. */
export type Authn = { principal: string; credential: Credential } | { refused: true; dpop?: DpopRefusal };

const anonymous: Authn = { principal: "anonymous", credential: { kind: "none" } };

/** Secrets of the tokens created in this page, by token id; the seeded tokens have none. */
const secrets = new Map<string, number>();

/** The sign-ins of OIDC logins, by the id of their token. The demo has no OIDC login, so its
 * sign-ins have none, and a step that needs a fresh one with a second factor refuses them as the
 * server refuses a password's sign-in; the tests give a token the sign-in that a login with
 * prompt=login would (recordSignIn). */
const signIns = new Map<number, SignIn>();

/** What an OIDC login keeps on the token of its code: when and how the person authenticated at
 * the IdP (rbac.md §10). */
export function recordSignIn(tokenId: number, signIn: SignIn): void {
  signIns.set(tokenId, signIn);
}

let nextId = Math.max(...tokens.map((t) => t.id)) + 1;

// The tokens as they are now and the secrets of the ones created in the demo, kept between
// visits (src/mocks/state.ts).
keep("tokens", {
  save: () => ({ tokens, secrets: [...secrets], nextId }),
  load: (data) => {
    const d = data as { tokens?: unknown; secrets?: unknown; nextId?: unknown };
    if (!Array.isArray(d.tokens) || !Array.isArray(d.secrets) || typeof d.nextId !== "number") return;
    tokens.splice(0, tokens.length, ...(d.tokens as Token[]));
    secrets.clear();
    for (const [secret, id] of d.secrets as [string, number][]) secrets.set(secret, id);
    nextId = d.nextId;
  },
});

function live(t: Token, now = Date.now()): boolean {
  return t.revokedAt === null && (t.expiresAt === null || Date.parse(t.expiresAt) > now);
}

function enabledUser(name: string): boolean {
  return users.some((u) => u.name === name && !u.disabled);
}

/** A password set through the API, or else the name of a local user of the seed; an OIDC user
 * has none until one is set (src/mocks/data/system.ts, passwords). */
function passwordMatches(name: string, secret: string): boolean {
  const set = passwords.get(name);
  if (set !== undefined) return set === sha256Hex(secret);
  return secret === name && users.some((u) => u.name === name && u.kind === "local");
}

function tokenOf(secret: string): Token | null {
  const id = secrets.get(secret);
  const t = id === undefined ? undefined : tokens.find((x) => x.id === id);
  return t && live(t) ? t : null;
}

function touch(t: Token): void {
  const now = new Date();
  now.setSeconds(0, 0); // the server keeps lastUsedAt to the minute
  const minute = now.toISOString();
  if (t.lastUsedAt === minute) return;
  t.lastUsedAt = minute;
  persist();
}

function decodeBasic(value: string): { user: string; secret: string } | null {
  try {
    const binary = atob(value);
    const text = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    const i = text.indexOf(":");
    return i < 0 ? null : { user: text.slice(0, i), secret: text.slice(i + 1) };
  } catch {
    return null;
  }
}

/** The token of a sign-in as DPoP on /api/: the proof first, then the token and its key, which
 * must be the proof's, then the proof's jti, used once (docs/spec/http-routing.md §4). */
async function authenticateDpop(request: Request, secret: string): Promise<Authn> {
  if (!new URL(request.url).pathname.startsWith("/api/")) return { refused: true };
  const proof = await verifyProof(request, secret);
  if ("why" in proof) return { refused: true, dpop: { error: "invalid_dpop_proof", why: proof.why } };
  const t = tokenOf(secret);
  if (!t?.user || !t.dpopJkt || t.dpopJkt !== proof.jkt || !enabledUser(t.user)) return { refused: true, dpop: { error: "invalid_token" } };
  const used = spendProof(proof);
  if (used) return { refused: true, dpop: { error: "invalid_dpop_proof", why: used } };
  if (idle(t)) {
    t.revokedAt = new Date().toISOString();
    persist();
    return { refused: true, dpop: { error: "invalid_token", why: "idle", message: "the sign-in was idle for longer than the server allows: sign in again" } };
  }
  if (!authenticated(t.user)) return { refused: true, dpop: { error: "invalid_token" } };
  touch(t);
  return { principal: t.user, credential: { kind: "sign-in", signIn: signIns.get(t.id) } };
}

/** Whether a sign-in's token went unused for longer than info.login.idleTimeout: refused, after
 * its proof is spent, and revoked (rbac.md §10, Idle). Its last use is kept to the minute, so it
 * is refused between a minute short of the bound and the bound. */
function idle(t: Token, now = Date.now()): boolean {
  const bound = serverInfo.login?.idleTimeout ?? 0;
  return bound > 0 && now - Date.parse(t.lastUsedAt ?? t.createdAt) > bound * 1000;
}

export async function authenticate(request: Request): Promise<Authn> {
  const path = new URL(request.url).pathname;
  // The sign-in takes no credential: a UI whose stored token was revoked signs in all the same.
  if (request.method === "POST" && path === "/api/v1/login") return anonymous;
  const header = request.headers.get("Authorization");
  if (!header) return anonymous;
  const space = header.indexOf(" ");
  const scheme = (space < 0 ? header : header.slice(0, space)).toLowerCase();
  const value = space < 0 ? "" : header.slice(space + 1).trim();
  // A token bound to a key works as DPoP only: as a bearer or in Basic it is refused, on /api/
  // with the DPoP challenge (RFC 9449 §7.2).
  const bound: Authn = path.startsWith("/api/") ? { refused: true, dpop: { error: "invalid_token" } } : { refused: true };

  if (scheme === "dpop") return authenticateDpop(request, value);
  if (scheme === "bearer") {
    // Any other bearer goes on as anonymous with the header untouched (docs/auth.md).
    if (value.startsWith("ljs_dep_")) return { refused: true };
    if (!value.startsWith("ljs_pat_")) return anonymous;
    const t = tokenOf(value);
    if (!t?.user || !enabledUser(t.user)) return { refused: true };
    if (t.dpopJkt) return bound;
    if (!authenticated(t.user)) return { refused: true };
    touch(t);
    return { principal: t.user, credential: { kind: "token" } };
  }
  if (scheme === "basic") {
    const creds = decodeBasic(value);
    if (!creds || !enabledUser(creds.user)) return { refused: true };
    if (creds.secret.startsWith("ljs_pat_")) {
      const t = tokenOf(creds.secret);
      if (!t || t.user !== creds.user) return { refused: true };
      if (t.dpopJkt) return bound;
      if (!authenticated(creds.user)) return { refused: true };
      touch(t);
      return { principal: creds.user, credential: { kind: "token" } };
    }
    if (!passwordMatches(creds.user, creds.secret) || !authenticated(creds.user)) return { refused: true };
    return { principal: creds.user, credential: { kind: "password" } };
  }
  return anonymous;
}

/** Whether the request's credential is a user's password rather than a token: what creating a
 * deploy token over a mask takes (docs/api.md, Deploy tokens over a mask). authenticate has
 * checked the password already. */
export function byPassword(request: Request): boolean {
  const header = request.headers.get("Authorization") ?? "";
  if (!/^basic /i.test(header)) return false;
  const creds = decodeBasic(header.slice(6).trim());
  return creds !== null && !creds.secret.startsWith("ljs_");
}

/** A failure the handler answers with the error envelope. */
export type Refusal = { status: number; code: string; message: string };

const DAY = 24 * 60 * 60 * 1000;

/** expiresIn: a number of days, "30d", or a duration in hours or minutes ("12h", "90m"). */
function parseExpiresIn(v: string): number | null {
  const m = /^(\d+)(d|h|m)?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "h" ? n * 60 * 60 * 1000 : m[2] === "m" ? n * 60 * 1000 : n * DAY;
}

function randomSecret(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return prefix + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Whose a token is: a user's personal access token, a repo's deploy token, or a deploy token
 * over a mask of repos. */
type Owner = { user: string } | { repo: string } | { repoMask: string };

function owns(owner: Owner, t: Token): boolean {
  if ("user" in owner) return t.kind === "pat" && t.user === owner.user;
  if ("repo" in owner) return t.kind === "deploy" && t.repo === owner.repo;
  return t.kind === "deploy" && t.repoMask === owner.repoMask;
}

const ownerName = (owner: Owner) => ("user" in owner ? owner.user : "repo" in owner ? owner.repo : owner.repoMask);

/** Creates a personal access token of a user, or a deploy token of a repo or over a mask, with
 * the rules of docs/api.md (Tokens): the name, the scopes, the expiry and the uniqueness of the
 * name. */
export function createToken(owner: Owner, body: unknown): CreatedToken | Refusal {
  const invalid = (message: string): Refusal => ({ status: 400, code: "INVALID", message });
  if (typeof body !== "object" || body === null) return invalid("the body must be a JSON object");
  const req = body as Partial<TokenRequest> & Record<string, unknown>;
  const known = new Set(["name", "scopes", "expiresIn", "expiresAt"]);
  const unknown = Object.keys(req).find((k) => !known.has(k));
  if (unknown) return invalid(`${unknown}: not a field of a token`);

  const deploy = !("user" in owner);
  const name = typeof req.name === "string" ? req.name : "";
  if (new TextEncoder().encode(name).length < 1 || new TextEncoder().encode(name).length > 64 || /[\p{Cc}]/u.test(name)) {
    return invalid("name: 1 to 64 bytes of printable UTF-8");
  }
  const scopes = req.scopes ?? [];
  if (!Array.isArray(scopes) || scopes.some((s) => s !== "read" && s !== "write")) {
    return invalid(deploy ? "scopes: read, write or both; delete and manage are refused for a deploy token" : "scopes: read, write or both");
  }
  if (deploy && scopes.length === 0) return invalid("scopes: a deploy token needs read, write or both");

  if (req.expiresIn !== undefined && req.expiresAt !== undefined) return invalid("expiresAt and expiresIn: one of them at most");
  const now = Date.now();
  let expiresAt: string | null = deploy ? null : new Date(now + 90 * DAY).toISOString();
  if (req.expiresIn !== undefined) {
    const ms = typeof req.expiresIn === "string" || typeof req.expiresIn === "number" ? parseExpiresIn(String(req.expiresIn)) : null;
    if (ms === null || ms <= 0) return invalid("expiresIn: a number of days, 30d, or a duration such as 12h");
    expiresAt = new Date(now + ms).toISOString();
  } else if (req.expiresAt !== undefined) {
    const t = typeof req.expiresAt === "string" ? Date.parse(req.expiresAt) : NaN;
    if (Number.isNaN(t)) return invalid("expiresAt: an RFC 3339 time");
    if (t <= now) return invalid("expiresAt: in the past");
    expiresAt = new Date(t).toISOString();
  }
  if (expiresAt && Date.parse(expiresAt) > now + 365 * DAY) return invalid("expiresAt: at most 365 days ahead");

  if (tokens.some((t) => owns(owner, t) && live(t, now) && t.name === name)) {
    return { status: 409, code: "CONFLICT", message: `a live token of ${ownerName(owner)} is named ${name}` };
  }

  const secret = randomSecret(deploy ? "ljs_dep_" : "ljs_pat_");
  const token: Token = {
    id: nextId++,
    kind: deploy ? "deploy" : "pat",
    name,
    ...owner,
    scopes: [...new Set(scopes)].sort() as TokenScope[],
    expiresAt,
    lastUsedAt: null,
    createdAt: new Date(now).toISOString(),
    revokedAt: null,
    hashPrefix: sha256Hex(secret).slice(0, 8),
  };
  tokens.push(token);
  secrets.set(secret, token.id);
  persist();
  return { ...token, secret };
}

/** Revokes a token of the owner: true when the id is one of its tokens (revoked already too);
 * owner "mask" for any deploy token over a mask. */
export function revokeToken(owner: Exclude<Owner, { repoMask: string }> | "mask", id: number): boolean {
  const t = tokens.find((x) => x.id === id && (owner === "mask" ? x.kind === "deploy" && x.repoMask !== undefined : owns(owner, x)));
  if (!t) return false;
  if (t.revokedAt === null) {
    t.revokedAt = new Date().toISOString();
    persist();
  }
  return true;
}

/**
 * POST /api/v1/login (docs/api.md, Sign in), in the server's order: the body's form, then the
 * proof (400 saying why, before the credential is checked), then the password (401 whatever the
 * reason). The answer is a personal access token of the user without scopes, bound to the
 * proof's key (dpopJkt), expiring after info.login.tokenLifetime, named login <time> <4 hex>. The
 * demo has no OIDC login, so it knows no code.
 */
export async function login(request: Request, body: unknown): Promise<LoginToken | Refusal> {
  const invalid = (message: string): Refusal => ({ status: 400, code: "INVALID", message });
  const b = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const fields = Object.keys(b).sort().join(" ");
  const strings = (...keys: string[]) => keys.every((k) => typeof b[k] === "string");
  const byPassword = fields === "password username" && strings("username", "password");
  const byCode = fields === "code codeVerifier" && strings("code", "codeVerifier");
  if (!byPassword && !byCode) return invalid('body: must be {"username", "password"} or {"code", "codeVerifier"}');

  const proof = await verifyProof(request, null);
  const refused = "why" in proof ? proof.why : spendProof(proof);
  if (refused || "why" in proof) return invalid(`DPoP: ${refused}`);
  if (byCode) return invalid("code: unknown, used, expired, or of another verifier or key: sign in again");

  const user = b.username as string;
  if (!enabledUser(user) || !passwordMatches(user, b.password as string) || !authenticated(user)) {
    return { status: 401, code: "UNAUTHENTICATED", message: "the user name or the password is wrong" };
  }
  const now = Date.now();
  const stamp = new Date(now - (now % 1000)).toISOString().replace(".000Z", "Z");
  const secret = randomSecret("ljs_pat_");
  const token: Token = {
    id: nextId++,
    kind: "pat",
    name: `login ${stamp} ${randomSecret("").slice(0, 4)}`,
    user,
    scopes: [],
    expiresAt: new Date(now + serverInfo.login.tokenLifetime * 1000).toISOString(),
    lastUsedAt: null,
    createdAt: new Date(now).toISOString(),
    revokedAt: null,
    hashPrefix: sha256Hex(secret).slice(0, 8),
    dpopJkt: proof.jkt,
  };
  tokens.push(token);
  secrets.set(secret, token.id);
  persist();
  return { ...token, secret, tokenType: "DPoP" };
}
