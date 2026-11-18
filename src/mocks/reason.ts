// The reason of a change of the control plane in the mock (docs/spec/rbac.md §13, A reason;
// internal/api/reason.go of the server): changeReason, a field of the JSON body of a route that
// takes one, or ?changeReason= on a route that takes none, with the server's checks and
// messages, kept in the change's audit rows as details.changeReason (db.ts, changed). With
// auth.requireReason (serverInfo.requireReason) a change without one is 400, after the role is
// checked and before anything is written; a person's own credentials take one and never need it.

import { serverInfo } from "./data/system";
import type { Refusal } from "./db";
import { keep, persist } from "./state";

/** auth.MaxChangeReason, in bytes. */
const MAX = 1024;

const invalid = (message: string): Refusal => ({ status: 400, code: "INVALID", message });

/** Why the server refuses s as a reason (auth.CheckChangeReason), or null. */
function problem(s: string): string | null {
  if (s === "") return "empty: a ticket or a sentence, 1 byte at least";
  const bytes = new TextEncoder().encode(s).length;
  if (bytes > MAX) return `${bytes} bytes, at most ${MAX}`;
  if (/\p{Cc}/u.test(s)) return "a control character (a line break, a tab)";
  return null;
}

/** The body of a change without its changeReason, and the reason; null for none. */
export type Reasoned = { body: unknown; reason: string | null };

/** The reason of a change, of its body (taken out of it) or of its query, as the server's
 * changeOrigin reads it; own for a change of the person's own credentials (ownOrigin). */
export function changeReason(request: Request, body: unknown, own = false): Reasoned | Refusal {
  const query = new URL(request.url).searchParams.getAll("changeReason");
  let rest = body;
  let inBody: string | null = null;
  if (typeof body === "object" && body !== null && !Array.isArray(body) && "changeReason" in body) {
    const { changeReason: r, ...others } = body as Record<string, unknown>;
    if (r !== null && typeof r !== "string") return invalid("body: changeReason is a string");
    inBody = r;
    rest = others;
  }
  if (inBody !== null && query.length) return invalid("changeReason: in the body or in the query, not both");
  if (query.length > 1) return invalid("changeReason: once in the query");
  const reason = inBody ?? query[0] ?? null;
  if (reason === null) {
    if (serverInfo.requireReason && !own) {
      return invalid(
        "changeReason: required (auth.requireReason): a ticket or a sentence, the reference of the change's approval, in the body or, on a route without one, as ?changeReason=",
      );
    }
    return { body: rest, reason: null };
  }
  const why = problem(reason);
  return why ? invalid(`changeReason: ${why}`) : { body: rest, reason };
}

/** The reason of the change that runs, which the rows it writes keep. */
let current: string | null = null;

export function currentReason(): string | null {
  return current;
}

/** Runs a change, synchronous, with its reason; the reason before it is the current one again
 * after it, as an approval makes the change of a request with the request's reason. */
export function withReason<T>(reason: string | null, run: () => T): T {
  const before = current;
  current = reason;
  try {
    return run();
  } finally {
    current = before;
  }
}

/** The reasons of the creations and revocations of tokens, by id: their audit rows are made of
 * the tokens themselves (db.ts). */
const tokenReasons = new Map<number, { create?: string; revoke?: string }>();

keep("reasons", {
  save: () => [...tokenReasons],
  load: (data) => {
    if (!Array.isArray(data)) return;
    tokenReasons.clear();
    for (const [id, r] of data as [number, { create?: string; revoke?: string }][]) tokenReasons.set(id, r);
  },
});

/** Keeps the reason of the change that runs, if any, for a token's creation or revocation. */
export function noteTokenReason(id: number, change: "create" | "revoke"): void {
  if (current === null) return;
  tokenReasons.set(id, { ...tokenReasons.get(id), [change]: current });
  persist();
}

/** The details of a token's row with the reason of its creation or revocation. */
export function tokenReason(id: number, change: "create" | "revoke"): { changeReason?: string } {
  const r = tokenReasons.get(id)?.[change];
  return r === undefined ? {} : { changeReason: r };
}
