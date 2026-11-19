// The required attachments of a repo (docs/spec/policy.md §11): what a requirement leaves out of a
// package, and a requirement in words. Read by the repo's pages alone, out of the main chunk.

import { queryOptions } from "@tanstack/react-query";

import { apiPath } from "./client";
import { allPages } from "./queries";
import type { Requirement, VersionSummary } from "./types";

/** The versions of a package, with those of their variants that a requirement would refuse:
 * what it leaves out, whether the repo has it or not (?unmet=&signedBy=). Below the versions' key,
 * so that a change of them fetches these again. */
export const unmetQuery = (format: string, repo: string, name: string, r: Requirement) =>
  queryOptions({
    queryKey: ["repos", format, repo, "package", name, "versions", "unmet", r.predicateType, ...r.signedBy],
    queryFn: ({ signal }) =>
      allPages<VersionSummary>(apiPath("repos", format, repo, "packages", name, "versions"), "versions", signal, { unmet: r.predicateType, signedBy: r.signedBy }),
  });

/** The predicate types a requirement names most, with what they are. A signature counts as the
 * first (manifest-profile.md §6.3). */
export const knownTypes: { type: string; label: string }[] = [
  { type: "https://sigstore.dev/cosign/sign/v1", label: "a signature" },
  { type: "https://spdx.dev/Document", label: "an SPDX SBOM" },
  { type: "https://cyclonedx.org/bom", label: "a CycloneDX SBOM" },
  { type: "https://slsa.dev/provenance", label: "a SLSA provenance" },
  { type: "https://cosign.sigstore.dev/attestation/vuln/v1", label: "a vulnerability scan" },
];

/** What a requirement asks for, in words: "a SLSA provenance signed by release". */
export function requirementText(r: Requirement): string {
  const known = knownTypes.find((k) => k.type === r.predicateType)?.label ?? `an attachment of ${r.predicateType}`;
  return `${known} signed by ${r.signedBy.join(" or ")}`;
}

/** Whether a repo may require attachments: a hosted repo of a format other than oci, its files
 * not encrypted at rest. */
export function mayRequire(repo: { kind?: string; format: string; policy?: { encryption?: { mode?: string } } | null }): boolean {
  return (repo.kind ?? "hosted") === "hosted" && repo.format !== "oci" && repo.policy?.encryption?.mode !== "at-rest";
}
