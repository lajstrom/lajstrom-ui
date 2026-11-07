// Types of the /api/v1 JSON the UI reads. Endpoints marked "proposed" are not in
// docs/spec/http-routing.md §4 yet; docs/api-proposal.md describes them for the `contract`
// issue. Field names follow the index models (internal/index/models.go) in camelCase.

export type FormatName = "raw" | "pypi" | "apt" | "maven";

/** Error envelope of http-routing.md §4. */
export type ApiErrorBody = {
  error: { code: "NOT_FOUND" | "CONFLICT" | "FORBIDDEN" | "INVALID" | "UNAVAILABLE" | string; message: string };
};

/** GET /api/v1/info (proposed): what the UI needs to know about the server. */
export type ServerInfo = {
  version: string;
  commit: string;
  date: string;
  /** server.externalURL; snippets are built from it. */
  externalURL: string;
  /** auth.anonymousRead, the server-wide switch. */
  anonymousRead: boolean;
  formats: { name: FormatName; artifactType: string }[];
};

/** Who is calling: GET /api/v1/whoami. */
export type WhoAmI = {
  principal: string; // user:alice, token:12, anonymous
  kind: "user" | "token" | "group" | "anonymous";
  name: string;
  admin: boolean;
  bindings: Binding[];
};

/** repos.policy (M3-09). PATCH merges. The key of the session expiry policy is not named in the
 * plan yet; "maven.sessionExpiry" is this prototype's proposal. */
export type RepoPolicy = {
  maxFileSize?: number;
  blobRedirect?: "auto" | "never";
  "maven.sessionTimeout"?: string;
  "maven.sessionExpiry"?: "seal" | "abort";
};

/** Reindex and reconcile status of a repo (M1-06 `reindex: {state, started, done, errors}`, M1-07). */
export type ReindexStatus = {
  state: "idle" | "running" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  errors: number;
  /** Next scheduled reconcile (reconcile.interval, default 1h); null when disabled. */
  nextReconcileAt: string | null;
};

/** The repo's OpenPGP signing key for apt (M2-03); retired keys are still served for a while. */
export type SigningKey = {
  algorithm: "ed25519" | "rsa4096";
  fingerprint: string;
  createdAt: string;
  retiredAt: string | null;
};

export type RepoStats = {
  packages: number;
  /** Distinct (package, version) pairs. */
  versions: number;
  /** Manifests: one per (package, version, variant). */
  manifests: number;
  files: number;
  size: number;
  lastPushAt: string | null;
};

/** A repo (control plane, index-schema.md `repos`) plus derived stats. */
export type Repo = {
  format: FormatName;
  name: string;
  kind: "hosted" | "proxy" | "group";
  registry: string;
  /** OCI path below the instance prefix: <format>/<name>. */
  prefix: string;
  anonymousRead: boolean;
  policy: RepoPolicy;
  createdAt: string;
  updatedAt: string;
  stats: RepoStats;
  /** What the caller may do here (rbac.md §2); drives which actions the UI shows. */
  permissions: ("read" | "write" | "delete" | "manage")[];
  reindex: ReindexStatus;
  /** apt only: current key first, then retired ones. */
  signingKeys?: SigningKey[];
};

/** Cursor pagination of M2-09: pass `next` or `prev` back as `cursor`. */
export type Page = {
  total: number;
  limit: number;
  next: string | null;
  prev: string | null;
};

/** A directory of a raw repo, for browsing paths like a file tree. */
export type RawDirectory = { name: string; path: string; files: number; size: number; updatedAt: string };

/** One value of a filter facet with its count: suite "jammy" (12). */
export type FacetValue = { value: string; count: number };

