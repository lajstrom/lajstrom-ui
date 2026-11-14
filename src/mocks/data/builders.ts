// Builders that turn a compact description of a package version into what the API would return:
// the manifest of docs/spec/manifest-profile.md with real sha256 digests, the tag of §4.2, the
// package path of §4.1 and the index rows.

import type { FormatName, OciDescriptor, OciManifest } from "@/api/types";
import { packagePath, tagFor } from "@/lib/profile";
import { Rand } from "@/lib/prng";
import { sha256Hex } from "@/lib/sha256";

import type { MockFile, MockReferrer, MockVersion } from "./model";

export const EMPTY_CONFIG: OciDescriptor = {
  mediaType: "application/vnd.oci.empty.v1+json",
  digest: "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
  size: 2,
};

const artifactTypes: Record<FormatName, string> = {
  raw: "application/vnd.lajstrom.raw.v1",
  pypi: "application/vnd.lajstrom.pypi.v1",
  apt: "application/vnd.lajstrom.deb.v1",
  maven: "application/vnd.lajstrom.maven.v1",
};

const metadataTypes: Record<FormatName, string> = {
  raw: "application/vnd.lajstrom.raw.metadata.v1+json",
  pypi: "application/vnd.lajstrom.pypi.metadata.v1+json",
  apt: "application/vnd.lajstrom.deb.metadata.v1+json",
  maven: "application/vnd.lajstrom.maven.metadata.v1+json",
};

export type FileSpec = {
  name: string;
  mediaType: string;
  size: number;
  /** Layer annotations besides org.opencontainers.image.title. */
  attrs?: Record<string, string>;
};

export type ReferrerSpec = "cosign" | "notation" | "spdx" | "cyclonedx" | "slsa";

export type VersionSpec = {
  format: FormatName;
  repo: string;
  name: string;
  version: string;
  variant?: string;
  files: FileSpec[];
  metadata: Record<string, unknown> | null;
  /** Format annotations without the "lajstrom." prefix: deb.suite, maven.groupId, … */
  attrs?: Record<string, string>;
  createdAt: string;
  uploadedBy: string;
  referrers?: ReferrerSpec[];
  /** CI provenance passed through from the client. */
  source?: { url: string; revision: string };
  /** Annotations missing or the metadata layer unreadable: reindex flags the row (§2). */
  degraded?: boolean;
};

const MEDIA_MANIFEST = "application/vnd.oci.image.manifest.v1+json";

function digestOf(s: string): string {
  return `sha256:${sha256Hex(s)}`;
}

function referrer(kind: ReferrerSpec, subject: string, createdAt: string, rand: Rand): MockReferrer {
  const at = new Date(new Date(createdAt).getTime() + rand.int(20, 400) * 1000).toISOString();
  const digest = digestOf(`${kind}:${subject}`);
  switch (kind) {
    case "cosign":
      return {
        digest,
        artifactType: "application/vnd.dev.cosign.artifact.sig.v1+json",
        kind: "signature",
        tool: "cosign",
        size: rand.int(250, 420),
        createdAt: at,
        annotations: {
          "dev.sigstore.cosign/bundle": "{…}",
          "dev.sigstore.cosign/certificate-identity":
            "https://github.com/acme/platform/.github/workflows/release.yml@refs/heads/main",
          "dev.sigstore.cosign/certificate-oidc-issuer": "https://token.actions.githubusercontent.com",
          "org.opencontainers.image.created": at,
        },
      };
    case "notation":
      return {
        digest,
        artifactType: "application/vnd.cncf.notary.signature",
        kind: "signature",
        tool: "notation",
        size: rand.int(1800, 2600),
        createdAt: at,
        annotations: {
          "io.cncf.notary.x509chain.thumbprint#S256": `["${sha256Hex("notary" + subject)}"]`,
          "org.opencontainers.image.created": at,
        },
      };
    case "spdx":
      return {
        digest,
        artifactType: "application/spdx+json",
        kind: "sbom",
        tool: "syft",
        size: rand.int(18_000, 160_000),
        createdAt: at,
        annotations: { "org.opencontainers.image.created": at, "dev.lajstrom.sbom.packages": String(rand.int(12, 240)) },
      };
    case "cyclonedx":
      return {
        digest,
        artifactType: "application/vnd.cyclonedx+json",
        kind: "sbom",
        tool: "cyclonedx-maven-plugin",
        size: rand.int(30_000, 210_000),
        createdAt: at,
        annotations: { "org.opencontainers.image.created": at },
      };
    case "slsa":
      return {
        digest,
        artifactType: "application/vnd.in-toto+json",
        kind: "attestation",
        tool: "slsa-github-generator",
        size: rand.int(4_000, 9_000),
        createdAt: at,
        annotations: {
          "org.opencontainers.image.created": at,
          "in-toto.io/predicate-type": "https://slsa.dev/provenance/v1",
        },
      };
  }
}

