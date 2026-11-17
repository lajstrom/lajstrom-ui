// CI trust policies as the UI shows and edits them (docs/spec/rbac.md §11 of lajstrom/lajstrom,
// docs/api.md there, CI trust policies): the claims a policy may name on each platform, a
// policy's state and expiry, the draft of its form, and the server's refusals by field.

import type { CIGrant, CIIssuer, CIPolicy } from "@/api/types";

export type Platform = CIIssuer["platform"];

/** How a policy compares a claim: an id, decimal digits; a name, which anyone may register
 * again; a pattern, with * and **; a value of the few the platform defines. */
export type ClaimKind = "id" | "name" | "pattern" | "value";

type PlatformSpec = {
  label: string;
  /** The claims a policy may name, by kind, in the order of rbac.md §11. */
  claims: Record<ClaimKind, string[]>;
  /** A policy names its project by one of these. */
  ids: string[];
  /** A policy that writes names one of these. */
  writeConditions: string[];
  /** The claim of the job's event, and its values of a pull request, which never write. */
  event: string;
  pullRequests: string[];
};

/** The claims table of rbac.md §11 (internal/config/ci.go of the server, CIPlatforms). */
export const platforms: Record<Platform, PlatformSpec> = {
  github: {
    label: "GitHub Actions",
    claims: {
      id: ["repository_id", "repository_owner_id", "actor_id"],
      name: ["repository", "repository_owner", "actor"],
      pattern: ["ref", "environment", "workflow_ref", "job_workflow_ref"],
      value: ["ref_type", "ref_protected", "event_name", "runner_environment", "repository_visibility"],
    },
    ids: ["repository_id", "repository_owner_id"],
    writeConditions: ["ref", "environment"],
    event: "event_name",
    pullRequests: ["pull_request", "pull_request_target", "pull_request_review", "pull_request_review_comment"],
  },
  gitlab: {
    label: "GitLab CI",
    claims: {
      id: ["project_id", "namespace_id", "user_id"],
      name: ["project_path", "namespace_path", "user_login"],
      pattern: ["ref", "ref_path", "environment", "ci_config_ref_uri"],
      value: ["ref_type", "ref_protected", "environment_protected", "pipeline_source", "runner_environment", "deployment_tier", "project_visibility"],
    },
    ids: ["project_id", "namespace_id"],
    writeConditions: ["ref", "ref_path", "environment"],
    event: "pipeline_source",
    pullRequests: ["merge_request_event", "external_pull_request_event"],
  },
};

export const claimKinds: { kind: ClaimKind; label: string; hint: string }[] = [
  { kind: "id", label: "Ids", hint: "decimal digits; a policy names its project by one" },
  { kind: "name", label: "Names", hint: "compared exactly; a name can be registered again by anyone, so name the id too" },
  { kind: "pattern", label: "Patterns", hint: "* matches any run of characters but /, ** any run" },
  { kind: "value", label: "Values", hint: "compared exactly, one of the values the platform defines" },
];

/** The kind of a claim on a platform; null for a claim the platform does not have. */
export function claimKind(platform: Platform, claim: string): ClaimKind | null {
  for (const { kind } of claimKinds) if (platforms[platform].claims[kind].includes(claim)) return kind;
  return null;
}

/** Whether a role grants more than read: writer and maintainer take the steps of rbac.md §11. */
export const writesRole = (role: string) => role === "writer" || role === "maintainer";

/** Whether a policy grants writer or maintainer anywhere. */
export const writes = (p: { grants: CIGrant[] }) => p.grants.some((g) => writesRole(g.role));

export const isConfig = (p: CIPolicy) => p.source === "config";

/** The platform of an issuer: the server's issuers say it (proposed: CIPolicyList.issuers); else
 * the claims its policies name, an id of one platform; null when nothing tells. */
export function platformOf(issuer: string, issuers: CIIssuer[] | undefined, policies: CIPolicy[]): Platform | null {
  const listed = issuers?.find((i) => i.name === issuer);
  if (listed) return listed.platform;
  for (const p of policies) {
    if (p.issuer !== issuer) continue;
    for (const platform of ["github", "gitlab"] as const) {
      if (platforms[platform].ids.some((c) => c in p.claims)) return platform;
    }
  }
  return null;
}

/** The issuer names the form offers: the server's, or those its policies name. */
export function issuerNames(issuers: CIIssuer[] | undefined, policies: CIPolicy[]): string[] {
  if (issuers) return issuers.map((i) => i.name);
  return [...new Set(policies.map((p) => p.issuer))].sort();
}

// --- State and expiry -------------------------------------------------------------------------

/** What waits for an admin's approval: the policy, pending, or its renewal; null when nothing. */
export function waiting(p: CIPolicy): "policy" | "renewal" | null {
  if (isConfig(p) || p.state === "expired") return null;
  if (p.state === "pending") return "policy";
  return p.renewal ? "renewal" : null;
}

/** Why the caller may not approve what waits on p, or null when it may: an admin other than the
 * one who made the change (updatedBy, rbac.md §11); the server checks it again. */
export function approvalRefusal(p: CIPolicy, principal: string | undefined): string | null {
  if (!waiting(p)) return "Nothing waits for an approval.";
  if (principal && p.updatedBy === principal) return "You made the change that waits: another admin approves it.";
  return null;
}

