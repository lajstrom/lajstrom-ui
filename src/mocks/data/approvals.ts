// The demo's requests for a second admin (docs/spec/rbac.md §13): two that oscar made and that
// wait for admin, one of oscar's that admin rejected, and one of admin's that expired before oscar
// decided it. The mock names users user:<name> inside, as its bindings do.

import type { Approval } from "@/api/types";

import { ahead, before } from "./time";

/** A request as the mock keeps it: subject, what the same change pending twice is found by, and
 * a deploy token's secret, which the requester was shown and the approval gives the token; the
 * API answers neither. */
export type ApprovalRow = Approval & { subject: string; secret?: string };

export function approvalSeeds(): ApprovalRow[] {
  return [
    {
      id: 1,
      kind: "binding",
      subject: "group:platform admin */*",
      change: { principal: "group:platform", role: "admin", repoMask: "*/*" },
      changeReason: "CHG-2161: the platform team runs the registry",
      state: "expired",
      requestedBy: "user:admin",
      requestedAt: before(12),
      expiresAt: before(5),
      decidedBy: "anonymous",
      decidedAt: before(5),
    },
    {
      id: 2,
      kind: "binding",
      subject: "user:alice admin */*",
      change: { principal: "user:alice", role: "admin", repoMask: "*/*" },
      changeReason: "CHG-2190: alice publishes the payments releases",
      state: "rejected",
      requestedBy: "user:oscar",
      requestedAt: before(6, 2),
      expiresAt: ahead(0, 22),
      decidedBy: "user:admin",
      decidedAt: before(5, 20),
      decisionReason: "alice has writer on */payments already and needs no admin role",
    },
    {
      id: 3,
      kind: "binding",
      subject: "user:bob maintainer */*",
      change: { principal: "user:bob", role: "maintainer", repoMask: "*/*" },
      changeReason: "CHG-2207: bob takes over the release duty",
      state: "pending",
      requestedBy: "user:oscar",
      requestedAt: before(1, 3),
      expiresAt: ahead(5, 21),
    },
    {
      id: 4,
      kind: "deploy-token",
      subject: "*/payments payments-release",
      change: { repoMask: "*/payments", name: "payments-release", scopes: ["read", "write"], expiresAt: ahead(90) },
      changeReason: "CHG-2210: the release pipeline of the payments team",
      state: "pending",
      requestedBy: "user:oscar",
      requestedAt: before(0, 3),
      expiresAt: ahead(6, 21),
      secret: "ljs_dep_5e0d1c9a7b3f42e6a8c1d0b9e7f6a5c4d3b2a1908f7e6d5c",
    },
  ];
}
