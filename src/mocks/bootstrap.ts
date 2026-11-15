// POST /api/v1/bootstrap in the demo: the bootstrap token exchanged once for the first admin,
// with the server's answers in the server's order (docs/api.md, The first admin; docs/auth.md,
// Bootstrap; internal/auth/bootstrap.go).
//
// A server answers 404 to every request once an enabled user has an admin binding, and the
// demo's server has its admin already. So that the page shows what a new server does, the demo's
// server takes its token, DEMO_BOOTSTRAP_TOKEN, as if it had just started without an admin: once,
// for a first admin next to the demo's accounts, which stay as they are. Then it answers 404, as
// the server does once an admin exists. "Reset data" makes the token valid again; it does not
// expire. Wrong tokens are counted as on a server with server.tls, which knows the client's
// address: the browser is the one client.

import type { User } from "@/api/types";
import { DEMO_BOOTSTRAP_TOKEN } from "@/app/demo";

import type { Refusal } from "./auth";
import { makeFirstAdmin, nameRefusal, passwordRefusal, userByRef } from "./db";
import { keep, persist } from "./state";

/** When the token was used; null while the server takes it. */
let usedAt: string | null = null;

keep("bootstrap", {
  save: () => ({ usedAt }),
  load: (data) => {
    const d = data as { usedAt?: unknown } | null;
    if (typeof d?.usedAt === "string") usedAt = d.usedAt;
  },
});

/** Whether the server takes a bootstrap token: no admin yet, as far as the demo's server goes. */
export function bootstrapOpen(): boolean {
  return usedAt === null;
}

/** How many wrong tokens a client may send within the window (auth.BootstrapFailures and
 * auth.LoginWindow): the next request is refused, the right token too, until it closes. */
const FAILURES = 10;
const WINDOW = 60_000;

/** The window of the client's wrong tokens, opened by the first one that finds none open. */
let failures: { start: number; n: number } | null = null;

/** How long the client is refused, in milliseconds; 0 when it is not. */
function throttled(now: number): number {
  if (!failures || failures.n < FAILURES) return 0;
  return Math.max(failures.start + WINDOW - now, 0);
}

function failed(now: number): void {
  if (failures && now < failures.start + WINDOW) failures.n++;
  else failures = { start: now, n: 1 };
}

const invalid = (message: string): Refusal => ({ status: 400, code: "INVALID", message });

const FIELDS = ["token", "name", "password"] as const;

/** A JSON value's type as Go's encoding/json names it in the server's message. */
const jsonType = (v: unknown) => (Array.isArray(v) ? "array" : typeof v === "boolean" ? "bool" : typeof v);

/** The fields of the body, or the server's 400 for a body that is not a BootstrapRequest. A field
 * left out or null is "", as the server decodes it. */
function decode(body: unknown): Record<(typeof FIELDS)[number], string> | Refusal {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return invalid("body: must be a JSON object");
  const fields = body as Record<string, unknown>;
  const unknown = Object.keys(fields).find((k) => !(FIELDS as readonly string[]).includes(k));
  if (unknown) return invalid(`body: unknown field "${unknown}"`);
  const wrong = FIELDS.find((k) => fields[k] != null && typeof fields[k] !== "string");
  if (wrong) return invalid(`${wrong}: must not be a JSON ${jsonType(fields[wrong])}`);
  const text = (k: (typeof FIELDS)[number]) => (fields[k] as string | null | undefined) ?? "";
  return { token: text("token"), name: text("name"), password: text("password") };
}

/** A refusal of the exchange; a throttled client is told when to try again (Retry-After). */
export type BootstrapRefusal = Refusal & { retryAfter?: number };

/**
 * Exchanges the token of the body for the first admin, in the server's order: a body that is not
 * one, a throttled client, a wrong token (counted), then the name and the password and a name
 * that is taken, which leave the token valid. The caller answers 404 while bootstrapOpen() is
 * false, before the body is read.
 */
export function exchangeBootstrapToken(body: unknown, now = Date.now()): User | BootstrapRefusal {
  const req = decode(body);
  if ("status" in req) return req;
  const wait = throttled(now);
  if (wait > 0) {
    return { status: 429, code: "UNAVAILABLE", message: "too many wrong bootstrap tokens: try again after Retry-After seconds", retryAfter: Math.max(Math.ceil(wait / 1000), 1) };
  }
  if (req.token !== DEMO_BOOTSTRAP_TOKEN) {
    failed(now);
    return { status: 403, code: "FORBIDDEN", message: "the bootstrap token is refused" };
  }
  const refused = nameRefusal(req.name) ?? passwordRefusal(req.password);
  if (refused) return refused;
  if (userByRef(req.name)) return { status: 409, code: "CONFLICT", message: `user ${req.name} already exists` };

  usedAt = new Date(now).toISOString();
  const user = makeFirstAdmin(req.name, req.password);
  persist();
  return user;
}
