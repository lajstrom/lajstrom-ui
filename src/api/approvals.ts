// The requests for a second admin (docs/spec/rbac.md §13): with auth.approval second-admin, a
// binding of the role admin or on */*, and a deploy token over a mask with write, are answered
// 202 with a request in place of the change, which an admin other than the requester approves.

import type { Approval, CreatedApproval } from "./types";

/** Whether a change's answer is a request for a second admin in its place. */
export function isApproval<T extends object>(answer: T | CreatedApproval): answer is CreatedApproval {
  return "state" in answer && "requestedBy" in answer && "change" in answer;
}

/** Whether the server makes a binding wait for a second admin (auth.BindingWaits). */
export const bindingWaits = (role: string, repoMask: string) => role === "admin" || repoMask === "*/*";

/** Whether the server makes a deploy token over a mask wait (auth.MaskDeployWaits). */
export const maskTokenWaits = (scopes: readonly string[]) => scopes.includes("write");

/** The change of a request in words, its principal named by name: "erin as admin", "the deploy
 * token ci over npm/payments". */
export function describeRequest(a: Pick<Approval, "kind" | "change">, name: (principal: string) => string = (p) => p): string {
  const c = a.change;
  if (a.kind === "binding") return c.role === "admin" ? `${name(c.principal ?? "")} as admin` : `${name(c.principal ?? "")} as ${c.role} on ${c.repoMask}`;
  return `the deploy token ${c.name} over ${c.repoMask}`;
}
