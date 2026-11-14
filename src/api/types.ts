// Types of the /api/v1 JSON the UI reads. Where the server has a resource, its type is the
// server's: src/api/server.gen.ts, generated from the server's openapi.yaml as vendored in
// openapi/server.yaml (npm run update:openapi). The rest are written here: endpoints and fields
// marked "proposed" are not in the server yet; docs/api-proposal.md describes them, and the UI
// shows them only when they are there. Field names follow the index models
// (internal/index/models.go) in camelCase.

import type { Schemas } from "./server.gen";

/** The formats the UI has a spec for (src/lib/formats). */
export type FormatName = "raw" | "pypi" | "apt" | "maven";

/** A repo's format as the server answers it: `oci` repos are the pass-through repos of the
 * OCI facade, which need no plugin and get no format pages. */
export type RepoFormat = FormatName | "oci";

/** What a principal may do on a repo (rbac.md §2). */
export type Action = "read" | "write" | "delete" | "manage";

/** Error envelope of http-routing.md §4. */
export type ApiErrorBody = {
  error: { code: "NOT_FOUND" | "CONFLICT" | "FORBIDDEN" | "INVALID" | "UNAVAILABLE" | string; message: string };
};

/** GET /api/v1/info: the server's build, what snippets are built from, how a person signs in,
 * and the caller. */
export type ServerInfo = Schemas["Info"];

/** The caller as /api/v1/info answers it: who the request's credential is, and whether it
 * reaches the admin role. Without credentials the kind is `anonymous`. */
export type Caller = Schemas["Caller"];

/** GET /api/v1/whoami; without credentials the server answers 401. */
export type WhoAmI = Schemas["Whoami"];

/** repos.policy, with the keys the server reads; an absent key takes its default. */
export type RepoPolicy = Schemas["Policy"];

/** Reindex and reconcile status of a repo (the plan's `reindex: {state, started, done, errors}`). */
export type ReindexStatus = {
  state: "idle" | "running" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  errors: number;
  /** Next scheduled reconcile (reconcile.interval, default 1h); null when disabled. */
  nextReconcileAt: string | null;
};

/** The repo's OpenPGP signing key for apt; retired keys are still served for a while. */
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

/** A repo as GET /api/v1/repos answers it, plus `prefix`, which the UI derives, and the
 * proposed fields of api-proposal.md §3.2 (lajstrom/lajstrom#957). A group has no registry and
 * no policy; a proxy has its upstream, a group its members. */
export type Repo = Schemas["Repo"] & {
  /** <format>/<name>: the repo's path on every protocol and its OCI path below the instance
   * prefix. Not in the answer: src/api/queries.ts derives it. */
  prefix: string;
  /** Proposed: derived counts. */
  stats?: RepoStats;
  /** Proposed: what the caller may do here (rbac.md §2). Absent: the UI offers the actions and
   * the server decides (src/lib/access.ts). */
  permissions?: Action[];
  /** Proposed: reindex and reconcile status. */
  reindex?: ReindexStatus;
  /** Proposed, apt only: current key first, then retired ones. */
  signingKeys?: SigningKey[];
};

/** A directory of a raw repo, for browsing paths like a file tree. */
export type RawDirectory = { name: string; path: string; files: number; size: number; updatedAt: string };

/** One value of a filter facet with its count: suite "jammy" (12). */
export type FacetValue = { value: string; count: number };

/** What api-proposal.md §3.3 adds to a package of the list (lajstrom/lajstrom#955, #957); the
 * server answers name and createdAt only. */
export type PackageFacts = {
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
  /** Format attributes of the latest version without "lajstrom.": deb.suite, maven.packaging, … */
  attrs: Record<string, string>;
  updatedAt: string;
};

/** A row of GET …/packages: the server's, and the proposed facts when the answer has them. */
export type PackageSummary = Schemas["Package"] & Partial<PackageFacts>;

/** GET …/packages: a page ordered by name, with the server's cursor. `facets` and `directories`
 * are proposed (lajstrom/lajstrom#955); an answer with facets takes the proposed filters too. */
export type PackageList = Omit<Schemas["PackageList"], "packages"> & {
  packages: PackageSummary[];
  /** Filter values over the whole repo, by attribute key (deb.suite, deb.component, …). */
  facets?: Record<string, FacetValue[]>;
  /** raw with ?dir=: the subdirectories of dir (packages then holds the files directly in it). */
  directories?: RawDirectory[];
};

