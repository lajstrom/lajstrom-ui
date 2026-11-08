// The browser session: a personal access token that the UI sends as `Authorization: Bearer` on
// every API request (bearer tokens, never cookies: the lead's decision in the repository's
// README). Signing in with a password creates a short-lived token for this browser
// (POST /api/v1/users/{name}/tokens); signing out revokes it. A token pasted by the user is only
// forgotten on sign-out, never revoked: it may be in use elsewhere.
//
// The token is kept in localStorage, so that every tab of the UI shares it; its lifetime is the
// token's own expiry on the server. The Content-Security-Policy of the image allows no inline or
// foreign scripts, which is what keeps it from other code.

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
};

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
    (typeof s.expiresAt === "string" || s.expiresAt === null)
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

/** Reads the session kept under storageKey; called once at start-up, before anything is fetched. */
export function initSession(storageKey: string): void {
  key = storageKey;
  current = read();
}

/** The session, or null when signed out or once the token has expired. Pure, so that React can
 * read it while rendering (src/app/session.ts). */
export function getSession(): Session | null {
  return current && !expired(current) ? current : null;
}

export function setSession(session: Session | null): void {
  current = session;
  try {
    if (session) localStorage.setItem(key, JSON.stringify(session));
    else localStorage.removeItem(key);
  } catch {
    // Storage disabled: the session lasts until the page is reloaded.
  }
  for (const fn of listeners) fn(session);
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
