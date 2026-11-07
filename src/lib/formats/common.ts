import type { VersionDetail, VersionSummary } from "@/api/types";

import type { Snippet, SnippetContext } from "./types";

export const USER = "$LAJSTROM_USER";
export const TOKEN = "$LAJSTROM_TOKEN";

/** curl's -u flag, or nothing when the read is anonymous. */
export function curlAuth(needsAuth: boolean): string {
  return needsAuth ? `-u "${USER}:${TOKEN}" ` : "";
}

export function str(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

export function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
  if (typeof v === "string" && v) return [v];
  return [];
}

/** oras and cosign work with any manifest Lajstrom stores, through the OCI facade (/v2). */
export function ociSnippets(ctx: SnippetContext, v: VersionSummary | VersionDetail, ociRepository: string): Snippet[] {
  const ref = `${ctx.host}/${ociRepository}`;
  return [
    {
      id: "oras",
      title: "oras",
      caption: "shell",
      shell: true,
      code: [
        ...(ctx.readNeedsAuth ? [`oras login ${ctx.host} -u "${USER}" -p "${TOKEN}"`] : []),
        `oras pull ${ref}:${v.tag}`,
      ].join("\n"),
      note: "oras pull writes the original file names (org.opencontainers.image.title); no Lajstrom client needed.",
    },
    {
      id: "cosign",
      title: "cosign",
      caption: "shell",
      shell: true,
      code: [
        `# sign once in CI, then verify anywhere`,
        `cosign sign ${ref}@${v.digest}`,
        `cosign verify ${ref}@${v.digest} \\`,
        `  --certificate-identity-regexp '.*' --certificate-oidc-issuer-regexp '.*'`,
      ].join("\n"),
      note: "Signatures are OCI referrers of this manifest; Lajstrom passes them through unchanged.",
    },
  ];
}

export const referrerKinds: Record<string, { kind: "signature" | "sbom" | "attestation"; label: string }> = {
  "application/vnd.dev.cosign.artifact.sig.v1+json": { kind: "signature", label: "cosign signature" },
  "application/vnd.dev.sigstore.bundle.v0.3+json": { kind: "signature", label: "Sigstore bundle" },
  "application/vnd.cncf.notary.signature": { kind: "signature", label: "Notation signature" },
  "application/spdx+json": { kind: "sbom", label: "SPDX SBOM" },
  "application/vnd.cyclonedx+json": { kind: "sbom", label: "CycloneDX SBOM" },
  "application/vnd.in-toto+json": { kind: "attestation", label: "in-toto attestation" },
  "application/vnd.dsse.envelope.v1+json": { kind: "attestation", label: "DSSE attestation" },
};
