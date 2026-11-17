// Sign-in and sign-out (src/api/session.ts has the why), and the first admin of a new server.
// Only endpoints the server has (docs/api.md): POST /api/v1/login, a token bound to this
// browser's DPoP key for a password or the code of an OIDC login; on a server without it (no
// login in GET /api/v1/info), POST/GET/DELETE /api/v1/users/{name}/tokens with the password;
// GET /api/v1/whoami and POST /api/v1/bootstrap.

import { basePath } from "@/app/base";
import { config } from "@/app/config";
import { safeRedirect } from "@/lib/redirect";
import { sha256Hex } from "@/lib/sha256";

import { ApiError, apiGetAs, apiPath, apiSend, basicAuth } from "./client";
import { dpopSupported, jwkThumbprint, publicJwk } from "./dpop";
import { forgetKey, signInKey } from "./dpop-key";
import { oidcLoginUrl, pkceChallenge, pkceVerifier, rememberVerifier } from "./oidc";
import { getSession, setSession, type SessionEnd } from "./session";
import type { BootstrapRequest, CreatedToken, LoginRequest, LoginToken, ServerInfo, Token, User, WhoAmI } from "./types";

/** How long the token created at sign-in lives on a server without POST /api/v1/login, which
 * sets the lifetime itself; the server allows up to 365 days. */
export const SESSION_LIFETIME = "12h";

/** A sign-in that failed for a reason the form shows as is. */
export class SignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignInError";
  }
}

/** How a person may sign in, as the sign-in page offers it: info.authModes, the modes this UI
 * knows; a server that does not say keeps the password and the token. OIDC needs info.login too:
 * only then does the server's login hand a web UI a code. */
export function signInModes(info: Pick<ServerInfo, "authModes" | "login"> | undefined): { password: boolean; token: boolean; oidc: boolean } {
  const modes: unknown = info?.authModes;
  if (!Array.isArray(modes)) return { password: true, token: true, oidc: false };
  return { password: modes.includes("password"), token: modes.includes("token"), oidc: modes.includes("oidc") && info?.login !== undefined };
}

/** A lifetime in seconds as the form says it: "12 hours", "90 minutes". */
export function lifetimeText(seconds: number): string {
  const unit = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  if (seconds % 3600 === 0) return unit(seconds / 3600, "hour");
  return unit(Math.max(1, Math.round(seconds / 60)), "minute");
}

/** A token name unique among the user's live tokens (the server refuses a taken one with 409). */
export function sessionTokenName(now: Date, random: Uint8Array): string {
  const stamp = now.toISOString().slice(0, 16).replace("T", " ");
  const suffix = [...random.slice(0, 2)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `web UI ${stamp} UTC ${suffix}`;
}

/** What the server says before anyone signs in; asked without the session's credentials. */
function serverInfo(): Promise<ServerInfo> {
  return apiGetAs<ServerInfo>(apiPath("info"), "");
}

/** Why the server refused the sign-in's proof (400, "DPoP: <why>"), in the form's words. */
function proofRefusal(message: string): string {
  const why = message.replace(/^DPoP:\s*/, "");
  if (/\biat\b/.test(why)) return "The clock of this computer is more than 5 minutes off the server's. Set it right, then sign in again.";
  if (/\bhtu\b/.test(why)) {
    return `The server refused this browser's proof of its key: ${why}. The UI's apiBaseUrl (config.json) must be the server's server.externalURL.`;
  }
  return `The server refused this browser's proof of its key: ${why}.`;
}

/**
 * Signs in at POST /api/v1/login with a proof of this browser's key: the server answers a token
 * bound to that key (tokenType DPoP), which the requests then send with a proof of their own.
 */
async function login(req: LoginRequest): Promise<void> {
  const key = await signInKey();
  let token: LoginToken;
  try {
    token = await apiSend<LoginToken>("POST", apiPath("login"), { body: req, authorization: "", dpopKey: key });
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.status === 401) {
      throw new SignInError("code" in req ? `The server refused the sign-in: ${err.message}.` : "Wrong user name or password, or the user is disabled.");
    }
    if (err.status === 429) {
      const wait = err.retryAfter === null ? "a minute" : `${err.retryAfter} second${err.retryAfter === 1 ? "" : "s"}`;
      throw new SignInError(`Too many failed sign-ins: try again in ${wait}.`);
    }
    if (err.status === 400 && /^DPoP:/.test(err.message)) throw new SignInError(proofRefusal(err.message));
    if (err.status === 400 && "code" in req) throw new SignInError("The single sign-on has expired or was used already. Sign in again.");
    throw err;
  }
  if (!token.user) throw new SignInError("The server's answer to the sign-in names no user.");
  setSession({ token: token.secret, user: token.user, tokenId: token.id, expiresAt: token.expiresAt, tokenType: "DPoP" });
}

