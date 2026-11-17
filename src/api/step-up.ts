// A step-up: a change that the server takes only with a fresh sign-in through OIDC with a second
// factor (docs/spec/rbac.md §10 and §11 of lajstrom/lajstrom): a CI trust policy that writes,
// made, changed, renewed or approved. The server refuses the change; the UI has the person sign
// in again at the IdP with prompt=login, and sends the change once more with the new token.
//
// Two answers mean it. The server of the vendored contract answers 403 FORBIDDEN, its message
// ending "sign in again in a web UI through OIDC (prompt=login), with a second factor". Once
// lajstrom/lajstrom#1296 is in, it answers the token of an OIDC sign-in 401 with
// WWW-Authenticate: DPoP error="insufficient_user_authentication" (RFC 9470), and keeps the 403
// for any other credential; src/api/client.ts keeps the session for that 401. A token's views
// say nothing of its sign-in at that server, so the UI cannot tell before it asks.
//
// The sign-in leaves the page for the IdP, and what the page held with it. The change is kept in
// this tab's sessionStorage, as the PKCE verifier is (src/api/oidc.ts), and the page that the
// sign-in comes back to takes it once and sends it again, whatever then happens: by the same
// user only, with another token than the one that was refused, within STEP_UP_WINDOW.

import { sha256Hex } from "@/lib/sha256";

import { oidcSignInUrl } from "./auth";
import { ApiError, type ChangeRequest } from "./client";
import { sessionStorageKey, type Session } from "./session";

/** How long a change kept for a step-up may wait for its sign-in. The server's code of an OIDC
 * login lives 10 minutes; a person at the IdP takes less. */
export const STEP_UP_WINDOW = 15 * 60_000;

/** The end of the server's message when a step needs a fresh sign-in with a second factor
 * (internal/auth/signin.go of the server, FreshSignIn). */
const SIGN_IN_AGAIN = /sign in again in a web UI through OIDC \(prompt=login\), with a second factor\.?$/;

/** Whether the server refused a change for want of a fresh sign-in with a second factor: the
 * 401 of rbac.md §10 (Asking for more), or the 403 of a server before it, by its message. */
export function needsStepUp(err: unknown): err is ApiError {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 401) return err.challenge?.error === "insufficient_user_authentication";
  return err.status === 403 && SIGN_IN_AGAIN.test(err.message.trim());
}

/** A change that waits for its step-up: the request as it is sent, what it does in words, and
 * where it was refused: the user, a hash of the token, when, and the page to come back to. */
export type PendingChange = {
  request: ChangeRequest;
  /** "Approve the CI trust policy web-npm-publish". */
  what: string;
  user: string;
  /** The first 16 hex digits of the sha256 of the token that was refused: not the token. */
  token: string;
  at: number;
  /** The page, a path of this UI with its query, that the sign-in comes back to. */
  page: string;
};

const pendingKey = () => `${sessionStorageKey()}.step-up`;

const tokenHash = (token: string) => sha256Hex(token).slice(0, 16);

/** The change to keep for a step-up, refused with the session's token at now. */
export function pendingChange(change: Pick<PendingChange, "request" | "what" | "page">, session: Session, now: number): PendingChange {
  return { ...change, user: session.user, token: tokenHash(session.token), at: now };
}

/** Keeps the change in this tab until the sign-in comes back; one at a time. Throws when the
 * browser keeps no session storage. */
export function keepPendingChange(change: PendingChange, storage: Storage = sessionStorage): void {
  storage.setItem(pendingKey(), JSON.stringify(change));
}

function isPending(v: unknown): v is PendingChange {
  const c = v as PendingChange;
  return (
    typeof c === "object" &&
    c !== null &&
    typeof c.request === "object" &&
    c.request !== null &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(c.request.method) &&
    typeof c.request.path === "string" &&
    c.request.path.startsWith("/api/v1/") &&
    (c.request.ifMatch === undefined || typeof c.request.ifMatch === "string") &&
    typeof c.what === "string" &&
    typeof c.user === "string" &&
    typeof c.token === "string" &&
    typeof c.at === "number" &&
    typeof c.page === "string"
  );
}

/** The change this tab kept for a step-up, taken: it leaves the storage, whatever comes of it.
 * Null when there is none, or what is there is not one. */
export function takePendingChange(storage: Storage = sessionStorage): PendingChange | null {
  let raw: string | null;
  try {
    raw = storage.getItem(pendingKey());
    storage.removeItem(pendingKey());
  } catch {
    return null;
  }
  try {
    const v: unknown = raw === null ? null : JSON.parse(raw);
    return isPending(v) ? v : null;
  } catch {
    return null;
  }
}

/** Why a kept change is not sent again, or null to send it: the person signed in as another
 * user, did not sign in again (the token is the one refused, or there is none), or took longer
 * than STEP_UP_WINDOW. */
export function replayRefusal(change: PendingChange, session: Session | null, now: number): string | null {
  if (!session) return "You are not signed in.";
  if (session.user !== change.user) return `You signed in as ${session.user}, and the change was ${change.user}'s.`;
  if (tokenHash(session.token) === change.token) return "The sign-in did not complete.";
  if (now - change.at > STEP_UP_WINDOW || now < change.at) return "The sign-in took longer than 15 minutes.";
  return null;
}

/** Where to send the person for the step-up: the server's OIDC login with prompt=login, coming
 * back through the sign-in page to the change's page. */
export function stepUpUrl(change: PendingChange): Promise<string> {
  return oidcSignInUrl(change.page, "login");
}
