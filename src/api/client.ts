import { config } from "@/app/config";

import { clockSkew, createProof, dpopChallenge, learnServerClock, refusedForIat } from "./dpop";
import { sessionKey } from "./dpop-key";
import { noteTokenUse } from "./idle";
import { getSession, setSession, type Session } from "./session";
import type { ApiErrorBody } from "./types";

/** An error answered by the API, with the code of the error envelope (http-routing.md §4). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** The answer was Lajstrom's error envelope; false for a network failure or a proxy's page. */
  readonly fromServer: boolean;
  /** Seconds to wait before trying again, from Retry-After (a 429); null without it. */
  readonly retryAfter: number | null;

  constructor(status: number, code: string, message: string, fromServer = true, retryAfter: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fromServer = fromServer;
    this.retryAfter = retryAfter;
  }
}

/** Whether no Lajstrom server answered: the network failed, or a proxy in front of the server
 * (nginx, the dev server) answered 5xx with a page of its own. */
export function isUnreachable(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 0 || (err.status >= 500 && !err.fromServer));
}

/**
 * Whether an error means the server does not have the endpoint yet, as opposed to a resource
 * that does not exist: 501 UNAVAILABLE for an endpoint the server knows but does not serve yet,
 * or the 404 it answers for every path under /api/ it does not know ("GET /api/v1/… is not an
 * endpoint of this version (docs/api.md)", notFound in internal/api/http.go of lajstrom/lajstrom).
 */
export function isUnavailable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return err.status === 501 || (err.status === 404 && err.code === "NOT_FOUND" && err.message.includes(" is not an endpoint of this version"));
}

type Query = Record<string, string | number | boolean | string[] | undefined | null>;

/** Builds /api/v1 URLs; path segments are encoded, so a raw path or a maven name stays one segment. */
export function apiPath(...segments: (string | number)[]): string {
  return "/api/v1/" + segments.map((s) => encodeURIComponent(String(s))).join("/");
}

/** The Basic credentials of RFC 7617, UTF-8 encoded: what sign-in sends once to create a token. */
export function basicAuth(user: string, secret: string): string {
  const bytes = new TextEncoder().encode(`${user}:${secret}`);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `Basic ${btoa(binary)}`;
}

type RequestOptions = {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
  /** Overrides the session's credentials, for sign-in: Basic credentials, a token being checked,
   * or "" for none. */
  authorization?: string;
  /** Signs a DPoP proof of this key without a token: the sign-in, POST /api/v1/login. */
  dpopKey?: CryptoKeyPair;
  /** Conditions of a request, such as If-Match. */
  headers?: Record<string, string>;
};

/** The key of a DPoP session; a session whose key this browser has lost is over. */
async function keyOf(session: Session): Promise<CryptoKeyPair> {
  const key = await sessionKey(session.token);
  if (key) return key;
  if (getSession()?.token === session.token) setSession(null);
  throw new ApiError(401, "UNAUTHENTICATED", "This browser no longer has the key of its sign-in: sign in again.", false);
}

/**
 * The headers that carry the session to a request of the API: Authorization: Bearer, or for a
 * token of POST /api/v1/login Authorization: DPoP with a new proof of this browser's key in DPoP
 * (docs/api.md of the server, The DPoP-bound token). Empty when signed out. The API page's
 * "Try it out" sends them too (src/pages/api-docs.tsx).
 */
export async function sessionHeaders(method: string, url: string | URL, session = getSession()): Promise<Record<string, string>> {
  if (!session) return {};
  if (session.tokenType !== "DPoP") return { Authorization: `Bearer ${session.token}` };
  const proof = await createProof(await keyOf(session), { method, url, token: session.token });
  return { Authorization: `DPoP ${session.token}`, DPoP: proof };
}

type Failure = { code: string; message: string; fromServer: boolean };

/** The error envelope of an answer that is not ok; a proxy's page has none. */
async function failure(res: Response): Promise<Failure> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    return { code: body.error.code, message: body.error.message, fromServer: true };
  } catch {
    return { code: "UNAVAILABLE", message: `${res.status} ${res.statusText}`.trim(), fromServer: false };
  }
}

async function request(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
  const url = new URL(config().apiBaseUrl + path, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
    else url.searchParams.set(k, String(v));
  }
  const session = opts.authorization === undefined ? getSession() : null;
  const dpop = session?.tokenType === "DPoP";

  let res: Response;
  let failed: Failure | null = null;
  for (let attempt = 0; ; attempt++) {
    // A new proof for every request, a retry too: the server takes a jti once.
    const signedBy = clockSkew();
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...opts.headers,
      ...(opts.authorization === undefined ? await sessionHeaders(method, url, session) : {}),
    };
    if (opts.authorization) headers.Authorization = opts.authorization;
    if (opts.dpopKey) headers.DPoP = await createProof(opts.dpopKey, { method, url });
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    // Every request with the token is a use of it: the idle bound starts over (src/api/idle.ts).
    if (session) noteTokenUse();
    try {
      res = await fetch(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        // The server answers 401 with a Basic challenge; with credentials the browser would show
        // its own login dialog. The Authorization header above is sent either way.
        credentials: "omit",
        signal: opts.signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      throw new ApiError(0, "UNAVAILABLE", "The Lajstrom API cannot be reached.", false);
    }
    if (res.ok) break;
    failed = await failure(res);
    // A proof refused for its iat: this browser's clock is off. Once more, by the server's clock,
    // from the Date of the refusal (ADR 0022 §8.4 of the server); the server did nothing else.
    // The clock may have been set right meanwhile by a request refused alongside this one.
    const signed = dpop || opts.dpopKey !== undefined;
    if (!signed || attempt > 0 || !refusedForIat(res.status, res.headers.get("WWW-Authenticate"), failed.message)) break;
    learnServerClock(res.headers.get("Date"));
    if (Math.abs(clockSkew() - signedBy) < 1000) break;
  }
  if (failed && !res.ok) {
    // The session's token was refused: revoked, expired, idle, its user disabled, or bound to a
    // key this browser no longer has. Signed out, saying so when it was idle. A refused proof is
    // this browser's doing, not the token's: the session stays.
    const challenge = dpop ? dpopChallenge(res.headers.get("WWW-Authenticate")) : null;
    if (res.status === 401 && session && challenge?.error !== "invalid_dpop_proof" && getSession()?.token === session.token) {
      setSession(null, challenge?.description === "idle" ? "idle" : undefined);
    }
    const retryAfter = Number(res.headers.get("Retry-After") ?? NaN);
    throw new ApiError(
      res.status,
      failed.code,
      failed.message,
      failed.fromServer,
      Number.isInteger(retryAfter) && retryAfter >= 0 ? retryAfter : null,
    );
  }
  return res;
}

export async function apiGet<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
  const res = await request("GET", path, { query, signal });
  return (await res.json()) as T;
}

/** A request that changes something; resolves to the JSON answer, or undefined for 204. */
export async function apiSend<T = undefined>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  opts: Omit<RequestOptions, "signal"> = {},
): Promise<T> {
  const res = await request(method, path, opts);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** A GET with explicit credentials, outside the session: sign-in checks a pasted token with it. */
export async function apiGetAs<T>(path: string, authorization: string): Promise<T> {
  const res = await request("GET", path, { authorization });
  return (await res.json()) as T;
}
