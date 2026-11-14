// Generated from openapi/server.yaml by scripts/gen-api-types.ts. Do not edit: npm run gen:api.

/** The commit of lajstrom/lajstrom whose /api/v1 these types describe. */
export const serverApiCommit = "a49fac3ec3dfab43067c7e9812d9c968a5834e1e";

/** components.schemas of the server's openapi.yaml; src/api/types.ts names them for the UI. */
export type Schemas = {
  Error: {
    error: {
      code: "NOT_FOUND" | "CONFLICT" | "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID" | "UNAVAILABLE" | "INTERNAL";
      message: string;
    };
  };
  Repo: {
    format: string;
    name: string;
    /** Absent on a group. */
    registry?: string;
    kind: "hosted" | "proxy" | "group";
    anonymousRead: boolean;
    /** Absent on a group. */
    policy?: Schemas["Policy"] | null;
    /** A proxy repo only, with every key; absent on another kind. */
    upstream?: Schemas["Upstream"];
    /**
     * A group only, with members and merge, or members and paths on a group of oci repos; absent on
     * another kind.
     */
    group?: Schemas["Group"];
    createdAt: string;
    updatedAt: string;
  };
  /**
   * A group's settings (docs/spec/proxy-and-group.md §2.3): its members, read in order, and the
   * names a hosted member does not hide; or, on a group of oci repos (§12.1), its members and the
   * routes that send each path to one of them.
   */
  Group: {
    /**
     * Repos of the group's format by name, in order; each hosted or proxy, at most one hosted but
     * in a group of oci repos.
     */
    members: string[];
    /**
     * Name patterns whose versions are merged across members even when the hosted member holds the
     * name; not on a group of oci repos.
     */
    merge?: string[];
    /**
     * A group of oci repos only, required there: each member's name to the patterns of the paths it
     * serves, "<path>", "<prefix>/*" or "*". Every member has one at least, no pattern is on two
     * members, 256 in all at most; the most specific pattern that matches a path routes it.
     */
    paths?: Record<string, string[]>;
  };
  /**
   * A proxy repo's settings (docs/spec/proxy-and-group.md §2.2). The upstream is named as the
   * configuration names it (upstreams[].name); its URL and credentials are configuration and never
   * part of the API. Absent keys take their defaults.
   */
  Upstream: {
    /** One of upstreams[].name of the repo's format. */
    name: string;
    /** How long a cached document is used, a duration from 0s to 168h; default 10m. */
    metadataTTL?: string;
    /** How long a name the upstream does not have is remembered, 0s to 24h; default 2m. */
    negativeTTL?: string;
    /** Never ask the upstream; default false. */
    offline?: boolean;
    /** Name patterns, * matching any run: a name is fetched when one matches; empty, every name. */
    allow?: string[];
    /** Name patterns that are never fetched; deny wins over allow. */
    deny?: string[];
  };
  /**
   * The policy of a repo: the keys the server reads, with their defaults when absent (maxFileSize
   * by format: npm 512 MiB, pypi and maven 4 GiB, apt and raw 8 GiB, oci 16 GiB; blobRedirect auto,
   * maven.sessionTimeout 30m, maven.maxSessionFiles 256, maven.versionPolicy release). Any other
   * key is 400.
   */
  Policy: {
    /**
     * The largest file an upload, or a /v2 blob, may carry, in bytes; on every repo, oci included.
     */
    maxFileSize?: number;
    blobRedirect?: "auto" | "never";
    /** A maven repo only. */
    maven?: {
      /** How long a publication session lives after its last request, a duration from 1m to 24h. */
      sessionTimeout?: string;
      /**
       * How many files a publication session of a deploy stores, signatures included, checksum
       * files and maven-metadata.xml not; the next is 400.
       */
      maxSessionFiles?: number;
      /**
       * Which versions a deploy may add: release versions, or the builds of SNAPSHOT versions, each
       * deploy one more build under its own tag. The other kind is 400; a change applies to the
       * deploys after it.
       */
      versionPolicy?: "release" | "snapshot";
    };
  };
  /**
   * An RFC 7396 merge patch of the policy: a member sets its key, null removes it, maven merges key
   * by key. The policy that results is checked as a whole.
   */
  PolicyPatch: {
    maxFileSize?: number | null;
    blobRedirect?: "auto" | "never" | null;
    maven?: {
      sessionTimeout?: string | null;
      maxSessionFiles?: number | null;
      versionPolicy?: "release" | "snapshot" | null;
    } | null;
  };
  RepoList: {
    repos: Schemas["Repo"][];
  };
  CreateRepo: {
    format: string;
    name: string;
    /** Required but on a group */
    registry?: string;
    kind?: "hosted" | "proxy" | "group";
    anonymousRead?: boolean;
    /** None on a group. */
    policy?: Schemas["Policy"] | null;
    /** Required on a proxy repo, refused on another kind. */
    upstream?: Schemas["Upstream"] | null;
    /** Required on a group, refused on another kind. */
    group?: Schemas["Group"] | null;
  };
  RepoPatch: {
    anonymousRead?: boolean;
    policy?: Schemas["PolicyPatch"] | null;
    /**
     * A proxy repo only: an RFC 7396 merge patch of its settings (the keys of Upstream), checked
     * whole after the merge; allow and deny are replaced whole. Changing name needs the admin role
     * and drops the repo's cache of the old upstream; the name the repo has, sent back, is no
     * change. The other keys need manage.
     */
    upstream?: Record<string, unknown>;
    /**
     * A group only: an RFC 7396 merge patch of its settings (the keys of Group), checked whole
     * after the merge; each list is replaced whole, and a key of paths set to null is removed.
     * Changing members, their order included, or paths needs the admin role; the members and paths
     * the group has, sent back, are no change. merge needs manage.
     */
    group?: Record<string, unknown>;
    /**
     * Alone in the body, by the admin role: a proxy becomes a hosted repo that keeps what it holds,
     * its dist-tags and deprecations written to its journal; 409 while a fetch runs or when a group
     * of it has a hosted member. On a hosted repo it resumes a conversion that stopped half way,
     * else changes nothing.
     */
    kind?: "hosted";
  };
  ReindexRequest: {
    prune?: boolean;
    verify?: boolean;
  };
  ReindexRun: {
    id: number;
    state: string;
    source: string;
    principal: string;
    replica: string;
    allRepos: boolean;
    prune: boolean;
    verify: boolean;
    startedAt: string;
    heartbeatAt: string;
    finishedAt: string | null;
    error?: string;
    /**
     * The repo's part of the run's report; null while the run is running, and for a run of every
     * repo that stopped before it reached the repo.
     */
    report: {
      /**
       * The tags the registry still lists whose manifests were deleted through Lajstrom less than
       * reconcile.graceAge before the run, on a registry not classified strong: not indexed again.
       * Absent from the report of a run of a release before it.
       */
      deletedPending?: number;
      /**
       * The sha256-<hex> indexes that lacked referrers the audit log has as pushed and the registry
       * still has, or were missing, and that Lajstrom pushed again with them: runs of the reconcile
       * loop and with verify, on a registry without the referrers API. null in the report of a run
       * of a release before it.
       */
      repairedReferrers?: Schemas["RepairedReferrersIndex"][] | null;
    } | null;
  };
  /**
   * A subject's sha256-<hex> index that a reindex run pushed again with the referrers it lacked.
   */
  RepairedReferrersIndex: {
    /** The OCI repository of the subject */
    repository: string;
    subject: string;
    /** The digest of the index pushed. */
    index: string;
    /** The referrers it lacked, in the order of their pushes. */
    added: string[];
  };
  Token: {
    id: number;
    kind: "pat" | "deploy";
    /** The owner of a personal access token. */
    user?: string;
    /** The <format>/<name> of a deploy token. */
    repo?: string;
    name: string;
    scopes: ("read" | "write")[];
    expiresAt: string | null;
    lastUsedAt: string | null;
    createdAt: string;
    revokedAt: string | null;
    hashPrefix: string;
  };
  CreatedToken: Schemas["Token"] & {
    /** Shown this once. */
    secret: string;
  };
  TokenList: {
    tokens: Schemas["Token"][];
  };
  TokenRequest: {
    name: string;
    scopes?: ("read" | "write")[];
    expiresAt?: string;
    /** A number of days (30d) or a duration (12h). */
    expiresIn?: string;
  };
  User: {
    uid: string;
    name: string;
    kind: "local";
    disabled: boolean;
    createdAt: string;
  };
  UserList: {
    users: Schemas["User"][];
    next?: string;
  };
  UserRequest: {
    name: string;
    password: Schemas["Password"];
    admin?: boolean;
  };
  BootstrapRequest: {
    token: string;
    name: string;
    password: Schemas["Password"];
  };
  UserPatch: {
    name?: string;
    disabled?: boolean;
  };
  PasswordRequest: {
    password: Schemas["Password"];
  };
  /**
   * A password of 8 to 1024 bytes of UTF-8; the server counts bytes, and the lengths here count
   * characters.
   */
  Password: string;
  Binding: {
    id: number;
    /** user:<uid>, or group:<name> (docs/spec/rbac.md §8). */
    principal: string;
    /** The user's name now; absent for a group. */
    name?: string;
    role: "reader" | "writer" | "maintainer" | "admin";
    repoMask: string;
    createdAt: string;
  };
  BindingList: {
    bindings: Schemas["Binding"][];
    next?: string;
  };
  BindingRequest: {
    /**
     * user:<name>, user:<uid>, or group:<name>, which need not have members (docs/spec/rbac.md §8).
     */
    principal: string;
    role: "reader" | "writer" | "maintainer" | "admin";
    repoMask: string;
  };
  AuditEntry: {
    id: number;
    at: string;
    principal: string;
    principalName?: string;
    action: string;
    repo?: string;
    subject?: string;
    digest?: string;
    ip?: string;
    details?: Record<string, unknown>;
    state: "ok" | "pending" | "failed" | "unknown";
    /** Why a failed row failed. */
    error?: string;
  };
  AuditList: {
    events: Schemas["AuditEntry"][];
    next?: string;
  };
  Package: {
    /** The name in the format's spelling. */
    name: string;
    /** The publish time of its first version. */
    createdAt: string;
  };
  PackageList: {
    packages: Schemas["Package"][];
    next?: string;
  };
  Version: {
    version: string;
    /** The publish time of its first variant, from the manifest; the order of the list. */
    publishedAt: string;
    /**
     * The publish time of its newest variant, which If-Unmodified-Since and the cut-off compare.
     */
    lastModified: string;
    variants: Schemas["Variant"][];
    /** What names the version and moves; a conditional delete refuses it unless forced. */
    pointers: Schemas["Pointer"][];
    yanked?: Schemas["Yank"];
  };
  /** The yank of a pypi version (PEP 592); absent when the version is not yanked. */
  Yank: {
    /** Empty when the yank gave none. */
    reason: string;
  };
  /** The optional body of a yank. */
  YankRequest: {
    /** Why the version is yanked, at most 4096 bytes of UTF-8; absent, null or empty for none. */
    reason?: string | null;
  };
  Variant: {
    /** Empty for a format without variants. */
    variant: string;
    tag: string;
    /** The manifest digest */
    digest: string;
    publishedAt: string;
  };
  Pointer: {
    kind: "dist-tag";
    name: string;
  };
  /** One version: its row of the version list, its variants in detail and its OCI repository. */
  VersionDetail: {
    version: string;
    /** The publish time of its first variant, whatever variant keeps. */
    publishedAt: string;
    /** The publish time of its newest variant, whatever variant keeps. */
    lastModified: string;
    variants: Schemas["VariantDetail"][];
    pointers: Schemas["Pointer"][];
    yanked?: Schemas["Yank"];
    /** <format>/<repo>/<package path>, the repository of its manifests on /v2. */
    ociRepository: string;
  };
  /** The attachments of a version, newest first. */
  AttachmentList: {
    attachments: Schemas["Attachment"][];
    /** There are more attachments than the limit; the oldest are left out. */
    truncated: boolean;
  };
  /**
   * One attachment of a version: one layer of a referrer of one of its variants, with its label
   * (docs/spec/manifest-profile.md §6).
   */
  Attachment: {
    /** Empty for a format without variants. */
    variant: string;
    /** The variant's manifest digest. */
    subject: string;
    /** The referrer manifest's digest. */
    digest: string;
    /**
     * cosign's legacy tag, sha256-<hex>.sig, .att or .sbom; absent for a referrer pushed by digest.
     */
    tag?: string;
    /** The digest of the attachment's layer; empty for a manifest without layers. */
    layer: string;
    /** The layer's media type. */
    mediaType: string;
    /** The referrer's artifactType */
    artifactType: string;
    /** What it is; a value this list does not name is shown as it is. */
    kind: "signature" | "sbom" | "scan" | "provenance" | "attestation" | "other";
    /** The predicate type of its statement or cosign's annotation; empty when none. */
    predicateType: string;
    /** The layer's size. */
    size: number;
    /** The referrer manifest's annotations. */
    annotations: Record<string, string>;
    /** lajstrom.attachment.tool */
    tool?: string;
    /** lajstrom.attachment.toolVersion */
    toolVersion?: string;
    /** lajstrom.attachment.database */
    database?: string;
    /** lajstrom.attachment.input */
    input?: string;
    /**
     * verified (a trusted key signed it, for its predicate type, and what it signed names the
     * variant), untrusted, unsigned, invalid or unsupported (keyless, notation, a message
     * signature, a layer above attachments.maxBlobSize).
     */
    verification: "verified" | "untrusted" | "unsigned" | "invalid" | "unsupported";
    /** The name of the trust entry whose key verified it. */
    signedBy?: string;
    /** Why it is not verified. */
    reason?: string;
    /** The referrer's org.opencontainers.image.created */
    createdAt?: string;
    /** When ingest or reindex last wrote or saw the row. */
    indexedAt: string;
  };
  /** One manifest of a version, with its row of the index and its files. */
  VariantDetail: {
    /** Empty for a format without variants. */
    variant: string;
    tag: string;
    /** The manifest digest. */
    digest: string;
    publishedAt: string;
    artifactType: string;
    /** The manifest's lajstrom.* annotations by their full key. */
    attrs: Record<string, string>;
    /** The metadata layer; null when there is none or it was too large to keep. */
    metadata: Record<string, unknown> | null;
    /** The row came from the annotations alone. */
    degraded: boolean;
    /** When ingest or reindex last wrote or saw the row. */
    indexedAt: string;
    /** The file layers, in manifest order. */
    files: Schemas["File"][];
  };
  /** One file layer of a manifest. */
  File: {
    name: string;
    mediaType: string;
    digest: string;
    size: number;
    /** The layer's annotations. */
    attrs: Record<string, string>;
  };
  VersionList: {
    versions: Schemas["Version"][];
    next?: string;
  };
  BatchDeleteRequest: {
    items: Schemas["BatchDeleteItem"][];
    /** A version published after it is not deleted (young). */
    cutoff?: string;
    /** Check every item and delete nothing; deleted then means it would be. */
    dryRun?: boolean;
    /** The job id for the audit rows; a new one when absent. */
    job?: string;
  };
  BatchDeleteItem: {
    /** The name in the format's spelling. */
    package: string;
    version: string;
    /** The digests of every variant of the version, as the client read them. */
    digests: string[];
  };
  BatchDeleteResult: {
    /** In details.job of every audit row of the batch. */
    job: string;
    dryRun: boolean;
    results: Schemas["BatchDeleteItemResult"][];
  };
  BatchDeleteItemResult: {
    package: string;
    version: string;
    status: "deleted" | "changed" | "protected" | "young" | "gone" | "error";
    /** Why */
    message?: string;
    /** The digests of the version now, for changed. */
    digests?: string[];
    /** The publish time of its newest variant, for young. */
    lastModified?: string;
    /** What names the version, for protected. */
    pointers?: Schemas["Pointer"][];
  };
  /** names and allVersions of a format's proxy repo; images and platforms of an oci one. */
  PrefetchRequest: {
    /** Package names in the format's spelling. */
    names?: string[];
    /**
     * Every version the upstream lists; without it the versions its pointers name (npm's
     * dist-tags), or the newest when they name none.
     */
    allVersions?: boolean;
    /**
     * References below an oci proxy repo, <path>[:<tag>][@<digest>]: latest without a tag or a
     * digest, the digest when both are given.
     */
    images?: string[];
    /**
     * The platforms of an index to fetch, os/architecture[/variant]; required for a reference that
     * names an index, not used for one that names a manifest.
     */
    platforms?: string[];
  };
  PrefetchResult: {
    results: Schemas["PrefetchItemResult"][];
  };
  PrefetchItemResult: {
    name: string;
    /** Absent for a name that failed before its versions. */
    version?: string;
    variant?: string;
    /**
     * fetched by this request; held already; shared, fetched meanwhile by another request or
     * replica; failed.
     */
    status: "fetched" | "held" | "shared" | "failed";
    /** For failed, the status a request of the file would have had. */
    httpStatus?: number;
    /** Why */
    message?: string;
    /**
     * Of an oci repo: what a reference names, an index or a manifest; a platform's manifest; a
     * blob. Absent for an image that failed before what it names was known.
     */
    kind?: "index" | "manifest" | "blob";
    /** Of an oci repo */
    platform?: string;
    /** Of an oci repo */
    digest?: string;
    /** Of an oci repo, what the request got from the upstream; a manifest's with its blobs. */
    bytes?: number;
    /** For a failed 503, when to ask again, in seconds. */
    retryAfter?: number;
  };
  Whoami: {
    principal: string;
    kind: "user" | "token";
    name: string;
    uid?: string;
    /** A user's groups that count now, from its latest OIDC login (docs/spec/rbac.md §8). */
    groups?: string[];
  };
  /** What a client needs before it signs in, and the caller. */
  Info: {
    /** The release version; dev for an unversioned build. */
    version: string;
    /** The short commit hash; empty when unknown. */
    commit: string;
    /** The build time in RFC 3339; empty when unknown. */
    date: string;
    /** server.externalURL; empty on the dev stack when it leaves it empty. */
    externalURL: string;
    /** auth.anonymousRead, the server-wide switch. */
    anonymousRead: boolean;
    /** The format plugins the server serves, by name; oci repos need none. */
    formats: Schemas["FormatInfo"][];
    /** How a person signs in; the OIDC login adds oidc. */
    authModes: ("password" | "token" | "oidc")[];
    caller: Schemas["Caller"];
  };
  /** A format plugin the server serves, and the artifact type of its manifests. */
  FormatInfo: {
    name: string;
    artifactType: string;
  };
  /**
   * The request's principal as whoami answers it, or anonymous, and whether its credential reaches
   * the admin role.
   */
  Caller: {
    principal: string;
    kind: "user" | "token" | "anonymous";
    name: string;
    uid?: string;
    /** Whether the request's credential reaches the admin role. */
    admin: boolean;
  };
};
