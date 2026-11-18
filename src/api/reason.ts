// The reason of a change of the control plane (docs/spec/rbac.md §13, A reason): changeReason, a
// ticket or a sentence that the server keeps in the change's audit row. It is a field of the JSON
// body of a route that takes one, and ?changeReason= on a route that takes none (a DELETE, an
// unlock, an approval). With auth.requireReason, which GET /api/v1/info answers as requireReason,
// a change without one is 400; a person's own credentials take one and never need it.
//
// The person keeps a reason in this tab, as the command line keeps LAJSTROM_REASON in a shell,
// and every change sends it. A change that the server takes only with a reason, sent while none
// is kept, asks for one first (setReasonAsker); a change of the person's own credentials does not
// ask. The reason is the signed-in user's: another user's sign-in, or none, forgets it.

import { getSession, onSessionChange, sessionStorageKey } from "./session";

/** The bound of the server, in bytes of UTF-8 (auth.MaxChangeReason). */
export const MAX_CHANGE_REASON = 1024;

/** Where a change carries its reason: in its JSON body, or as ?changeReason= on a route without
 * one. */
export type ReasonIn = "body" | "query";

/** Why the server would refuse s as a reason (auth.CheckChangeReason), or null. */
export function reasonProblem(s: string): string | null {
  if (s === "") return "A ticket or a sentence, 1 byte at least.";
  const bytes = new TextEncoder().encode(s).length;
  if (bytes > MAX_CHANGE_REASON) return `${bytes} bytes, at most ${MAX_CHANGE_REASON}.`;
  if (/\p{Cc}/u.test(s)) return "No line breaks or tabs.";
  return null;
}

/** The change was not sent: it needs a reason, and the person gave none. */
export class ReasonNotGiven extends Error {
  constructor() {
    super("No reason given: this server takes the change only with one (auth.requireReason).");
    this.name = "ReasonNotGiven";
  }
}

const keptKey = () => `${sessionStorageKey()}.reason`;

let kept: string | null = null;
/** The signed-in user the kept reason is of; another one, or none, forgets it. */
let owner: string | null = null;
let required = false;
let asker: (() => Promise<string | null>) | null = null;
/** The question open, which a change sent meanwhile waits for too. */
let asking: Promise<string | null> | null = null;
const listeners = new Set<() => void>();

function read(): string | null {
  if (!getSession()) return null;
  try {
    const v = sessionStorage.getItem(keptKey());
    return v !== null && reasonProblem(v) === null ? v : null;
  } catch {
    return null;
  }
}

function changed(next: string | null): void {
  if (next === kept) return;
  kept = next;
  for (const fn of listeners) fn();
}

/** Reads the reason kept in this tab, and forgets it when the user signs out or another signs in;
 * once, at start-up, after the session. */
export function initReason(): void {
  owner = getSession()?.user ?? null;
  kept = read();
  // Only the reason is kept, nothing of the session: a sign-out, or another user's sign-in here
  // or in another tab, forgets it.
  onSessionChange((session) => {
    const user = session?.user ?? null;
    if (user === owner) return;
    owner = user;
    keepReason(null);
  });
}

/** The reason kept in this tab for the signed-in user, or null. */
export function keptReason(): string | null {
  return kept;
}

/** Keeps a reason for the changes that follow, or forgets it (null). */
export function keepReason(reason: string | null): void {
  const keep = reason !== null && getSession() !== null;
  try {
    if (keep) sessionStorage.setItem(keptKey(), reason);
    else sessionStorage.removeItem(keptKey());
  } catch {
    // Without session storage the reason lasts as long as the page.
  }
  changed(keep ? reason : null);
}

export function onReasonChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Whether the server takes a change of the control plane only with a reason; the app sets it
 * from info. */
export function setReasonRequired(on: boolean): void {
  required = on;
}

/** What asks the person for a reason: resolves to it, or to null when the person does not give
 * one. The app sets it while it shows. */
export function setReasonAsker(ask: (() => Promise<string | null>) | null): void {
  asker = ask;
}

/** The reason to send with a change: the one kept, or, when the server needs one and the change
 * is not of the person's own credentials, the one the person gives now. Undefined: none, and the
 * change is sent without. Throws ReasonNotGiven when the person gives none. */
export async function reasonFor(own = false): Promise<string | undefined> {
  if (kept !== null) return kept;
  if (!required || own || !asker) return undefined;
  asking ??= asker().finally(() => (asking = null));
  const given = await asking;
  if (given === null) throw new ReasonNotGiven();
  return given;
}

/** The query and the body of a change with its reason, where the route takes it. */
export async function withReason<O extends { query?: object; body?: unknown }>(where: ReasonIn | undefined, opts: O, own = false): Promise<O> {
  if (!where) return opts;
  const reason = await reasonFor(own);
  if (reason === undefined) return opts;
  if (where === "query") return { ...opts, query: { ...opts.query, changeReason: reason } };
  return { ...opts, body: { ...(opts.body as object | undefined), changeReason: reason } };
}
