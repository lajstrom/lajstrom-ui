// The token exchange for CI of the demo's server (docs/spec/rbac.md §11): its auth.ci, two
// issuers and two policies of the configuration, the policies made through the API, one in each
// state, and what they left in the audit log. erin, of the platform team, signs in through OIDC
// and makes the policies that write; another admin approves them.

import type { CIGrant, CIIssuer } from "@/api/types";
import { sha256Hex } from "@/lib/sha256";

import { ago, ahead, before } from "./time";

/** A policy as the configuration and a request name it. */
export type CIPolicySpec = { name: string; issuer: string; claims: Record<string, string[]>; grants: CIGrant[] };

/** A policy of the API as the mock keeps it: its row (index-schema.md, ci_policies), principals
 * as `user:<name>`. */
export type CIPolicyRow = CIPolicySpec & {
  id: number;
  revision: number;
  state: "active" | "pending" | "expired";
  expiresAt?: string;
  renewalExpiresAt?: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  approvedBy?: string;
  approvedAt?: string;
};

/** auth.ci of the demo's configuration. */
export const ciConfig: {
  issuers: CIIssuer[];
  policies: CIPolicySpec[];
  apiWriteRepos: string[];
  apiWriteApproval: "second-admin" | "none";
} = {
  issuers: [
    { name: "github", platform: "github" },
    { name: "gitlab", platform: "gitlab" },
  ],
  policies: [
    {
      name: "release-agent",
      issuer: "github",
      claims: { repository_id: ["48211903"], repository: ["acme/agent"], ref: ["refs/tags/v*"] },
      grants: [
        { role: "maintainer", mask: "apt/ubuntu-internal" },
        { role: "writer", mask: "rpm/el9" },
        { role: "writer", mask: "raw/assets" },
      ],
    },
    {
      name: "docs-read",
      issuer: "gitlab",
      claims: { project_id: ["2201"] },
      grants: [{ role: "reader", mask: "npm/*" }],
    },
  ],
  apiWriteRepos: ["*/payments", "npm/*", "raw/*"],
  apiWriteApproval: "second-admin",
};

/** The policies of the API, by id. */
export function ciPolicySeeds(): CIPolicyRow[] {
  return [
    {
      id: 1,
      revision: 1,
      name: "pipelines-read",
      issuer: "gitlab",
      claims: { project_id: ["1872"], ref_protected: ["true"] },
      grants: [
        { role: "reader", mask: "pypi/internal" },
        { role: "reader", mask: "raw/*" },
      ],
      state: "active",
      createdBy: "user:admin",
      createdAt: ago(30, 4),
      updatedBy: "user:admin",
      updatedAt: ago(30, 4),
    },
    {
      id: 2,
      revision: 3,
      name: "payments-publish",
      issuer: "github",
      claims: { repository_id: ["61230045"], repository: ["acme/payments-api"], ref: ["refs/heads/main"], environment: ["production"] },
      grants: [
        { role: "writer", mask: "maven/payments" },
        { role: "writer", mask: "pypi/payments" },
      ],
      state: "active",
      expiresAt: ahead(169, 6),
      createdBy: "user:erin",
      createdAt: ago(10, 3),
      updatedBy: "user:erin",
      updatedAt: ago(10, 3),
      approvedBy: "user:admin",
      approvedAt: ago(10, 1),
    },
    {
      // Asked to live 20 days; its renewal waits beside it.
      id: 3,
      revision: 4,
      name: "web-publish",
      issuer: "github",
      claims: { repository_id: ["70120988"], ref: ["refs/heads/main", "refs/tags/v*"], event_name: ["push", "release"] },
      grants: [{ role: "writer", mask: "npm/internal" }],
      state: "active",
      expiresAt: ahead(8, 20),
      renewalExpiresAt: ahead(179, 21),
      createdBy: "user:erin",
      createdAt: ago(11, 5),
      updatedBy: "user:erin",
      updatedAt: before(0, 3),
      approvedBy: "user:admin",
      approvedAt: ago(11, 2),
    },
    {
      id: 4,
      revision: 1,
      name: "billing-publish",
      issuer: "gitlab",
      claims: { project_id: ["5530"], project_path: ["billing/service"], ref_path: ["refs/heads/main"], pipeline_source: ["push", "web"] },
      grants: [{ role: "writer", mask: "pypi/payments" }],
      state: "pending",
      expiresAt: ahead(179, 19),
      createdBy: "user:erin",
      createdAt: before(0, 5),
      updatedBy: "user:erin",
      updatedAt: before(0, 5),
    },
    {
      // Asked to live a week, and nobody renewed it.
      id: 5,
      revision: 3,
      name: "agent-nightly-publish",
      issuer: "github",
      claims: { repository_id: ["48211903"], ref: ["refs/heads/main"], event_name: ["schedule"] },
      grants: [{ role: "writer", mask: "raw/scratch" }],
      state: "expired",
      expiresAt: before(4, 2),
      createdBy: "user:erin",
      createdAt: ago(11, 6),
      updatedBy: "user:erin",
      updatedAt: before(4, 2),
      approvedBy: "user:admin",
      approvedAt: ago(11, 4),
    },
  ];
}

