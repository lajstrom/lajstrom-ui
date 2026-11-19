// The required attachments of a repo in the mock (docs/spec/policy.md §11; internal/policy/
// requirements.go and internal/api/policy.go of the server): policy.requireAttachments, a list of
// {predicateType, signedBy}, checked as the server checks it, with its messages; and whether an
// attachment meets a requirement, which ?unmet= of a version list reads.

import type { Refusal } from "./db";

/** The demo's trust of attachments (attachments.trust and attachments.keyless.identities): the
 * names an attachment is verified by, each with the predicate types it is trusted for, none for
 * every type. The provenance of the demo is signed by release-key (src/mocks/db.ts). */
export const TRUST: { name: string; predicateTypes: string[] }[] = [{ name: "release-key", predicateTypes: [] }];

/** The predicate type a signature counts as. */
export const SIGNATURE_TYPE = "https://sigstore.dev/cosign/sign/v1";
const VERDICT_TYPE = "https://lajstrom.dev/verdict/v1";
const POLICY_KEY = "lajstrom";
const MAX = 16;

const invalid = (message: string): Refusal => ({ status: 400, code: "INVALID", message });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Whether t is the predicate type want, or one that continues it after a "/" (profile.IsType). */
export function isType(t: string, want: string): boolean {
  return t === want || t.startsWith(`${want}/`);
}

/** Why t is no predicate type of a requirement or of ?unmet= (policy.CheckPredicateType). */
export function predicateTypeProblem(t: string): string | null {
  if (new TextEncoder().encode(t).length > 256) return "is longer than 256 bytes";
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:[\x21-\x7e]*$/.test(t)) return `${JSON.stringify(t)} is not an absolute URI (RFC 3986, with a scheme)`;
  return null;
}

/** The form of policy.requireAttachments in a body (checkRequirementsShape). */
export function requirementsShape(v: unknown): Refusal | null {
  if (!Array.isArray(v)) return invalid('policy.requireAttachments: must be a list of {"predicateType", "signedBy"}');
  for (const [i, item] of v.entries()) {
    const field = `policy.requireAttachments[${i}]`;
    if (!isObject(item)) return invalid(`${field}: must be a JSON object {"predicateType", "signedBy"}`);
    for (const k of Object.keys(item).sort()) {
      if (k === "predicateType") {
        if (typeof item[k] !== "string") return invalid(`${field}.predicateType: must be a string, an absolute URI`);
      } else if (k === "signedBy") {
        const names = item[k];
        if (!Array.isArray(names) || names.some((n) => typeof n !== "string")) {
          return invalid(`${field}.signedBy: must be a list of names of attachments.trust or attachments.keyless.identities`);
        }
      } else return invalid(`${field}.${k} is not a policy key: the keys are predicateType and signedBy`);
    }
  }
  return null;
}

type Requirement = { predicateType?: unknown; signedBy?: unknown };

/** The requirements of a repo's policy as a change leaves it, against the repo and the trust
 * (policy.CheckRequirements): the first problem, naming its key path. */
export function checkRequirements(reqs: Requirement[], repo: { kind: string; format: string; encrypted: boolean }): Refusal | null {
  const rule = (field: string, problem: string) => invalid(`policy.${field}: ${problem}`);
  if (repo.kind === "proxy") return rule("requireAttachments", "a proxy repo cannot require attachments: a version it fetches has none yet, so it would fetch none");
  if (repo.kind === "group") return rule("requireAttachments", "a group has no policy; its members' requirements hold through it");
  if (repo.format === "oci") return rule("requireAttachments", "an oci repo indexes no attachments, and its consumers verify them (ADR 0008)");
  if (repo.encrypted) return rule("requireAttachments", "a repo encrypted at rest cannot require attachments: its attachments are encrypted, and never verify");
  if (reqs.length === 0 || reqs.length > MAX) return rule("requireAttachments", `must be a list of 1 to ${MAX} requirements`);
  const seen = new Map<string, number>();
  for (const [i, r] of reqs.entries()) {
    const field = `requireAttachments[${i}]`;
    const type = String(r.predicateType ?? "");
    const problem = predicateTypeProblem(type);
    if (problem) return rule(`${field}.predicateType`, problem);
    if (isType(VERDICT_TYPE, type)) {
      return rule(`${field}.predicateType`, `${JSON.stringify(type)} matches the predicate type of verdicts, which policy decides by their value`);
    }
    const names = Array.isArray(r.signedBy) ? (r.signedBy as string[]) : [];
    if (names.length === 0 || names.length > MAX) return rule(`${field}.signedBy`, `must be a list of 1 to ${MAX} names`);
    for (const [j, name] of names.entries()) {
      const f = `${field}.signedBy[${j}]`;
      const trusted = TRUST.find((t) => t.name === name);
      if (name === POLICY_KEY) return rule(f, `${JSON.stringify(name)} is the policy key, which verifies verdicts only`);
      if (!trusted) return rule(f, `${JSON.stringify(name)} is neither a key of attachments.trust nor an identity of attachments.keyless.identities`);
      if (trusted.predicateTypes.length && !trusted.predicateTypes.some((t) => isType(t, type))) {
        return rule(f, `${JSON.stringify(name)} is trusted for ${trusted.predicateTypes.join(", ")} only, none of them ${type} or a longer version of it`);
      }
    }
    const key = `${type} ${[...names].sort().join(" ")}`;
    const j = seen.get(key);
    if (j !== undefined) return rule(field, `is the same as requireAttachments[${j}]`);
    seen.set(key, i);
  }
  return null;
}

/** An attachment as the index labels it: its predicate type, a signature's as SIGNATURE_TYPE. */
export type Label = { predicateType: string; verification: string; signedBy?: string };

/** Whether attachments meet the requirement {predicateType, signedBy}: one verified of the type, or
 * of one that continues it, signed by one of the names that the trust has. */
export function meets(attachments: Label[], predicateType: string, signedBy: string[]): boolean {
  return attachments.some(
    (a) =>
      a.verification === "verified" &&
      isType(a.predicateType, predicateType) &&
      a.signedBy !== undefined &&
      signedBy.includes(a.signedBy) &&
      TRUST.some((t) => t.name === a.signedBy),
  );
}

/** ?unmet=&signedBy= of a version list, or null for none, or the server's 400. */
export function unmetQuery(url: URL): { predicateType: string; signedBy: string[] } | Refusal | null {
  const unmet = url.searchParams.getAll("unmet");
  const signedBy = url.searchParams.getAll("signedBy");
  if (!unmet.length && !signedBy.length) return null;
  if (unmet.length > 1) return invalid("unmet: once");
  if (!unmet.length) return invalid("signedBy: only with unmet, the predicate type of the requirement");
  if (!signedBy.length) return invalid("unmet: with signedBy, the names of the requirement");
  if (signedBy.length > MAX) return invalid(`signedBy: at most ${MAX} names`);
  const problem = predicateTypeProblem(unmet[0]!);
  if (problem) return invalid(`unmet: ${problem}`);
  return { predicateType: unmet[0]!, signedBy };
}
