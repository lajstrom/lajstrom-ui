import { config } from "@/app/config";

import type { ApiErrorBody } from "./types";

/** An error answered by the API, with the code of the error envelope (http-routing.md §4). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type Query = Record<string, string | number | boolean | string[] | undefined | null>;

/** Builds /api/v1 URLs; path segments are encoded, so a raw path or a maven name stays one segment. */
export function apiPath(...segments: (string | number)[]): string {
  return "/api/v1/" + segments.map((s) => encodeURIComponent(String(s))).join("/");
}

export async function apiGet<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
  const url = new URL(config().apiBaseUrl + path, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
    else url.searchParams.set(k, String(v));
  }
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "UNAVAILABLE", "The Lajstrom API cannot be reached.");
  }
  if (!res.ok) {
    let code = "UNAVAILABLE";
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as ApiErrorBody;
      code = body.error.code;
      message = body.error.message;
    } catch {
      // Not the error envelope: a proxy error page, for example.
    }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}
