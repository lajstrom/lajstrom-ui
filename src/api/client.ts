import { config } from "@/app/config";

import { getSession, setSession } from "./session";
import type { ApiErrorBody } from "./types";

/** An error answered by the API, with the code of the error envelope (http-routing.md §4). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** The answer was Lajstrom's error envelope; false for a network failure or a proxy's page. */
  readonly fromServer: boolean;

  constructor(status: number, code: string, message: string, fromServer = true) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fromServer = fromServer;
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
 * or the 404 it answers for every path under /api/ it does not know ("GET /api/v1/… is not in
 * this version", docs/api.md in lajstrom/lajstrom).
 */
export function isUnavailable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return err.status === 501 || (err.status === 404 && err.code === "NOT_FOUND" && err.message.includes(" is not in this version"));
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
  /** Overrides the session's bearer, for sign-in: Basic credentials or a token being checked. */
  authorization?: string;
};

async function request(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
  const url = new URL(config().apiBaseUrl + path, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
    else url.searchParams.set(k, String(v));
  }
  const session = opts.authorization === undefined ? getSession() : null;
  const headers: Record<string, string> = { Accept: "application/json" };
  const authorization = opts.authorization ?? (session ? `Bearer ${session.token}` : undefined);
  if (authorization) headers.Authorization = authorization;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
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
  if (!res.ok) {
    let code = "UNAVAILABLE";
    let message = `${res.status} ${res.statusText}`.trim();
    let fromServer = false;
    try {
      const body = (await res.json()) as ApiErrorBody;
      code = body.error.code;
      message = body.error.message;
      fromServer = true;
    } catch {
      // Not the error envelope: a proxy error page, for example.
    }
    // The session's token was refused: revoked, expired, or its user disabled. Signed out.
    if (res.status === 401 && session && getSession()?.token === session.token) setSession(null);
    throw new ApiError(res.status, code, message, fromServer);
  }
  return res;
}

export async function apiGet<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
  const res = await request("GET", path, { query, signal });
  return (await res.json()) as T;
}

/** A request that changes something; resolves to the JSON answer, or undefined for 204. */
export async function apiSend<T = undefined>(
  method: "POST" | "PATCH" | "DELETE",
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