export type BuiltVersion = MockVersion & { packageName: string };

export function buildVersion(spec: VersionSpec, host: string): BuiltVersion {
  const variant = spec.variant ?? "";
  const rand = new Rand(`${spec.repo}/${spec.name}/${spec.version}/${variant}`);
  const layers: OciDescriptor[] = spec.files.map((f) => ({
    mediaType: f.mediaType,
    digest: digestOf(`${spec.format}/${spec.repo}/${spec.name}/${spec.version}/${variant}/${f.name}`),
    size: f.size,
    annotations: { "org.opencontainers.image.title": f.name, ...(f.attrs ?? {}) },
  }));

  const metadataJson = spec.metadata ? JSON.stringify(spec.metadata) : null;
  if (metadataJson) {
    layers.push({
      mediaType: metadataTypes[spec.format],
      digest: digestOf(metadataJson),
      size: metadataJson.length,
      annotations: { "org.opencontainers.image.title": "metadata.json" },
    });
  }

  const annotations: Record<string, string> = {
    "lajstrom.schema": "1",
    "lajstrom.format": spec.format,
    "lajstrom.repo": spec.repo,
    "lajstrom.name": spec.name,
    "lajstrom.version": spec.version,
    ...(variant ? { "lajstrom.variant": variant } : {}),
    ...Object.fromEntries(Object.entries(spec.attrs ?? {}).map(([k, v]) => [`lajstrom.${k}`, v])),
    "lajstrom.uploaded-by": spec.uploadedBy,
    "org.opencontainers.image.created": spec.createdAt,
    ...(spec.source
      ? {
          "org.opencontainers.image.source": spec.source.url,
          "org.opencontainers.image.revision": spec.source.revision,
        }
      : {}),
  };
  if (spec.degraded) delete annotations["lajstrom.uploaded-by"];

  const manifest: OciManifest = {
    schemaVersion: 2,
    mediaType: MEDIA_MANIFEST,
    artifactType: artifactTypes[spec.format],
    config: EMPTY_CONFIG,
    layers,
    annotations,
  };
  const digest = digestOf(JSON.stringify(manifest));
  const tag = tagFor(spec.version, variant);
  const nameOci = packagePath(spec.format, spec.name);

  const files: MockFile[] = spec.files.map((f, i) => ({
    name: f.name,
    mediaType: f.mediaType,
    digest: layers[i]!.digest,
    size: f.size,
    attrs: layers[i]!.annotations ?? {},
  }));

  const referrerList = (spec.referrers ?? []).map((k) => referrer(k, digest, spec.createdAt, rand));
  const count = (kind: MockReferrer["kind"]) => referrerList.filter((r) => r.kind === kind).length;
  const indexedAt = new Date(new Date(spec.createdAt).getTime() + rand.int(1, 3) * 1000).toISOString();

  return {
    packageName: spec.name,
    degraded: spec.degraded ?? false,
    version: spec.version,
    variant,
    tag,
    digest,
    artifactType: manifest.artifactType,
    attrs: spec.attrs ?? {},
    createdAt: spec.createdAt,
    indexedAt,
    size: spec.files.reduce((n, f) => n + f.size, 0),
    fileCount: spec.files.length,
    uploadedBy: spec.degraded ? null : spec.uploadedBy,
    referrers: { signatures: count("signature"), sboms: count("sbom"), attestations: count("attestation") },
    files,
    metadata: spec.metadata,
    annotations,
    manifest,
    referrerList,
    ociReference: `${host}/${spec.format}/${spec.repo}/${nameOci}:${tag}`,
  };
}