/**
 * Signs in with the user's password, which is sent once. A server with POST /api/v1/login answers
 * a token bound to this browser's key; without it, or in a browser without WebCrypto (plain http
 * to another host), the UI creates a token for this browser with the password over Basic.
 */
export async function signInWithPassword(user: string, password: string): Promise<void> {
  // User names are lowercase on the server (docs/auth.md), so "Alice" can only mean alice.
  const name = user.trim().toLowerCase();
  if (!name || !password) throw new SignInError("Enter your user name and password.");
  const info = await serverInfo();
  if (info.login !== undefined && dpopSupported()) return login({ username: name, password });
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
  setSession({ token: token.secret, user: name, tokenId: token.id, expiresAt: token.expiresAt, tokenType: "Bearer" });
}

/**
 * Where to send the person to sign in through the server's OIDC login, after this tab has kept
 * the PKCE verifier: the server's /-/oidc/login with the challenge, the thumbprint of this
 * browser's key, and return_to, this UI's sign-in page, where the code comes back
 * (redeemOidcCode). redirect is where to go once signed in. prompt "login" has the IdP
 * authenticate the person again, a step-up (src/api/step-up.ts).
 */
export async function oidcSignInUrl(redirect: string | undefined, prompt?: "login"): Promise<string> {
  if (!dpopSupported()) throw new SignInError("Single sign-on needs WebCrypto, which a browser has on https or on localhost only.");
  const key = await signInKey();
  const verifier = pkceVerifier();
  try {
    rememberVerifier(verifier);
  } catch {
    throw new SignInError("Single sign-on needs this tab's session storage, which the browser does not allow.");
  }
  const returnTo = new URL(`${basePath()}sign-in`, window.location.origin);
  const to = safeRedirect(redirect);
  if (to !== "/") returnTo.searchParams.set("redirect", to);
  return oidcLoginUrl(config().apiBaseUrl || window.location.origin, {
    returnTo: returnTo.href,
    challenge: await pkceChallenge(verifier),
    jkt: await jwkThumbprint(await publicJwk(key.publicKey)),
    prompt,
  });
}

/** Redeems the code an OIDC login handed back (src/api/oidc.ts, takeOidcCallback) with the
 * verifier this tab kept and a proof of the key whose thumbprint the login named. */
export async function redeemOidcCode(code: string, verifier: string | null): Promise<void> {
  if (!verifier) throw new SignInError("This single sign-on was not started in this tab. Sign in again.");
  await login({ code, codeVerifier: verifier });
}

/** Signs in with a personal access token the user already has; it is never revoked by sign-out.
 * It is a bearer: only the token of a sign-in is bound to a key. */
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
  setSession({ token, user: who.name, tokenId: null, expiresAt: await expiryOf(who.name, token), tokenType: "Bearer" });
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

/** Ends the session; the token created at sign-in is revoked, a pasted one is only forgotten.
 * The key of the sign-in goes too, so that a token whose revocation failed is of no use. reason
 * is "idle" when the UI's count of the idle bound ran out (src/api/idle.ts). */
export async function signOut(reason?: SessionEnd["reason"]): Promise<void> {
  const s = getSession();
  if (s?.tokenId != null) {
    try {
      await apiSend("DELETE", apiPath("users", s.user, "tokens", s.tokenId));
    } catch {
      // Already revoked or expired, or the server is gone: the token ends with its expiry.
    }
  }
  await forgetKey();
  setSession(null, reason);
}

/**
 * Creates the first admin of a new server with its one-time bootstrap token (POST
 * /api/v1/bootstrap, docs/api.md "The first admin"), then signs in as it with its password, as
 * signInWithPassword does. The token is the request's credential: no session goes with it.
 */
export async function createFirstAdmin(req: BootstrapRequest): Promise<User> {
  // A token is one word, and a name has no spaces: what is around them was pasted along.
  const body: BootstrapRequest = { token: req.token.trim(), name: req.name.trim(), password: req.password };
  const user = await apiSend<User>("POST", apiPath("bootstrap"), { body, authorization: "" });
  try {
    await signInWithPassword(user.name, req.password);
  } catch (err) {
    const why = err instanceof Error ? err.message.replace(/\.$/, "") : "the request failed";
    throw new SignInError(`The admin ${user.name} is created, but signing in failed (${why}). Sign in with its name and password.`);
  }
  return user;
}
