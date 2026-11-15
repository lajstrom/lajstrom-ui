// The start-up asks the server who it is before the app renders (src/main.tsx): GET
// {apiBaseUrl}/-/version, without credentials. No answer, or not Lajstrom's, renders a page with
// the URL and what came back (src/app/startup-pages.tsx), so a wrong apiBaseUrl or a missing
// route of the edge shows as such, not as empty screens. A server older or newer than the API
// this bundle was built for gets a warning (src/app/skew.ts), and the app goes on.

import { build } from "./build";
import { skewOf, type ServerVersion, type Skew } from "./skew";

export type Probe = { ok: true; server: ServerVersion } | { ok: false; url: string; status: string };

/** The server's version endpoint, as the browser reaches it. */
export function versionUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl || window.location.origin}/-/version`;
}

/** GET /-/version: the server, or what went wrong, in words. */
export async function probeServer(apiBaseUrl: string, timeoutMs = 10_000): Promise<Probe> {
  const url = versionUrl(apiBaseUrl);
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timeout = err instanceof DOMException && err.name === "TimeoutError";
    return {
      ok: false,
      url,
      status: timeout
        ? `no answer within ${timeoutMs / 1000} seconds`
        : "no answer: the server is down, the address is wrong, or it does not allow this origin (CORS)",
    };
  }
  const answer = `${res.status} ${res.statusText}`.trim();
  if (!res.ok) return { ok: false, url, status: answer };
  const type = res.headers.get("content-type") ?? "";
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const v = body as Partial<Record<keyof ServerVersion, unknown>> | null;
  if (typeof v?.version !== "string") {
    return { ok: false, url, status: `${answer}, but ${type || "no content type"}, not the JSON of Lajstrom's /-/version` };
  }
  return {
    ok: true,
    server: { version: v.version, commit: typeof v.commit === "string" ? v.commit : "", date: typeof v.date === "string" ? v.date : "" },
  };
}

let started: { server: ServerVersion; skew: Skew } | null = null;

/** Keeps the server the start-up found, and how it stands against the bundle's contract. */
export function setServer(server: ServerVersion): void {
  started = { server, skew: skewOf(build.contract, server) };
}

/** The server at start-up; null in the demo. */
export function serverAtStart(): { server: ServerVersion; skew: Skew } | null {
  return started;
}

/** How a server stands against the API this UI was built for, in words. */
export function skewText(skew: Skew): string {
  switch (skew) {
    case "same":
      return "the API this UI was built for";
    case "compatible":
      return "a later build of the API this UI was built for";
    case "older":
      return "older than the API this UI was built for";
    case "newer":
      return "newer than the API this UI was built for";
    case "unknown":
      return "unknown: its version names no release";
  }
}
