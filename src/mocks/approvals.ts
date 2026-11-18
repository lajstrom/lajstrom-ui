// The mock's requests for a second admin (docs/spec/rbac.md §13; internal/auth/approvals.go and
// approve.go of the server): with auth.approval second-admin (serverInfo.approval), a binding of
// the role admin or on */*, and a deploy token over a mask with write, are a request in place of
// the change, answered 202; an admin other than the requester approves it with the admin's
// password, which makes the change, and any admin rejects it, the requester so withdrawing it. A
// request still pending 7 days after it was made expires. Each request and decision is an audit
// row, the change's own row beside an approval. What changes here is kept between visits
// (src/mocks/state.ts).

import type { Approval, ApprovalList, CreatedApproval } from "@/api/types";

import { checkToken, makeToken, nameTaken, newSecret, type TokenDraft } from "./auth";
import { approvalSeeds, type ApprovalRow } from "./data/approvals";
import { apiPrincipal, audited, checkBinding, isAdmin, makeBinding, maskRefusal, userByRef, type BindingChange, type Refusal } from "./db";
import { currentReason, withReason } from "./reason";
import { keep, persist } from "./state";

/** How long a request waits for a decision (auth.ApprovalLifetime). */
const LIFETIME = 7 * 86_400_000;

const invalid = (message: string): Refusal => ({ status: 400, code: "INVALID", message });
const conflict = (message: string): Refusal => ({ status: 409, code: "CONFLICT", message });
const forbidden = (message: string): Refusal => ({ status: 403, code: "FORBIDDEN", message });
const notFound = (id: string): Refusal => ({ status: 404, code: "NOT_FOUND", message: `request ${id} does not exist` });

const rows: ApprovalRow[] = approvalSeeds();
let nextId = Math.max(0, ...rows.map((r) => r.id)) + 1;

keep("approvals", {
  save: () => ({ rows, nextId }),
  load: (data) => {
    const d = data as { rows?: unknown; nextId?: unknown };
    if (!Array.isArray(d.rows) || typeof d.nextId !== "number") return;
    rows.splice(0, rows.length, ...(d.rows as ApprovalRow[]));
    nextId = d.nextId;
  },
});

/** Whether a binding waits for a second admin (auth.BindingWaits). */
export const bindingWaits = (role: string, mask: string) => role === "admin" || mask === "*/*";

/** Whether a deploy token over a mask waits (auth.MaskDeployWaits). */
export const maskTokenWaits = (scopes: readonly string[]) => scopes.includes("write");

/** A request as the API answers it: a user principal by its uid. */
function view(r: ApprovalRow): Approval {
  const { secret: _secret, subject: _subject, ...a } = r;
  const change = r.kind === "binding" ? { ...r.change, principal: apiPrincipal(r.change.principal!) } : r.change;
  return { ...a, change, requestedBy: apiPrincipal(r.requestedBy), ...(r.decidedBy ? { decidedBy: apiPrincipal(r.decidedBy) } : {}) };
}

function row(event: { by: string; action: string; r: ApprovalRow; details: Record<string, unknown>; source?: string }) {
  audited({
    principal: event.by,
    action: event.action,
    repo: "",
    subject: `approval:${event.r.id}`,
    details: { ...event.details, source: event.source ?? "api" },
  });
}

/** Marks the requests still pending at their expiry expired, each with its approval.expire row by
 * anonymous, as a replica's pass does once a minute; asked before every read and decision. */
function expire(now = Date.now()): void {
  let any = false;
  for (const r of rows) {
    if (r.state !== "pending" || Date.parse(r.expiresAt) > now) continue;
    Object.assign(r, { state: "expired", decidedBy: "anonymous", decidedAt: new Date(now).toISOString() });
    row({ by: "anonymous", action: "approval.expire", r, details: { kind: r.kind, change: r.change, requestedBy: apiPrincipal(r.requestedBy) }, source: "expiry" });
    any = true;
  }
  if (any) persist();
}

/** Makes the request of a change by the admin by (user:<name>), pending, with its
 * approval.request row; the same change pending twice is 409. */
function request(kind: ApprovalRow["kind"], subject: string, change: ApprovalRow["change"], by: string, secret?: string): ApprovalRow | Refusal {
  expire();
  if (rows.some((r) => r.state === "pending" && r.kind === kind && r.subject === subject)) {
    return conflict(`the same change waits for a second admin already: ${subject} (the requests of state pending)`);
  }
  const now = Date.now();
  const reason = currentReason();
  const r: ApprovalRow = {
    id: nextId++,
    kind,
    subject,
    change,
    ...(reason ? { changeReason: reason } : {}),
    state: "pending",
    requestedBy: by,
    requestedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + LIFETIME).toISOString(),
    ...(secret ? { secret } : {}),
  };
  rows.push(r);
  row({ by, action: "approval.request", r, details: { kind, change: view(r).change, expiresAt: r.expiresAt } });
  persist();
  return r;
}

/** POST /api/v1/bindings of a binding that waits: the request in its place. */
export function requestBinding(body: unknown, by: string): CreatedApproval | Refusal {
  const c = checkBinding(body);
  if ("status" in c) return c;
  const r = request("binding", `${c.principal} ${c.role} ${c.repoMask}`, { principal: c.principal, role: c.role, repoMask: c.repoMask }, by);
  return "status" in r ? r : view(r);
}

/** POST /api/v1/deploy-tokens of a token that waits: the request in its place, with the token's
 * secret, this once. The request keeps its hash, never the secret. */
