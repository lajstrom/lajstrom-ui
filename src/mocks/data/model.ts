// How the mock keeps a manifest of a package: one row per (version, variant), with what the
// prototype's API answered about it. src/mocks/db.ts turns rows into the server's shapes.

/** A descriptor of the OCI image spec. */
export type OciDescriptor = {
  mediaType: string;
  digest: string;
  size: number;
  annotations?: Record<string, string>;
};

/** An OCI image manifest as manifest-profile.md §2 makes it: an artifact, its file layers. */
export type OciManifest = {
  schemaVersion: 2;
  mediaType: string;
  artifactType: string;
  config: OciDescriptor;
  layers: OciDescriptor[];
  annotations: Record<string, string>;
};

/** A file layer. */
export type MockFile = {
  name: string;
  mediaType: string;
  digest: string;
  size: number;
  attrs: Record<string, string>;
};

/** An OCI referrer of the manifest: a signature, an SBOM or an attestation. */
export type MockReferrer = {
  digest: string;
  artifactType: string;
  kind: "signature" | "sbom" | "attestation" | "other";
  /** cosign, notation, syft, …: who made it, when the annotations say so. */
  tool: string | null;
  size: number;
  createdAt: string | null;
  annotations: Record<string, string>;
};

export type MockVersion = {
  /** The metadata layer is missing or unreadable: indexed from annotations only. */
  degraded: boolean;
  version: string;
  variant: string;
  tag: string;
  digest: string;
  artifactType: string;
  /** lajstrom.<format>.* annotations without the "lajstrom." prefix: deb.arch, deb.suite, … */
  attrs: Record<string, string>;
  createdAt: string;
  indexedAt: string;
  size: number;
  fileCount: number;
  uploadedBy: string | null;
  files: MockFile[];
  metadata: Record<string, unknown> | null;
  annotations: Record<string, string>;
  manifest: OciManifest;
  referrerList: MockReferrer[];
  /** Without the instance prefix and scheme: host/pypi/internal/requests:2.32.3__py3-none-any */
  ociReference: string;
};