/** A row of GET /api/v1/repos/{format}/{repo}/packages (proposed). */
export type PackageSummary = {
  /** lajstrom.name, the format's spelling: nginx, Requests, com.example:lib-core, docs/readme.md */
  name: string;
  /** Escaped package path (Plugin.EscapeName). */
  nameOci: string;
  latestVersion: string | null;
  /** Distinct versions. */
  versions: number;
  /** Manifests (versions × variants). */
  manifests: number;
  /** Variants of the latest version: amd64, arm64; py3-none-any, sdist. */
  latestVariants: string[];
  size: number;
  /** One line from the metadata layer: pypi summary, deb description, maven name. */
  summary: string | null;
  /** Format attributes of the latest version: deb.suite, maven.packaging, … */
  attrs: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type PackageList = Page & {
  packages: PackageSummary[];
  /** Filter values over the whole repo, by attribute key (deb.suite, deb.component, …). */
  facets: Record<string, FacetValue[]>;
  /** raw with ?dir=: the subdirectories of dir (packages then holds the files directly in it). */
  directories?: RawDirectory[];
};

/** GET /api/v1/repos/{format}/{repo}/packages/{name} (proposed). */
export type PackageDetail = PackageSummary & {
  /** <format>/<repo>/<nameOci>, the OCI repository below the instance prefix. */
  ociRepository: string;
  /** The metadata layer of the newest manifest. */
  latestMetadata: Record<string, unknown> | null;
};

export type ReferrerCounts = { signatures: number; sboms: number; attestations: number };

/** A row of GET …/packages/{name}/versions (proposed): one manifest. */
export type VersionSummary = {
  /** The metadata layer is missing or unreadable; reindex kept the row from annotations only. */
  degraded: boolean;
  version: string;
  variant: string;
  tag: string;
  digest: string;
  artifactType: string;
  /** lajstrom.<format>.* annotations without the prefix: deb.arch, deb.suite, … */
  attrs: Record<string, string>;
  createdAt: string;
  indexedAt: string;
  size: number;
  fileCount: number;
  uploadedBy: string | null;
  referrers: ReferrerCounts;
};

export type FileEntry = {
  name: string;
  mediaType: string;
  digest: string;
  size: number;
  attrs: Record<string, string>;
  /** Protocol URL to download the file, relative to externalURL. */
  path: string;
};

export type Referrer = {
  digest: string;
  artifactType: string;
  kind: "signature" | "sbom" | "attestation" | "other";
  /** cosign, notation, syft, …: who made it, when the annotations say so. */
  tool: string | null;
  size: number;
  createdAt: string | null;
  annotations: Record<string, string>;
};

export type OciDescriptor = {
  mediaType: string;
  digest: string;
  size: number;
  annotations?: Record<string, string>;
};

export type OciManifest = {
  schemaVersion: 2;
  mediaType: string;
  artifactType: string;
  config: OciDescriptor;
  layers: OciDescriptor[];
  annotations: Record<string, string>;
};

/** GET …/packages/{name}/versions/{digest} (proposed): one manifest in full. */
export type VersionDetail = VersionSummary & {
  files: FileEntry[];
  metadata: Record<string, unknown> | null;
  annotations: Record<string, string>;
  manifest: OciManifest;
  referrerList: Referrer[];
  /** Without the instance prefix and scheme: host/pypi/internal/requests:2.32.3__py3-none-any */
  ociReference: string;
};

export type SearchHit =
  | {
      kind: "package";
      format: FormatName;
      repo: string;
      name: string;
      latestVersion: string | null;
      summary: string | null;
      updatedAt: string;
    }
  | {
      kind: "version";
      format: FormatName;
      repo: string;
      name: string;
      version: string;
      variant: string;
      digest: string;
      /** What matched: "manifest" or the file name whose layer digest matched. */
      matched: string;
    };

/** GET /api/v1/search?q= (proposed). A sha256 digest finds manifests and files. */
export type SearchResult = { hits: SearchHit[]; total: number };

/** provider.Capabilities (internal/provider/provider.go). */
export type Capabilities = {
  createOnPush: boolean;
  referrers: boolean;
  catalog: boolean;
  deleteManifest: boolean;
  immutableTags: boolean;
  blobRedirect: boolean;
  maxBlobSize: number;
};

/** GET /api/v1/registries (proposed; system resource, admin only). */
export type Registry = {
  name: string;
  type: "generic" | "ecr";
  /** Detected product, from the spike results (docs/registries/). */
  product: string;
  url: string;
  prefix: string;
  capabilities: Capabilities;
  /** Support tier of M1-12: tested in CI, tested manually, untested. */
  support: "ci" | "manual" | "untested";
  status: { state: "ok" | "degraded" | "down"; checkedAt: string; latencyMs: number | null; message: string | null };
  repos: string[];
};

export type AuditEvent = {
  id: number;
  at: string;
  principal: string;
  action: string;
  repo: string;
  subject: string;
  digest: string | null;
  ip: string;
  details: Record<string, unknown>;
};

export type AuditPage = Page & { events: AuditEvent[] };

export type User = {
  name: string;
  kind: "local" | "oidc";
  disabled: boolean;
  admin: boolean;
  createdAt: string;
  lastSeenAt: string | null;
};

export type Token = {
  id: number;
  kind: "pat" | "deploy";
  name: string;
  /** Owner of a PAT. */
  user: string | null;
  /** <format>/<repo> of a deploy token. */
  repo: string | null;
  scopes: ("read" | "write")[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
};

export type Binding = {
  id: number;
  principal: string;
  role: "reader" | "writer" | "maintainer" | "admin";
  repoMask: string;
  createdAt: string;
};

/** An open publication session (M3-02): maven deploys file by file until maven-metadata.xml. */
export type PublishSession = {
  id: number;
  key: string; // g:a:v
  principal: string;
  state: "open" | "committed" | "aborted" | "expired";
  files: { name: string; size: number; digest: string }[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

/** The report of `lajstrom reindex --report` / POST …/reindex (M1-06). The plan names no
 * fields; these are the prototype's proposal. */
export type ReindexReport = {
  repo: string;
  startedAt: string;
  finishedAt: string;
  ociRepositories: number;
  manifests: number;
  added: number;
  updated: number;
  removed: number;
  degraded: number;
  foreign: { path: string; tag: string; digest: string; reason: string }[];
};