export function requestMaskToken(repoMask: string, rest: unknown, by: string): CreatedApproval | Refusal {
  const owner = { repoMask };
  const draft = checkToken(owner, rest);
  if ("status" in draft) return draft;
  const secret = newSecret(owner);
  const r = request("deploy-token", `${repoMask} ${draft.name}`, { repoMask, name: draft.name, scopes: draft.scopes, expiresAt: draft.expiresAt }, by, secret);
  return "status" in r ? r : { ...view(r), secret };
}

/** GET /api/v1/approvals: a page, newest first, of a state or of every one. */
export function listApprovals(state: string | null, cursor: string | null, limit: number): ApprovalList | Refusal {
  expire();
  if (state !== null && !["pending", "approved", "rejected", "expired"].includes(state)) {
    return invalid(`state: "${state}" is not pending, approved, rejected or expired`);
  }
  let before = Infinity;
  if (cursor) {
    const id = Number(atob(cursor.replace(/-/g, "+").replace(/_/g, "/")));
    if (!Number.isSafeInteger(id) || id < 1) return invalid(`cursor: "${cursor}" is not the next of a page of this list`);
    before = id;
  }
  const list = rows
    .filter((r) => (state === null || r.state === state) && r.id < before)
    .sort((a, b) => b.id - a.id)
    .slice(0, limit + 1);
  const page = list.slice(0, limit);
  const next = list.length > limit ? btoa(String(page[page.length - 1]!.id)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_") : undefined;
  return { approvals: page.map(view), ...(next ? { next } : {}) };
}

function find(idText: string): ApprovalRow | Refusal {
  const id = /^\d+$/.test(idText) ? Number(idText) : 0;
  return rows.find((r) => r.id === id) ?? notFound(idText);
}

/** GET /api/v1/approvals/{id}. */
export function getApproval(idText: string): Approval | Refusal {
  expire();
  const r = find(idText);
  return "status" in r ? r : view(r);
}

/** A request that may be decided now, or the 409 saying why not. */
function pending(r: ApprovalRow): Refusal | null {
  if (r.state !== "pending") return conflict(`request ${r.id} is ${r.state}: it was decided`);
  return null;
}

/** POST /api/v1/approvals/{id}/approve by the admin by, the credential checked before: another
 * admin than the requester; the requester still an enabled admin; the change still possible.
 * Makes the change with its own row, which has the approval and the request's reason, then the
 * request approved with the approval.approve row, which has the approver's. */
export function approve(idText: string, by: string): Approval | Refusal {
  expire();
  const r = find(idText);
  if ("status" in r) return r;
  const decided = pending(r);
  if (decided) return decided;
  if (r.requestedBy === by) return forbidden(`request ${r.id}: the admin who made it does not approve it: another admin does`);
  const requester = userByRef(r.requestedBy.slice(5));
  if (!requester) return conflict(`request ${r.id}: its requester ${apiPrincipal(r.requestedBy)} no longer exists`);
  if (requester.disabled) return conflict(`request ${r.id}: its requester ${requester.name} is disabled`);
  if (!isAdmin(requester.name)) return conflict(`request ${r.id}: its requester ${requester.name} no longer has the admin role`);
  const approval = { id: r.id, requestedBy: apiPrincipal(r.requestedBy), requestedAt: r.requestedAt };
  const made = withReason(r.changeReason ?? null, () => apply(r, by, approval));
  if (typeof made !== "string") return made;
  Object.assign(r, { state: "approved", decidedBy: by, decidedAt: new Date().toISOString(), result: made, ...decision() });
  delete r.secret;
  row({ by, action: "approval.approve", r, details: { kind: r.kind, change: view(r).change, requestedBy: approval.requestedBy } });
  persist();
  return view(r);
}

/** The change of a request made, checked again: binding:<id> or token:<id>, or the 409 naming
 * what no longer holds. */
function apply(r: ApprovalRow, by: string, approval: Record<string, unknown>): string | Refusal {
  if (r.kind === "binding") {
    const c = checkBinding({ principal: r.change.principal, role: r.change.role, repoMask: r.change.repoMask });
    if ("status" in c) return c.status === 409 ? c : conflict(`request ${r.id}: ${c.message}`);
    const b: BindingChange = c;
    return `binding:${makeBinding(b, by, { approval }).id}`;
  }
  const owner = { repoMask: r.change.repoMask! };
  const bad = maskRefusal(owner.repoMask) ?? nameTaken(owner, r.change.name!);
  if (bad) return bad.status === 409 ? bad : conflict(`request ${r.id}: ${bad.message}`);
  if (r.change.expiresAt && Date.parse(r.change.expiresAt) <= Date.now()) return conflict(`request ${r.id}: expiresAt: ${r.change.expiresAt} has passed`);
  const draft: TokenDraft = { name: r.change.name!, scopes: r.change.scopes as TokenDraft["scopes"], expiresAt: r.change.expiresAt ?? null };
  return `token:${makeToken(owner, draft, r.secret).id}`;
}

/** The decider's reason, when the decision has one. */
function decision(): { decisionReason?: string } {
  const reason = currentReason();
  return reason ? { decisionReason: reason } : {};
}

/** POST /api/v1/approvals/{id}/reject by the admin by, the requester's being a withdrawal. */
export function reject(idText: string, by: string): Approval | Refusal {
  expire();
  const r = find(idText);
  if ("status" in r) return r;
  const decided = pending(r);
  if (decided) return decided;
  Object.assign(r, { state: "rejected", decidedBy: by, decidedAt: new Date().toISOString(), ...decision() });
  delete r.secret;
  row({ by, action: "approval.reject", r, details: { kind: r.kind, change: view(r).change, requestedBy: apiPrincipal(r.requestedBy) } });
  persist();
  return view(r);
}