/** GET …/packages/{name} (proposed, lajstrom/lajstrom#958); the package page derives it from the
 * versions when the server does not have it (src/pages/package-model.ts). */
export type PackageDetail = Schemas["Package"] &
  PackageFacts & {
    /** <format>/<repo>/<nameOci>, the OCI repository below the instance prefix. */
    ociRepository: string;
    /** The metadata layer of the newest manifest. */
    latestMetadata: Record<string, unknown> | null;
  };

export type ReferrerCounts = { signatures: number; sboms: number; attestations: number };

/** What api-proposal.md §3.4 adds to a variant of the version list; the server answers its tag,
 * digest and publish time only. */
export type VariantFacts = {
  artifactType: string;
  /** The manifest's lajstrom.* annotations by their full key, as VariantDetail has them. */
  attrs: Record<string, string>;
  size: number;
  fileCount: number;
  /** The metadata layer is missing or unreadable: indexed from annotations only. */
  degraded: boolean;
  referrers: ReferrerCounts;
};

export type VariantSummary = Schemas["Variant"] & Partial<VariantFacts>;

/** A version of GET …/packages/{name}/versions, newest first, with its variants. */
export type VersionSummary = Omit<Schemas["Version"], "variants"> & { variants: VariantSummary[] };

export type FileEntry = Schemas["File"];

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

/** One variant of GET …/versions/{version}; the manifest and its annotations are proposed
 * (lajstrom/lajstrom#951): the server reads them from the registry on /v2. */
export type VariantDetail = Schemas["VariantDetail"] & { annotations?: Record<string, string>; manifest?: OciManifest };

/** GET …/packages/{name}/versions/{version}: one version with every variant in detail. */
export type VersionDetail = Omit<Schemas["VersionDetail"], "variants"> & { variants: VariantDetail[] };

/** An attachment of a version: one layer of a referrer of one of its variants, labelled. */
export type Attachment = Schemas["Attachment"];

export type AttachmentList = Schemas["AttachmentList"];

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
  /** Support tier: tested in CI, tested manually, untested. */
  support: "ci" | "manual" | "untested";
  status: { state: "ok" | "degraded" | "down"; checkedAt: string; latencyMs: number | null; message: string | null };
  repos: string[];
};

export type AuditEvent = Schemas["AuditEntry"];

/** A page of the audit log, newest first; `next` is the cursor of the page after it. */
export type AuditList = Schemas["AuditList"];

/** A local user. Whether it is an admin follows from its bindings (rbac.md §3). */
export type User = Schemas["User"];

/** A personal access token or a deploy token (docs/api.md, Tokens). The secret is answered only
 * once, by the creation: CreatedToken. */
export type Token = Schemas["Token"];

export type TokenScope = Token["scopes"][number];

/** The answer of a token creation: the resource and its secret, shown this one time. */
export type CreatedToken = Schemas["CreatedToken"];

/** The body of POST /api/v1/users/{name}/tokens and …/deploy-tokens. */
export type TokenRequest = Schemas["TokenRequest"];

/** A role binding; `principal` is canonical, `user:<uid>` or `group:<name>`, and `name` the
 * user's name now. */
export type Binding = Schemas["Binding"];

/** An open publication session: maven deploys file by file until maven-metadata.xml. */
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

/** GET …/repos/{format}/{repo}/reindex: the latest run that covered the repo. */
export type ReindexRun = Omit<Schemas["ReindexRun"], "report"> & { report: ReindexReport | null };

/** The repo's part of a run's report. The server's openapi.yaml names two of its fields; the
 * others are those docs/api.md shows (Reindex), optional until the description has them. */
export type ReindexReport = NonNullable<Schemas["ReindexRun"]["report"]> & {
  repo?: string;
  ociRepositories?: number;
  manifests?: number;
  added?: number;
  updated?: number;
  unchanged?: number;
  removed?: number;
  pending?: number;
  degraded?: number;
  referrers?: number;
  /** Manifests under the repo's path that Lajstrom did not write: not indexed. */
  foreign?: { repository: string; tag: string; digest: string; mediaType: string }[];
  errors?: unknown[];
  truncated?: boolean;
};
