// Sign-in and sign-out (src/api/session.ts has the why). Only endpoints the server has:
// POST/GET/DELETE /api/v1/users/{name}/tokens and GET /api/v1/whoami (docs/api.md).

import { sha256Hex } from "@/lib/sha256";

import { ApiError, apiGetAs, apiPath, apiSend, basicAuth } from "./client";
import { getSession, setSession } from "./session";
import type { CreatedToken, Token, WhoAmI } from "./types";

/** How long the token created at sign-in lives; the server allows up to 365 days. */
export const SESSION_LIFETIME = "12h";

/** A sign-in that failed for a reason the form shows as is. */
export class SignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignInError";
  }
}

/** A token name unique among the user's live tokens (the server refuses a taken one with 409). */
export function sessionTokenName(now: Date, random: Uint8Array): string {
  const stamp = now.toISOString().slice(0, 16).replace("T", " ");
  const suffix = [...random.slice(0, 2)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `web UI ${stamp} UTC ${suffix}`;
}

/** Creates a token for this browser with the user's password; the password is sent once. */
export async function signInWithPassword(user: string, password: string): Promise<void> {
  // User names are lowercase on the server (docs/auth.md), so "Alice" can only mean alice.
  const name = user.trim().toLowerCase();
  if (!name || !password) throw new SignInError("Enter your user name and password.");
  let token: CreatedToken;
  try {
    token = await apiSend<CreatedToken>("POST", apiPath("users", name, "tokens"), {
      body: { name: sessionTokenName(new Date(), crypto.getRandomValues(new Uint8Array(2))), expiresIn: SESSION_LIFETIME },
      authorization: basicAuth(name, password),
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) throw new SignInError("Wrong user name or password, or the user is disabled.");
    if (err instanceof ApiError && err.status === 403) throw new SignInError(`The server refused to create a token: ${err.message}.`);
    throw err;
  }
  setSession({ token: token.secret, user: name, tokenId: token.id, expiresAt: token.expiresAt });
}

/** Signs in with a personal access token the user already has; it is never revoked by sign-out. */
export async function signInWithToken(secret: string): Promise<void> {
  const token = secret.trim();
  if (token.startsWith("ljs_dep_")) {
    throw new SignInError("That is a deploy token: clients use it as Basic deploy:<token>. Sign in with a personal access token (ljs_pat_…).");
  }
  if (!token.startsWith("ljs_pat_")) throw new SignInError("A personal access token starts with ljs_pat_.");
  let who: WhoAmI;
  try {
    who = await apiGetAs<WhoAmI>(apiPath("whoami"), `Bearer ${token}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) throw new SignInError("The server does not know this token: it is wrong, revoked or expired.");
    throw err;
  }
  if (who.kind !== "user") throw new SignInError(`This token signs in as ${who.principal}, not as a user.`);
  setSession({ token, user: who.name, tokenId: null, expiresAt: await expiryOf(who.name, token) });
}

/** The expiry of a pasted token, found by its hash prefix; null when the token may not list
 * tokens (a token with scopes never manages, docs/api.md) or the list fails. */
async function expiryOf(user: string, token: string): Promise<string | null> {
  try {
    const prefix = sha256Hex(token).slice(0, 8);
    const list = await apiGetAs<{ tokens: Token[] }>(apiPath("users", user, "tokens"), `Bearer ${token}`);
    return list.tokens.find((t) => t.hashPrefix === prefix)?.expiresAt ?? null;
  } catch {
    return null;
  }
}

/** Ends the session; the token created at sign-in is revoked, a pasted one is only forgotten. */
export async function signOut(): Promise<void> {
  const s = getSession();
  if (s?.tokenId != null) {
    try {
      await apiSend("DELETE", apiPath("users", s.user, "tokens", s.tokenId));
    } catch {
      // Already revoked or expired, or the server is gone: the token ends with its expiry.
    }
  }
  setSession(null);
}
