// Authentication and tokens of the mock, after the server's docs/auth.md and docs/api.md:
// Basic with a password or a personal access token, Bearer with a personal access token,
// refused credentials answered 401. The mock takes any password of a user that is not disabled.

import type { CreatedToken, Token, TokenRequest, TokenScope } from "@/api/types";
import { DEMO_STATE } from "@/app/demo";
import { sha256Hex } from "@/lib/sha256";

import { tokens, users } from "./data/system";

/** The principal of a request: a user name or "anonymous"; or the reason it is refused. */
export type Authn = { principal: string } | { refused: true };

/** Secrets of the tokens created in this page, by token id; the seeded tokens have none. */
const secrets = new Map<string, number>();

let nextId = Math.max(...tokens.map((t) => t.id)) + 1;

/** What the demo keeps between visits: the tokens as they are now and the secrets of the ones
 * created in it. Only in this browser's localStorage, like everything of the demo. */
type DemoState = { version: 1; tokens: Token[]; secrets: [string, number][]; nextId: number };

function persist(): void {
  if (typeof window === "undefined") return; // tests: no browser, nothing to keep
  const state: DemoState = { version: 1, tokens, secrets: [...secrets], nextId };
  try {
    localStorage.setItem(DEMO_STATE, JSON.stringify(state));
  } catch {
    // Storage full or disabled: the changes last until the page is reloaded.
  }
}

/** Puts back what the demo kept; called once when the mock starts. */
export function restoreDemoState(): void {
  if (typeof window === "undefined") return;
  let state: DemoState | null;
  try {
    const raw = localStorage.getItem(DEMO_STATE);
    state = raw ? (JSON.parse(raw) as DemoState) : null;
  } catch {
    state = null;
  }
  if (state?.version !== 1 || !Array.isArray(state.tokens) || !Array.isArray(state.secrets)) return;
  tokens.splice(0, tokens.length, ...state.tokens);
  secrets.clear();
  for (const [secret, id] of state.secrets) secrets.set(secret, id);
  nextId = state.nextId;
}

function live(t: Token, now = Date.now()): boolean {
  return t.revokedAt === null && (t.expiresAt === null || Date.parse(t.expiresAt) > now);
}

function enabledUser(name: string): boolean {
  return users.some((u) => u.name === name && !u.disabled);
}

function tokenOf(secret: string): Token | null {
  const id = secrets.get(secret);
  const t = id === undefined ? undefined : tokens.find((x) => x.id === id);
  return t && live(t) ? t : null;
}

function used(t: Token): void {
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

export function authenticate(request: Request): Authn {
  const header = request.headers.get("Authorization");
  if (!header) return { principal: "anonymous" };
  const space = header.indexOf(" ");
  const scheme = (space < 0 ? header : header.slice(0, space)).toLowerCase();
  const value = space < 0 ? "" : header.slice(space + 1).trim();

  if (scheme === "bearer") {
    // Any other bearer goes on as anonymous with the header untouched (docs/auth.md).
    if (value.startsWith("ljs_dep_")) return { refused: true };
    if (!value.startsWith("ljs_pat_")) return { principal: "anonymous" };
    const t = tokenOf(value);
    if (!t?.user || !enabledUser(t.user)) return { refused: true };
    used(t);
    return { principal: t.user };
  }
  if (scheme === "basic") {
    const creds = decodeBasic(value);
    if (!creds || !enabledUser(creds.user)) return { refused: true };
    if (creds.secret.startsWith("ljs_pat_")) {
      const t = tokenOf(creds.secret);
      if (!t || t.user !== creds.user) return { refused: true };
      used(t);
      return { principal: creds.user };
    }
    if (creds.secret.startsWith("ljs_dep_") || creds.secret.length === 0) return { refused: true };
    return { principal: creds.user };
  }
  return { principal: "anonymous" };
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

/** Creates a personal access token of a user or a deploy token of a repo, with the rules of
 * docs/api.md (Tokens): the name, the scopes, the expiry and the uniqueness of the name. */
export function createToken(owner: { user: string } | { repo: string }, body: unknown): CreatedToken | Refusal {
  const invalid = (message: string): Refusal => ({ status: 400, code: "INVALID", message });
  if (typeof body !== "object" || body === null) return invalid("the body must be a JSON object");
  const req = body as Partial<TokenRequest> & Record<string, unknown>;
  const known = new Set(["name", "scopes", "expiresIn", "expiresAt"]);
  const unknown = Object.keys(req).find((k) => !known.has(k));
  if (unknown) return invalid(`${unknown}: not a field of a token`);

  const deploy = "repo" in owner;
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

  const mine = (t: Token) => ("user" in owner ? t.kind === "pat" && t.user === owner.user : t.kind === "deploy" && t.repo === owner.repo);
  if (tokens.some((t) => mine(t) && live(t, now) && t.name === name)) {
    return { status: 409, code: "CONFLICT", message: `a live token of ${"user" in owner ? owner.user : owner.repo} is named ${name}` };
  }

  const secret = randomSecret(deploy ? "ljs_dep_" : "ljs_pat_");
  const token: Token = {
    id: nextId++,
    kind: deploy ? "deploy" : "pat",
    name,
    ...("user" in owner ? { user: owner.user } : { repo: owner.repo }),
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

/** Revokes a token of the owner: true when the id is one of its tokens (revoked already too). */
export function revokeToken(owner: { user: string } | { repo: string }, id: number): boolean {
  const t = tokens.find((x) => x.id === id && ("user" in owner ? x.kind === "pat" && x.user === owner.user : x.kind === "deploy" && x.repo === owner.repo));
  if (!t) return false;
  if (t.revokedAt === null) {
    t.revokedAt = new Date().toISOString();
    persist();
  }
  return true;
}