/** An audit row of the seed (src/mocks/db.ts, auditLog). */
type SeedEvent = { at: string; principal: string; action: string; repo: string; subject: string; digest: null; ip: string; details: Record<string, unknown> };

const ADMIN_IP = "10.8.0.10";
const ERIN_IP = "10.8.0.31";
const RUNNER_IP = "20.42.113.7";

/** What the policies of the seed left in the audit log: their changes, and the exchanges of the
 * CI jobs they matched, one of them refused (rbac.md §11, Audit). */
export function ciAuditSeeds(): SeedEvent[] {
  const events: SeedEvent[] = [];
  const row = (at: string, principal: string, action: string, subject: string, details: Record<string, unknown>, ip = ADMIN_IP) =>
    events.push({ at, principal, action, repo: "", subject, digest: null, ip, details: { ...details, source: "api" } });
  for (const p of ciPolicySeeds()) {
    const policy = { issuer: p.issuer, claims: p.claims, grants: p.grants };
    const writes = p.expiresAt !== undefined;
    row(p.createdAt, p.createdBy, "ci.policy.create", p.name, { ...policy, state: writes ? "pending" : "active" }, p.createdBy === "user:erin" ? ERIN_IP : ADMIN_IP);
    if (p.approvedAt && p.approvedBy) row(p.approvedAt, p.approvedBy, "ci.policy.approve", p.name, { ...policy, state: "active", previous: { ...policy, state: "pending" } });
    if (p.renewalExpiresAt) row(p.updatedAt, p.updatedBy, "ci.policy.renew", p.name, { ...policy, state: p.state, renewalExpiresAt: p.renewalExpiresAt }, ERIN_IP);
    if (p.state === "expired" && p.expiresAt) {
      events.push({ at: p.expiresAt, principal: "anonymous", action: "ci.policy.expire", repo: "", subject: p.name, digest: null, ip: "", details: { ...policy, state: "expired", source: "expiry" } });
    }
  }
  // The exchanges of the payments API's deploys from main, and a pull request's job refused.
  const exchange = (at: string, run: number) => ({
    at,
    principal: "ci:github/acme/payments-api",
    action: "token.exchange",
    repo: "",
    subject: "ci:github/acme/payments-api",
    digest: null,
    ip: RUNNER_IP,
    details: {
      source: "ci",
      outcome: "minted",
      issuer: "github",
      policies: ["payments-publish"],
      token: sha256Hex(`jti ${run}`).slice(0, 22),
      // auth.ci.tokenLifetime, 15 minutes by default.
      expiresAt: new Date(Date.parse(at) + 15 * 60_000).toISOString().replace(".000Z", "Z"),
      claims: {
        repository_id: "61230045",
        repository: "acme/payments-api",
        ref: "refs/heads/main",
        environment: "production",
        event_name: "push",
        run_id: String(9120334400 + run),
        run_attempt: "1",
        sha: sha256Hex(`commit ${run}`).slice(0, 40),
      },
    },
  });
  events.push(exchange(ago(9, 2), 11), exchange(ago(6, 7), 27), exchange(ago(1, 3), 58));
  events.push({
    at: ago(2, 5),
    principal: "ci:github/acme/payments-api",
    action: "token.exchange",
    repo: "",
    subject: "ci:github/acme/payments-api",
    digest: null,
    ip: RUNNER_IP,
    details: {
      source: "ci",
      outcome: "refused",
      reason: "no policy of the issuer matches the token",
      issuer: "github",
      claims: { repository_id: "61230045", repository: "acme/payments-api", ref: "refs/pull/412/merge", event_name: "pull_request" },
    },
  });
  return events;
}