/** Whether p may be renewed: a policy of the API that writes, active or expired; a pending one
 * gets its expiry from a change (409 otherwise). */
export const renewable = (p: CIPolicy) => !isConfig(p) && writes(p) && p.state !== "pending";

const DAY = 86_400_000;

/** Whole days from now to iso, rounded down; negative once it has passed. */
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.floor((Date.parse(iso) - now) / DAY);
}

/** A policy expires soon within this many days: the list says so in the warning's colour. */
export const EXPIRES_SOON = 14;

/** "expires in 12 days", "expires tomorrow", "expires today", "expired 3 days ago". */
export function expiryText(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso) - now;
  if (ms <= 0) {
    const days = Math.floor(-ms / DAY);
    return days === 0 ? "expired today" : days === 1 ? "expired yesterday" : `expired ${days} days ago`;
  }
  const days = Math.floor(ms / DAY);
  return days === 0 ? "expires today" : days === 1 ? "expires tomorrow" : `expires in ${days} days`;
}

// --- The form -----------------------------------------------------------------------------------

/** The longest a policy that writes lives, and its expiry when none is asked. */
export const MAX_DAYS = 180;

/** A claim and its values, one per line: any of them matches. */
export type ClaimRow = { claim: string; values: string };

export type GrantRow = { role: CIGrant["role"]; mask: string };

/** What the form of a policy holds. platform is the hints' platform, for an issuer whose platform
 * the server does not say; days, of a policy that writes, the days to its expiry. */
export type Draft = { name: string; issuer: string; platform: Platform; claims: ClaimRow[]; grants: GrantRow[]; days: string };

/** The draft of a new policy of an issuer's platform: its first id and a ref to fill in. */
export function newDraft(issuer: string, platform: Platform): Draft {
  return {
    name: "",
    issuer,
    platform,
    claims: [
      { claim: platforms[platform].ids[0]!, values: "" },
      { claim: "ref", values: "" },
    ],
    grants: [{ role: "reader", mask: "" }],
    days: String(MAX_DAYS),
  };
}

/** The draft of a change of p. */
export function draftOf(p: CIPolicy, platform: Platform): Draft {
  return {
    name: p.name,
    issuer: p.issuer,
    platform,
    claims: Object.entries(p.claims).map(([claim, values]) => ({ claim, values: values.join("\n") })),
    grants: p.grants.map((g) => ({ ...g })),
    days: String(MAX_DAYS),
  };
}

/** The values of a row: one per line, trimmed, the empty ones left out. */
export const valuesOf = (row: ClaimRow) =>
  row.values
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);

/** The body of a create or a change, as the server reads it: the claims of the rows that name
 * one and have values, a claim named twice with the values of both (a row left empty, such as
 * the ref a new policy starts with, is no condition: the server names a condition it needs);
 * every grant row, so that a refusal's grants[<i>] is the form's row <i>; for a policy that
 * writes, the expiry asked, left out for the server's 180 days. now is when the change is made. */
export function bodyOf(d: Draft, now: number): Pick<CIPolicy, "name" | "issuer" | "claims" | "grants" | "expiresAt"> {
  const claims: Record<string, string[]> = {};
  for (const row of d.claims) {
    const claim = row.claim.trim();
    const values = valuesOf(row);
    if (claim && values.length) claims[claim] = [...new Set([...(claims[claim] ?? []), ...values])];
  }
  const grants = d.grants.map((g) => ({ role: g.role, mask: g.mask.trim() }));
  const days = Number(d.days);
  const expiresAt =
    writes({ grants }) && d.days.trim() !== "" && Number.isFinite(days) && days !== MAX_DAYS ? new Date(now + days * DAY).toISOString().replace(/\.\d+Z$/, "Z") : undefined;
  return { name: d.name.trim(), issuer: d.issuer.trim(), claims, grants, ...(expiresAt ? { expiresAt } : {}) };
}

// --- The server's refusals by field -----------------------------------------------------------

/** A field of the form that a refusal names: name, issuer, claims, claims.<claim>, grants,
 * grants.<row>, expiresAt; "" for the form as a whole. */
export type FieldKey = string;

const FIELD = /^(name|issuer|claims(?:\.[A-Za-z0-9_]+)?|grants(?:\[(\d+)\](?:\.(?:role|mask))?)?|expiresAt): /;

/**
 * The parts of a refusal by the field each names. The server joins the problems of a policy with
 * "; ", each starting with its field (config.CheckCIPolicy): "claims.ref: … ; grants[1].mask: …";
 * a 403 names the grant outside auth.ci.apiWriteRepos as grants[<i>]. A part that names no field
 * goes with the one before it, or with the form.
 */
export function fieldErrors(message: string): Map<FieldKey, string[]> {
  const out = new Map<FieldKey, string[]>();
  let last: { key: FieldKey; i: number } | null = null;
  for (const part of message.split("; ")) {
    const m = FIELD.exec(part);
    if (m) {
      const key = m[2] !== undefined ? `grants.${m[2]}` : m[1]!;
      const list = out.get(key) ?? [];
      list.push(part.slice(m[0].length));
      out.set(key, list);
      last = { key, i: list.length - 1 };
    } else if (last) {
      const list = out.get(last.key)!;
      list[last.i] = `${list[last.i]}; ${part}`;
    } else {
      out.set("", [...(out.get("") ?? []), part]);
    }
  }
  return out;
}
