// The browser session: a personal access token that the UI sends on every API request (tokens in
// a header, never cookies: the lead's decision in the repository's README). Signing in with a
// password, or through the server's OIDC login, gets a short-lived token bound to a key of this
// browser (POST /api/v1/login, DPoP: src/api/dpop.ts), sent as `Authorization: DPoP` with a proof
// of that key; a server without that route creates the token with the password
// (POST /api/v1/users/{name}/tokens), sent as `Authorization: Bearer`. Signing out revokes it. A
// token pasted by the user is a bearer, only forgotten on sign-out, never revoked: it may be in
// use elsewhere.
//
// The token is kept in localStorage, so that every tab of the UI shares it; its lifetime is the
// token's own expiry on the server. The Content-Security-Policy of the image allows no inline or
// foreign scripts, which is what keeps it from other code. A bound token is of no use without its
// key, which WebCrypto keeps non-extractable in IndexedDB (src/api/dpop-key.ts).

import type { Token } from "./types";

export type Session = {
  /** The secret: ljs_pat_… */
  token: string;
  /** The user the token belongs to (whoami's name). */
  user: string;
  /** The id of the token when the UI created it at sign-in, so that sign-out revokes it; null for
   * a token the user pasted. */
  tokenId: number | null;
  /** RFC 3339; null when unknown (a pasted token). */
  expiresAt: string | null;
  /** How the token is sent: "DPoP", with a proof of this browser's key, for the token of
   * POST /api/v1/login (its tokenType); a bearer when absent, for any other token. */
  tokenType?: "Bearer" | "DPoP";
  /** The sign-in at the identity provider of a sign-in through OIDC, as its token answers it
   * (auth_time, amr, acr); absent for a password's and a pasted token. A step that takes a fresh
   * sign-in in place of the password reads it (docs/spec/rbac.md §12). */
  signIn?: SignIn;
};

export type SignIn = NonNullable<Token["signIn"]>;

/** How the last session ended, when not by the person's sign-out: "idle", the server's idle bound
 * (src/api/idle.ts) or the UI's own count of it. Kept beside the session, so that every tab and
 * the sign-in page can say why. */
export type SessionEnd = { reason: "idle"; at: string };

/** Where the session is kept: the demo has its own (src/app/demo.ts). Set by initSession. */
let key = "lajstrom.session";

type Listener = (session: Session | null) => void;
const listeners = new Set<Listener>();

function valid(v: unknown): v is Session {
  const s = v as Session;
  return (
    typeof s === "object" &&
    s !== null &&
    typeof s.token === "string" &&
    typeof s.user === "string" &&
    (typeof s.tokenId === "number" || s.tokenId === null) &&
    (typeof s.expiresAt === "string" || s.expiresAt === null) &&
    (s.tokenType === undefined || s.tokenType === "Bearer" || s.tokenType === "DPoP") &&
    (s.signIn === undefined || (typeof s.signIn === "object" && s.signIn !== null))
  );
}

function expired(s: Session, now = Date.now()): boolean {
  return s.expiresAt !== null && Date.parse(s.expiresAt) <= now;
}

function read(): Session | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const s: unknown = JSON.parse(raw);
    return valid(s) && !expired(s) ? s : null;
  } catch {
    return null;
  }
}

let current: Session | null = null;
/** The end of the last session, when storage is disabled. */
let end: SessionEnd | null = null;

/** Reads the session kept under storageKey; called once at start-up, before anything is fetched. */
export function initSession(storageKey: string): void {
  key = storageKey;
  current = read();
}

/** The localStorage key of the session: the demo's or the real one. The DPoP key of the session
 * is kept under the same name (src/api/dpop-key.ts). */
export function sessionStorageKey(): string {
  return key;
}

/** The session, or null when signed out or once the token has expired. Pure, so that React can
 * read it while rendering (src/app/session.ts). */
export function getSession(): Session | null {
  return current && !expired(current) ? current : null;
}

/** Sets the session; null ends it, for the reason given, if any. A sign-in, or a sign-out without
 * a reason, forgets the reason of the one before. */
export function setSession(session: Session | null, reason?: SessionEnd["reason"]): void {
  const endChange = reason && !session ? { reason, at: new Date().toISOString() } : session || current ? null : undefined;
  if (endChange !== undefined) end = endChange;
  current = session;
  try {
    if (endChange) localStorage.setItem(`${key}.end`, JSON.stringify(endChange));
    else if (endChange === null) localStorage.removeItem(`${key}.end`);
    if (session) localStorage.setItem(key, JSON.stringify(session));
    else localStorage.removeItem(key);
  } catch {
    // Storage disabled: the session lasts until the page is reloaded.
  }
  for (const fn of listeners) fn(session);
}

/** How the last session ended, in this tab or another one; null after a sign-in or a plain
 * sign-out. */
export function sessionEnd(): SessionEnd | null {
  try {
    const raw = localStorage.getItem(`${key}.end`);
    if (raw === null) return null;
    const e = JSON.parse(raw) as Partial<SessionEnd>;
    return e.reason === "idle" && typeof e.at === "string" ? { reason: e.reason, at: e.at } : null;
  } catch {
    return end;
  }
}

/** Calls fn when this tab or another one signs in or out; returns the unsubscribe. */
export function onSessionChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Another tab signed in or out.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== key) return;
    current = read();
    for (const fn of listeners) fn(current);
  });
}
