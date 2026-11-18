// Generated from public/openapi.yaml by scripts/gen-api-types.ts. Do not edit: npm run gen:api.

/** The commit of lajstrom/lajstrom whose /api/v1 these types describe. */
export const serverApiCommit = "1ddd24017dbd2153ae3aa866525f586cc50101b4";

/**
 * components.schemas of the server's openapi.yaml with the UI's proposal; what the proposal adds
 * starts with "Proposed:". src/api/types.ts names them for the UI.
 */
export type Schemas = {
  /**
   * Why: a ticket or a sentence, the reference of the change's approval, 1 to 1024 bytes of UTF-8
   * without control characters (docs/spec/rbac.md §13), kept in the change's audit row as
   * details.changeReason. Required with auth.requireReason, which GET /api/v1/info answers as
   * requireReason; a person's own credentials take one and never need it.
   */
  ChangeReason: string;
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
    /**
     * Answered by GET only: of read, write, delete and manage, those the request's principal has on
     * the repo within the scopes of its credential (docs/spec/rbac.md §3), in that order.
     */
    permissions?: ("read" | "write" | "delete" | "manage")[];
    /** Answered by GET only; absent on a group and an oci repo, which index no versions. */
    stats?: Schemas["RepoStats"];
    /**
     * Answered by GET only, on an apt or rpm repo: its signing keys, the active one first, then the
     * retired ones, the most recently retired first; [] before its first key.
     */
    signingKeys?: Schemas["SigningKey"][];
  };
  /** Counts of the index's rows of a repo (docs/api.md, Repos); reindex rebuilds them. */
  RepoStats: {
    packages: number;
    /** Distinct versions of its packages. */
    versions: number;
    /** One per variant of a version. */
    manifests: number;
    /** The file layers of its manifests. */
    files: number;
    /**
     * The sum of their sizes in bytes: a blob of two manifests counts twice, the metadata layer not
     * at all.
     */
    size: number;
    /** The newest publish time of its manifests. */
    lastPublishedAt: string | null;
  };
  /** The public facts of a repo's OpenPGP signing key. */
  SigningKey: {
    /** Uppercase hexadecimal. */
    fingerprint: string;
    /**
     * ed25519 or rsa4096 for a key made by Lajstrom; rsa2048, rsa3072, rsa4096 or ecdsa-p256 for
     * one in a KMS.
     */
    algorithm: string;
    createdAt: string;
    /** Null for the active key. */
    retiredAt: string | null;
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
   * encryption.mode none, maven.sessionTimeout 30m, maven.maxSessionFiles 256, maven.versionPolicy
   * release). Any other key is 400.
   */
  Policy: {
    /**
     * The largest file an upload, or a /v2 blob, may carry, in bytes; on every repo, oci included.
     */
    maxFileSize?: number;
    blobRedirect?: "auto" | "never";
    /**
     * Whether the repo keeps its files encrypted in the registry (ADR 0009). at-rest needs at least
     * one recipient, the recovery recipient, and is refused on an oci repo and on a server without
     * the master key; a change applies to the files stored after it.
     */
    encryption?: {
      mode: "none" | "at-rest";
      /**
       * The key URI of an RSA decryption key in a KMS that the repo's next key is, or empty for one
       * Lajstrom makes.
       */
      key?: string;
      /**
       * PEM public keys (RSA of 2048 bits or more, EC P-256, P-384, P-521) every new data key is
       * wrapped for too; at least one with at-rest.
       */
      recipients?: string[];
    };
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
    encryption?: {
      mode?: "none" | "at-rest" | null;
      key?: string | null;
      recipients?: string[] | null;
    } | null;
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
    /** Required but on a group, which has none. */
    registry?: string;
    kind?: "hosted" | "proxy" | "group";
    anonymousRead?: boolean;
    /** None on a group. */
    policy?: Schemas["Policy"] | null;
    /** Required on a proxy repo, refused on another kind. */
    upstream?: Schemas["Upstream"] | null;
    /** Required on a group, refused on another kind. */
    group?: Schemas["Group"] | null;
    changeReason?: Schemas["ChangeReason"];
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
    changeReason?: Schemas["ChangeReason"];
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
     * repo that stopped before it reached the repo. Each list holds at most 1000 entries, after
     * which truncated is true; the counts stay exact. In the report of a run of an earlier release,
     * a count it did not write is 0 and a list it did not write null.
     */
    report: {
      /** The repo, <format>/<name>. */
      repo: string;
      /** The OCI repositories under the repo's path. */
      ociRepositories: number;
      /** The tags read. */
      manifests: number;
      /** The rows written, of versions and journal entries, that the index did not have. */
      added: number;
      /** The rows read again, with verify or degraded, and written. */
      updated: number;
      /** The rows seen with the digest the index has. */
      unchanged: number;
      /** The rows removed, their manifests gone from the registry (prune). */
      removed: number;
      /**
       * The rows whose manifest the registry answered unknown (prune), kept until it answers so
       * twice at least 10 minutes apart and the row is reconcile.graceAge old
       * (docs/spec/guarantees.md, INV-5).
       */
      pending: number;
      /**
       * The tags the registry still lists whose manifests were deleted through Lajstrom less than
       * reconcile.graceAge before the run, on a registry not classified strong: not indexed again.
       */
      deletedPending: number;
      /** The versions written from their annotations, their metadata layer unreadable. */
      degraded: number;
      /** The referrers listed, each digest once. */
      referrers: number;
      /** The attachment rows of the versions seen or written. */
      attachments: number;
      /**
       * The manifests under the repo's path that are not Lajstrom's: never indexed, never served.
       */
      foreign: Schemas["ReindexFinding"][];
      /** The referrers whose subject no version has. */
      orphanReferrers: Schemas["ReindexFinding"][];
      /**
       * The npm and pypi journal entries of an OCI repository without versions
       * (docs/spec/manifest-profile.md §8): not indexed, adopted by the next append to the package.
       */
      orphanJournal: Schemas["ReindexFinding"][] | null;
      /** The tags that name another digest in the registry than in the index. */
      drift: Schemas["ReindexDrift"][];
      /** The packages found at two forms of their OCI name (ADR 0017), one entry per other form. */
      split: Schemas["ReindexSplit"][] | null;
      /**
       * The versions of the index whose OCI repository the registry does not know: prune keeps
       * their rows, a delete through the API removes them.
       */
      repositoryUnknown: Schemas["ReindexRepositoryUnknown"][] | null;
      /**
       * The sha256-<hex> indexes that lacked referrers the audit log has as pushed and the registry
       * still has, or were missing, and that Lajstrom pushed again with them: runs of the reconcile
       * loop and with verify, on a registry without the referrers API.
       */
      repairedReferrers: Schemas["RepairedReferrersIndex"][] | null;
      /** The rows of blob_map of an encrypted repo written or seen. */
      blobMap: number;
      /**
       * Why the run skipped the repo whole, an encrypted repo whose keys do not open (no master
       * key, a seal that does not open); empty otherwise.
       */
      skipped: string;
      /** What the run could not read, check or write, each with its error. */
      errors: Schemas["ReindexFinding"][];
      /** A list stopped at 1000 entries. */
      truncated: boolean;
    } | null;
  };
  /**
   * A subject's sha256-<hex> index that a reindex run pushed again with the referrers it lacked.
   */
  RepairedReferrersIndex: {
    /** The OCI repository of the subject, below the repo's base. */
    repository: string;
    subject: string;
    /** The digest of the index pushed. */
    index: string;
    /** The referrers it lacked, in the order of their pushes. */
    added: string[];
  };
  /** A manifest, or a failure, that a reindex report lists; a key without a value is left out. */
  ReindexFinding: {
    /** The OCI repository, below the repo's base; empty for a failure of the whole repo. */
    repository: string;
    tag?: string;
    digest?: string;
    mediaType?: string;
    artifactType?: string;
    /** The digest of a referrer's subject. */
    subject?: string;
    /** What failed (errors). */
    error?: string;
  };
  /**
   * A tag that names another digest in the registry than in the index; the index keeps its digest.
   */
  ReindexDrift: {
    package: string;
    tag: string;
    /** The digest the index has. */
    index: string;
    /** The digest the registry's tag names. */
    registry: string;
  };
  /**
   * A package whose manifests are at two forms of its OCI name (ADR 0017): the index has the
   * package at indexed; a run copies or moves nothing in the registry.
   */
  ReindexSplit: {
    package: string;
    /** The package's OCI name in the index, below the repo's base. */
    indexed: string;
    /** The tags of its versions in the index. */
    indexedTags: string[];
    /** The other form, below the repo's base. */
    other: string;
    /** The tags of the profile manifests at the other form. */
    otherTags: string[];
  };
  /**
   * A version of the index whose OCI repository the registry does not know: its tag does not
   * resolve, its manifest by digest and the repository's tag list are a 404 without
   * MANIFEST_UNKNOWN. The row stays until it is deleted through the API or the repository comes
   * back; a run deletes nothing in the registry.
   */
  ReindexRepositoryUnknown: {
    /** The OCI repository, below the repo's base. */
    repository: string;
    package: string;
    version: string;
    /** The variant of a version with variants. */
    variant?: string;
    tag: string;
    digest: string;
    /**
     * The request that deletes the version's rows, the variant alone when it has one: DELETE
     * /api/v1/repos/<format>/<name>/packages/<package>/versions/<version>, with ?variant=<variant>
     * for a variant, the package and the version path-escaped.
     */
    delete: string;
  };
  SessionList: {
    sessions: Schemas["Session"][];
    /** The cursor of the next page; absent on the last. */
    next?: string;
  };
  /** An open publication session (docs/api.md, Open deploys). */
  Session: {
    id: number;
    /** <groupId>:<artifactId>:<version>; a SNAPSHOT build's version is the build's. */
    key: string;
    /** Who opened it: user:<uid> or token:<id>. */
    principal: string;
    /** A user's name now; absent for a token. */
    principalName?: string;
    /** The files stored so far, in the order they first came. */
    files: {
      /** The path below the repo. */
      name: string;
      digest: string;
      size: number;
    }[];
    /** The files a checksum file disagreed with, by name, with the reason; absent when none. */
    refused?: Record<string, string>;
    /** A commit of the session runs. */
    committing: boolean;
    createdAt: string;
    /** Its last change. */
    updatedAt: string;
    /** When it ends with nothing published unless it commits. */
    expiresAt: string;
  };
  Token: {
    id: number;
    kind: "pat" | "deploy";
    /** The owner of a personal access token. */
    user?: string;
    /** The <format>/<name> of a deploy token of one repo. */
    repo?: string;
    /** The mask of a deploy token over a mask, oci/* or *\/talos. */
    repoMask?: string;
    name: string;
    scopes: ("read" | "write" | "attach")[];
    expiresAt: string | null;
    lastUsedAt: string | null;
    createdAt: string;
    revokedAt: string | null;
    hashPrefix: string;
    /**
     * The JWK SHA-256 thumbprint (RFC 7638) of the DPoP key that the token of a web UI's sign-in is
     * bound to; absent for every other token. A bound token works only as Authorization: DPoP with
     * a proof of that key, on /api/.
     */
    dpopJkt?: string;
    /**
     * The sign-in at the identity provider of the token of a web UI's sign-in through OIDC: the
     * auth_time, the amr and the acr of the ID token of its login, each when it had it; absent for
     * every other token. A step that needs a fresh sign-in, or one with a second factor
     * (auth.oidc.mfa), reads it, so that a UI knows what it meets before it asks.
     */
    signIn?: {
      authTime?: string;
      amr?: string[];
      acr?: string;
    };
    /**
     * true on a live token beyond the bound of its kind, auth.deployTokens.maxTTL for a deploy
     * token and auth.serviceAccounts.maxTokenTTL for a service account's: made before the bound was
     * set or lowered, it has no expiry, or expires more than the bound after its creation, and is
     * to be replaced. Worked out when it is answered; absent otherwise.
     */
    beyondMaxTTL?: boolean;
  };
  /**
   * A request for a second admin (docs/spec/rbac.md §13); it never changes, but for its decision.
   */
  Approval: {
    id: number;
    kind: "binding" | "deploy-token";
    /**
     * What its approval makes: a binding's principal (user:<uid> for a user), role and repoMask, or
     * a deploy token's name, repoMask, scopes and expiresAt (null for none).
     */
    change: {
      principal?: string;
      role?: string;
      repoMask?: string;
      name?: string;
      scopes?: string[];
      expiresAt?: string | null;
    };
    /** The requester's reason; absent without one. */
    changeReason?: string;
    state: "pending" | "approved" | "rejected" | "expired";
    /** The requester, user:<uid>. */
    requestedBy: string;
    requestedAt: string;
    /** 7 days after the request; a request still pending then expires. */
    expiresAt: string;
    /** Once decided: user:<uid>, or anonymous for an expiry. */
    decidedBy?: string;
    decidedAt?: string;
    /** The decider's reason. */
    decisionReason?: string;
    /** What the approval made: binding:<id> or token:<id>. */
    result?: string;
  };
  ApprovalList: {
    approvals: Schemas["Approval"][];
    /** The cursor of the next page; absent on the last. */
    next?: string;
  };
  CreatedApproval: Schemas["Approval"] & {
    /** A deploy token's secret, shown this once: no credential until the request is approved. */
    secret?: string;
  };
  CreatedToken: Schemas["Token"] & {
    /** Shown this once. */
    secret: string;
  };
  LoginToken: Schemas["CreatedToken"] & {
    /** The token_type of RFC 9449 §5: the token is bound to the proof's key. */
    tokenType: "DPoP";
  };
  TokenList: {
    tokens: Schemas["Token"][];
  };
  TokenPage: {
    tokens: Schemas["Token"][];
    /** The cursor of the next page; absent on the last. */
    next?: string;
  };
  TokenRequest: {
    name: string;
    scopes?: ("read" | "write" | "attach")[];
    expiresAt?: string;
    /** A number of days (30d) or a duration (12h). */
    expiresIn?: string;
    changeReason?: Schemas["ChangeReason"];
  };
  MaskTokenRequest: {
    /** <format>/<repo>, each segment a name or * for any: oci/*, *\/talos. */
    repoMask: string;
    name: string;
    scopes: ("read" | "write" | "attach")[];
    expiresAt?: string;
    /** A number of days (30d) or a duration (12h). */
    expiresIn?: string;
    changeReason?: Schemas["ChangeReason"];
  };
  User: {
    uid: string;
    name: string;
    /** service: a service account (docs/spec/rbac.md §1). */
    kind: "local" | "oidc" | "service";
    disabled: boolean;
    createdAt: string;
    /**
     * The user's last activity, its last successful authentication or its enabling, less than a
     * minute behind; null before any record (docs/spec/rbac.md §1, Inactive users). It moves no
     * revision.
     */
    lastSeenAt: string | null;
    /**
     * With auth.disableInactiveUsersAfter set, the user is inactive beyond it: its next
     * authentication disables it, but for the last enabled admin. Absent when false.
     */
    inactive?: boolean;
    /**
     * With auth.lockout.duration set, the end of the lock of the user's password after 10 wrong
     * passwords in a row; absent while it is not locked (docs/spec/rbac.md §1, Local passwords). It
     * moves no revision.
     */
    lockedUntil?: string;
    /**
     * The user's password must be changed before it is used for anything else: it authenticates its
     * own change and is 403 everywhere else (docs/spec/rbac.md §1, Change at first use). Absent
     * when false.
     */
    mustChange?: boolean;
    /** A service account's owner, user:<uid> or group:<name>; absent for every other kind. */
    owner?: string;
    /** The name of a user owner. */
    ownerName?: string;
    /**
     * A user owner is disabled; the service account is not, for that, unless
     * auth.serviceAccounts.onOwnerDisabled is disable.
     */
    ownerDisabled?: boolean;
    /**
     * Proposed: An OIDC user's groups that count now, from its latest login (docs/spec/rbac.md §8),
     * as whoami answers the caller's; absent for a local user. The admin sees through which groups
     * a user reaches a repo (lajstrom/lajstrom#69).
     */
    groups?: string[];
  };
  UserList: {
    users: Schemas["User"][];
    next?: string;
  };
  /**
   * A local user needs a password; a service account (kind service) needs an owner, and has neither
   * a password nor admin.
   */
  UserRequest: {
    name: string;
    password?: Schemas["Password"];
    admin?: boolean;
    kind?: "local" | "service";
    /**
     * A service account's owner: user:<name> or user:<uid> of a user that is not a service account,
     * or group:<name>.
     */
    owner?: string;
    changeReason?: Schemas["ChangeReason"];
  };
  BootstrapRequest: {
    token: string;
    name: string;
    password: Schemas["Password"];
  };
  /**
   * The body of a sign-in: a local user's name and password, or the code of an OIDC login and its
   * PKCE verifier.
   */
  LoginRequest: {
    username: string;
    password: string;
  } | {
    /** The code in the fragment of the page the callback redirected to, #code=<code>. */
    code: string;
    /** The PKCE verifier (RFC 7636) whose S256 challenge started the login. */
    codeVerifier: string;
  };
  UserPatch: {
    name?: string;
    disabled?: boolean;
    /** A service account's new owner, as in UserRequest; 400 for a user of another kind. */
    owner?: string;
    /**
     * true: the user's password must be changed before it is used for anything else; false clears
     * it. Whatever auth.passwords.changeAtFirstUse is; 400 for a user without a password
     * (docs/spec/rbac.md §1, Change at first use).
     */
    mustChange?: boolean;
    changeReason?: Schemas["ChangeReason"];
  };
  /** {password} alone is an admin's new password; with currentPassword, the user's own change. */
  PasswordRequest: {
    password: Schemas["Password"];
    /** The user's current password, the credential of its own change. */
    currentPassword?: string;
    changeReason?: Schemas["ChangeReason"];
  };
  /**
   * A password of at least auth.passwords.minLength characters, Unicode code points (8 by default,
   * 12 for PCI DSS), and at most 1024 bytes of UTF-8; with auth.passwords.requireLettersAndDigits,
   * a letter and a digit of any script. The server counts bytes for the maximum, and the lengths
   * here count characters.
   */
  Password: string;
  /**
   * A CI trust policy (docs/spec/rbac.md §11). In a body, source, state, renewal, createdBy,
   * createdAt, updatedBy, updatedAt, approvedBy and approvedAt are ignored, and the name of a PUT,
   * when present, is the path's.
   */
  CIPolicy: {
    /** In a body only: the reason of the change. */
    changeReason?: Schemas["ChangeReason"];
    /** Lowercase letters and digits with single hyphens, at most 63 bytes. */
    name: string;
    /** The name of an issuer of auth.ci.issuers. */
    issuer: string;
    /**
     * Each claim to its values, any of which matches; every claim must match. An id (repository_id
     * or repository_owner_id, project_id or namespace_id) is required.
     */
    claims: Record<string, string[]>;
    grants: Schemas["CIGrant"][];
    /**
     * When a policy of the API that grants write stops counting. In a body, at most 180 days ahead,
     * by default 180 days ahead; refused for a policy that grants reader only.
     */
    expiresAt?: string;
    /** Its owner: config is read-only through the API. */
    source?: "config" | "api";
    /**
     * active counts; pending waits for a second admin's approval and grants nothing; expired grants
     * nothing (its expiry passed). A policy of the configuration is active.
     */
    state?: "active" | "pending" | "expired";
    /** A renewal that waits for an admin's approval. */
    renewal?: {
      expiresAt: string;
    };
    /** The principal that made a policy of the API. */
    createdBy?: string;
    createdAt?: string;
    /** The principal of its latest create, change or renewal, who may not approve what waits. */
    updatedBy?: string;
    updatedAt?: string;
    /** The principal of its latest approval. */
    approvedBy?: string;
    approvedAt?: string;
  };
  CIPolicyRenewal: {
    /** At most 180 days ahead; by default 180 days ahead. */
    expiresAt?: string;
    changeReason?: Schemas["ChangeReason"];
  };
  CIGrant: {
    role: "reader" | "writer" | "maintainer";
    /** <format>/<repo>, each a name or *. */
    mask: string;
  };
  CIPolicyList: {
    policies: Schemas["CIPolicy"][];
    /**
     * Proposed: The issuers of the server's auth.ci.issuers, in its order: the names a policy's
     * issuer may take, and the platform of each, whose claims a policy may name (docs/spec/rbac.md
     * §11). The UI offers them in the form of a policy, and the claims of the platform
     * (lajstrom/lajstrom#937).
     */
    issuers?: Schemas["CIIssuer"][];
  };
  Binding: {
    id: number;
    /**
     * user:<uid>, group:<name> (docs/spec/rbac.md §8), or a cert: or k8s: principal or pattern
     * (§9).
     */
    principal: string;
    /** The user's name now; absent for a group. */
    name?: string;
    role: "reader" | "attacher" | "writer" | "maintainer" | "admin";
    repoMask: string;
    createdAt: string;
  };
  BindingList: {
    bindings: Schemas["Binding"][];
    next?: string;
  };
  BindingRequest: {
    /**
     * user:<name>, user:<uid>, or group:<name>, which need not have members (docs/spec/rbac.md §8);
     * or a cert: or k8s: principal or pattern, never with the admin role (§9). A ci: principal has
     * no bindings (§11).
     */
    principal: string;
    role: "reader" | "attacher" | "writer" | "maintainer" | "admin";
    repoMask: string;
    changeReason?: Schemas["ChangeReason"];
  };
  AuditEntry: {
    id: number;
    at: string;
    principal: string;
    principalName?: string;
    /** service when the principal is a service account's user:<uid>; absent otherwise. */
    principalKind?: "service";
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
  AccessReviewRequest: {
    /**
     * The sha256 of the document's bytes as the reviewer got them, 64 lowercase hexadecimal digits,
     * without sha256:.
     */
    sha256: string;
    /** The generatedAt of the document; more than 60 seconds after the server's time is 400. */
    generatedAt: string;
    /** The scope of the document. */
    scope?: "all" | "people" | "systems";
    /**
     * 1 to 4096 bytes (not characters) of UTF-8 without control characters but line feeds: what was
     * found and done, who acknowledged, the ticket.
     */
    note: string;
  };
  /**
   * The flags that hold, in this order: admin, a binding of the role admin, its own or a current
   * group's; allRepos, a binding on *\/*, a deploy token over *\/*, a CI grant on *\/*;
   * adminWithoutEffect, an admin binding of a service account or a local user under the admin mode;
   * noExpiry, a token or a CI trust policy without an expiry; unused, no use for more than
   * unusedDays; beyondMaxTTL, a token beyond the bound of its kind; ownerDisabled, a service
   * account whose user owner is disabled; inactive, a user inactive under
   * auth.disableInactiveUsersAfter. A reader tolerates a flag it does not know.
   */
  AccessFlags: ("admin" | "allRepos" | "adminWithoutEffect" | "noExpiry" | "unused" | "beyondMaxTTL" | "ownerDisabled" | "inactive")[];
  /** A binding as the bindings API answers it. */
  AccessBinding: Schemas["Binding"] & {
    /** group:<name>: a user's binding through a current group of it. */
    via?: string;
  };
  /** A live token as the tokens API answers it, with its flags. */
  AccessToken: Schemas["Token"] & {
    /** token:<id>, of a deploy token. */
    principal?: string;
    flags: Schemas["AccessFlags"];
  };
  /** A live user, a disabled one too, as the users API answers it. */
  AccessUser: Schemas["User"] & {
    /** user:<uid>. */
    principal: string;
    /** Its current groups, by name, each until the end of the lifetime of its latest login. */
    groups: {
      name: string;
      expiresAt: string;
    }[];
    /** Its own bindings and those of its current groups, by role, mask and via. */
    bindings: Schemas["AccessBinding"][];
    /** Its personal access tokens neither revoked nor expired, by id. */
    tokens: Schemas["AccessToken"][];
    flags: Schemas["AccessFlags"];
  };
  /**
   * Who has what at generatedAt (docs/spec/rbac.md §14). A section that the scope leaves out is
   * absent; anonymous is absent while auth.anonymousRead is off. Lists are in byte order: users by
   * name, groups, workloads and members by principal, deployTokens and tokens by id, ciPolicies by
   * name, bindings by role, mask and via.
   */
  AccessReport: {
    /** The database's time of the read, to the second. */
    generatedAt: string;
    scope: "all" | "people" | "systems";
    unusedDays: number;
    /** What the flags read of the configuration; the durations in seconds, 0 for off. */
    settings: {
      adminMFA: boolean;
      anonymousRead: boolean;
      disableInactiveUsersAfter: number;
      deployTokensMaxTTL: number;
      serviceAccountsMaxTokenTTL: number;
    };
    /**
     * The users of the scope: every kind for all, local and oidc for people, service for systems.
     */
    users: Schemas["AccessUser"][];
    /** Every group that has a binding. */
    groups?: {
      /** group:<name>. */
      principal: string;
      bindings: Schemas["AccessBinding"][];
      /** The live users whose current groups name it. */
      members: {
        principal: string;
        name: string;
        expiresAt: string;
      }[];
      flags: Schemas["AccessFlags"];
    }[];
    /** Every cert: and k8s: principal or pattern that has a binding. */
    workloads?: {
      principal: string;
      /** true for a pattern; absent otherwise. */
      pattern?: boolean;
      bindings: Schemas["AccessBinding"][];
      flags: Schemas["AccessFlags"];
    }[];
    /** Every live deploy token, of a repo and over a mask. */
    deployTokens?: Schemas["AccessToken"][];
    /** Every CI trust policy, of the configuration and of the API, an expired one too. */
    ciPolicies?: (Schemas["CIPolicy"] & {
      flags: Schemas["AccessFlags"];
    })[];
    anonymous?: {
      /** The repos with anonymousRead, <format>/<name>. */
      repos: string[];
    };
  };
  /** A package with the facts of its manifests, all read from the index. */
  Package: {
    /** The name in the format's spelling. */
    name: string;
    /** The escaped package path of its OCI repository. */
    nameOci: string;
    /** The publish time of its first manifest. */
    createdAt: string;
    /** The publish time of its newest manifest. */
    updatedAt: string;
    /**
     * The version the format's client installs by default: npm the latest dist-tag, maven the
     * release of maven-metadata.xml, pypi the highest that is not a pre-release and not yanked (as
     * pip picks it), apt and rpm the highest by dpkg's and rpm's order, raw the newest; null when
     * the client installs none.
     */
    latestVersion: string | null;
    /**
     * The variants of the latest version in byte order; empty for a format without variants and
     * without a latest version.
     */
    latestVariants: string[];
    /**
     * The first version of its versions list, the newest by its first publish time; null without
     * versions.
     */
    lastPublished: string | null;
    /** How many versions it has. */
    versions: number;
    /** How many manifests it has, one per variant of each version. */
    manifests: number;
    /** The sizes of the file layers of all its manifests, added up. */
    size: number;
    /**
     * One line of the head manifest's metadata layer (pypi summary, deb Description, npm
     * description, rpm summary); null when it has none.
     */
    summary: string | null;
    /**
     * The lajstrom.* annotations of the head manifest, the latest version's first variant (else the
     * last published one's), by their full key.
     */
    attrs: Record<string, string>;
    /**
     * Its pointers that name one of its versions, with the version, by kind and name: npm's
     * dist-tags.
     */
    pointers: Schemas["PackagePointer"][];
  };
  /** A pointer of a package, with the version it names. */
  PackagePointer: Schemas["Pointer"] & {
    /** The version it names. */
    version: string;
  };
  /**
   * One package: its row of the package list, its OCI repository and the metadata of its head
   * manifest.
   */
  PackageDetail: Schemas["Package"] & {
    /** <format>/<repo>/<package path>, the repository of its manifests on /v2. */
    ociRepository: string;
    /** The metadata layer of the head manifest; null when it is absent or was too large to keep. */
    latestMetadata: Record<string, unknown> | null;
  };
  PackageList: {
    packages: Schemas["Package"][];
    /**
     * With facet only: for each key, its values in the repo's manifests in byte order, at most
     * 1000.
     */
    facets?: Record<string, Schemas["FacetValue"][]>;
    next?: string;
  };
  /** A page of the hits of a search, rank after rank. */
  SearchResult: {
    hits: (Schemas["PackageHit"] | Schemas["VersionHit"])[];
    next?: string;
  };
  /** A package found by its name or a summary, with the facts of its row of the package list. */
  PackageHit: {
    kind: "package";
    format: string;
    repo: string;
    name: string;
    latestVersion: string | null;
    summary: string | null;
    updatedAt: string;
  };
  /** A manifest found by its digest, or by the digest of one of its file layers. */
  VersionHit: {
    kind: "version";
    format: string;
    repo: string;
    name: string;
    version: string;
    /** Empty for a format without variants. */
    variant: string;
    /** The manifest's digest. */
    digest: string;
    /** Whose digest matched. */
    matched: "manifest" | "file";
    /** The file whose digest matched; with matched file only. */
    file?: {
      name: string;
      digest: string;
    };
  };
  /** A value of an attribute in the repo's manifests. */
  FacetValue: {
    value: string;
    /** How many packages have a manifest with the value. */
    count: number;
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
  /** A policy rule (docs/spec/policy.md §1). */
  Rule: {
    id: number;
    /** A repo mask, <format>/<repo>, each * or a name. */
    repoMask: string;
    /** A pattern of the package name; * any run of characters. */
    name: string;
    /** A version constraint: *, or clauses ==, !=, <, <=, >, >= joined with commas. */
    version: string;
    /** A pattern of the variant; * every variant. */
    variant: string;
    effect: "deny" | "allow";
    reason: string;
    createdBy: string;
    createdAt: string;
    expiresAt: string | null;
    expired: boolean;
  };
  RuleList: {
    rules: Schemas["Rule"][];
  };
  /** The body of a rule's creation. */
  RuleRequest: {
    repoMask: string;
    name: string;
    /** * when absent. */
    version?: string;
    /** * when absent; empty for the empty variant only. */
    variant?: string;
    /** deny when absent. */
    effect?: "deny" | "allow";
    reason: string;
    expiresAt?: string | null;
    changeReason?: Schemas["ChangeReason"];
  };
  /** A verdict the index holds (docs/spec/policy.md §2). */
  Verdict: {
    repo: string;
    package: string;
    version?: string;
    variant?: string;
    /** The judged manifest's digest. */
    subject: string;
    /** The referrer's digest. */
    attestation: string;
    verdict: "allow" | "deny" | "quarantine";
    reason: string;
    source: string;
    scope: string;
    validUntil: string | null;
    signedBy: string;
    createdAt: string | null;
    inForce: boolean;
  };
  VerdictList: {
    items: Schemas["Verdict"][];
  };
  /** The deny list (docs/spec/policy.md §8). */
  Denylist: {
    version: number;
    generation: number;
    createdAt: string;
    rules: Record<string, unknown>[];
    verdicts: Record<string, unknown>[];
    digests: string[];
    prefixes: string[];
  };
  /** The body of a deny. */
  DenyRequest: {
    reason: string;
    validUntil?: string | null;
    changeReason?: Schemas["ChangeReason"];
  };
  /** The optional body of a yank. */
  YankRequest: {
    /** Why the version is yanked, at most 4096 bytes of UTF-8; absent, null or empty for none. */
    reason?: string | null;
  };
  /** One manifest of a version with its facts, from the index. */
  Variant: {
    /** Empty for a format without variants. */
    variant: string;
    tag: string;
    /** The manifest digest, the entity tag of If-Match. */
    digest: string;
    publishedAt: string;
    artifactType: string;
    /** The manifest's lajstrom.* annotations by their full key. */
    attrs: Record<string, string>;
    /** The row came from the annotations alone; its metadata layer could not be read. */
    degraded: boolean;
    /** The sizes of its file layers added up. */
    size: number;
    /** The number of its file layers. */
    fileCount: number;
    attachments: Schemas["AttachmentCounts"];
  };
  /**
   * The attachments of a variant counted by kind, as GET …/attachments?variant=&kind= lists them;
   * every kind is there, 0 without attachments, and a kind of a newer server is counted under its
   * own name.
   */
  AttachmentCounts: {
    signature: number;
    sbom: number;
    scan: number;
    provenance: number;
    attestation: number;
    other: number;
    [key: string]: number;
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
    /**
     * The ociRepository of its first variant: <format>/<repo>/<package path>, the repository of its
     * manifest on /v2.
     */
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
    /** The referrer's artifactType, else its config's media type. */
    artifactType: string;
    /** What it is; a value this list does not name is shown as it is. */
    kind: "signature" | "sbom" | "scan" | "provenance" | "attestation" | "other";
    /** The predicate type of its statement or cosign's annotation; empty when none. */
    predicateType: string;
    /** The layer's size. */
    size: number;
    /** The referrer manifest's annotations. */
    annotations: Record<string, string>;
    /** lajstrom.attachment.tool, when set. */
    tool?: string;
    /** lajstrom.attachment.toolVersion, when set. */
    toolVersion?: string;
    /** lajstrom.attachment.database, when set. */
    database?: string;
    /** lajstrom.attachment.input, the SBOM a scan was computed from, when it is a digest. */
    input?: string;
    /**
     * verified (a trusted key or keyless identity signed it, for its predicate type, and what it
     * signed names the variant), untrusted, unsigned, invalid or unsupported (keyless without
     * attachments.keyless, cosign's legacy keyless layers, notation, a message signature, a layer
     * above attachments.maxBlobSize).
     */
    verification: "verified" | "untrusted" | "unsigned" | "invalid" | "unsupported";
    /** The name of the key or keyless identity that verified it. */
    signedBy?: string;
    /** Why it is not verified. */
    reason?: string;
    /** The referrer's org.opencontainers.image.created, when it has one. */
    createdAt?: string;
    /** When ingest or reindex last wrote or saw the row. */
    indexedAt: string;
  };
  /** The manifests of a version's variants, read from the registry. */
  ManifestList: {
    manifests: Schemas["Manifest"][];
  };
  /** The manifest of one variant. */
  Manifest: {
    /** Empty for a format without variants. */
    variant: string;
    /** The manifest digest, the index's. */
    digest: string;
    mediaType: string;
    size: number;
    /** The manifest as JSON; its exact bytes are /v2/<ociRepository>/manifests/<digest>. */
    manifest: Record<string, unknown>;
  };
  /** The referrers of a version's variants, as the registry lists them. */
  ReferrerList: {
    referrers: Schemas["Referrer"][];
  };
  /** One manifest whose subject is a variant's manifest. */
  Referrer: {
    /** Empty for a format without variants. */
    variant: string;
    /** The variant's manifest digest. */
    subject: string;
    /** The referrer manifest's digest. */
    digest: string;
    mediaType: string;
    artifactType: string;
    size: number;
    /** The referrer manifest's annotations, as the registry lists them. */
    annotations: Record<string, string>;
  };
  /** One manifest of a version, with its row of the index, its facts and its files. */
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
    /** The row came from the annotations alone. */
    degraded: boolean;
    /** The sizes of its file layers added up. */
    size: number;
    /** The number of its file layers. */
    fileCount: number;
    attachments: Schemas["AttachmentCounts"];
    /** The metadata layer; null when there is none or it was too large to keep. */
    metadata: Record<string, unknown> | null;
    /** When ingest or reindex last wrote or saw the row. */
    indexedAt: string;
    /** The file layers, in manifest order. */
    files: Schemas["File"][];
    /**
     * <format>/<repo>/<package path>, the repository of its manifest on /v2: of a package split
     * across two forms of its OCI name, the form where reindex found it (#642).
     */
    ociRepository: string;
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
    /** Why, for every status but deleted. */
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
    /** Why, for failed. */
    message?: string;
    /**
     * Of an oci repo: what a reference names, an index or a manifest; a platform's manifest; a
     * blob. Absent for an image that failed before what it names was known.
     */
    kind?: "index" | "manifest" | "blob";
    /** Of an oci repo, the platform of a manifest or a blob of an index. */
    platform?: string;
    /** Of an oci repo, the digest of the index, manifest or blob. */
    digest?: string;
    /** Of an oci repo, what the request got from the upstream; a manifest's with its blobs. */
    bytes?: number;
    /** For a failed 503, when to ask again, in seconds. */
    retryAfter?: number;
  };
  Whoami: {
    principal: string;
    /**
     * user, token for a deploy token, or ci for a CI token (docs/spec/rbac.md §11), whose name is
     * <issuer>/<project>.
     */
    kind: "user" | "token" | "ci";
    name: string;
    uid?: string;
    /** A user's groups that count now, from its latest OIDC login (docs/spec/rbac.md §8). */
    groups?: string[];
  };
  RegistryList: {
    /** The replica that answers, as replicas.id names it: host name and process id. */
    replica: string;
    registries: Schemas["Registry"][];
  };
  Registry: {
    name: string;
    type: "generic" | "ecr";
    url: string;
    prefix: string;
    /**
     * The product the probe detected, as lajstrom registry probe names it (distribution, zot,
     * gitlab, ghcr, harbor, nexus, gitea, forgejo, jfrog, quay, dockerhub, ecr, or unknown); null
     * before a probe of the replica got an answer.
     */
    vendor: string | null;
    /**
     * The vendor's support tier in this release (docs/registries/README.md, Support tiers); null
     * with vendor.
     */
    support: "ci" | "manual" | "hosted" | "untested" | null;
    /** What ingest and the facade go by; null before a probe of the replica succeeded. */
    capabilities: Schemas["Capabilities"] | null;
    /** The repos on the registry, <format>/<name>, by format and name. */
    repos: string[];
    status: Schemas["RegistryStatus"];
  };
  /**
   * A registry's capabilities, under the keys of registries[].capabilities (docs/configuration.md).
   */
  Capabilities: {
    createOnPush: boolean;
    referrers: boolean;
    catalog: boolean;
    deleteManifest: boolean;
    immutableTags: boolean;
    blobRedirect: boolean;
    referrersAlwaysTag: boolean;
    /** Bytes; 0 when unknown. */
    maxBlobSize: number;
    /** "" when unknown. */
    consistency: "strong" | "eventual" | "";
    /** A duration, 2m10s; 0s when none is known. */
    consistencyBound: string;
    /** 0 for no limit. */
    maxNameDepth: number;
    /** 0 for no limit. */
    maxNameLength: number;
    tagsFoldCase: boolean;
    buildRoutes: boolean;
  };
  /**
   * What the replica's readiness ping (GET /v2/ every 20 seconds) and the registry's circuit
   * breaker know.
   */
  RegistryStatus: {
    /**
     * down: no ping answered 200 for a minute, or the breaker is open; degraded: the last ping
     * failed, or the breaker is half-open.
     */
    state: "ok" | "degraded" | "down";
    /** The last ping; null before the first, and for a provider that is not pinged. */
    checkedAt: string | null;
    /** The last ping answered 200. */
    answeredAt: string | null;
    /** How long the last ping took. */
    latencyMs: number | null;
    /** The error of the last ping, as the provider words it: no credential, no instance prefix. */
    message: string | null;
    breaker: "closed" | "open" | "half-open";
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
    /** How a person signs in; oidc while the OIDC login is on. */
    authModes: ("password" | "token" | "oidc")[];
    /**
     * POST /api/v1/login, whose token is DPoP-bound, which a server before it does not answer; with
     * oidc in authModes, /-/oidc/login takes return_to, code_challenge and dpop_jkt for a web UI.
     */
    login: {
      /** The seconds of auth.login.tokenLifetime. */
      tokenLifetime: number;
      /**
       * The seconds of auth.login.idleTimeout, 0 when off: a sign-in token unused for longer is
       * refused (401, error_description="idle") and revoked; the server may refuse up to a minute
       * before. A server before it answers none, which is off.
       */
      idleTimeout?: number;
    };
    /**
     * true while auth.admin.requireMFA is on, absent otherwise: the admin role counts only for a
     * web UI's sign-in through OIDC with a second factor.
     */
    adminMFA?: boolean;
    /**
     * auth.requireReason: true when a change of the control plane without changeReason is 400
     * (docs/spec/rbac.md §13). A server before it answers none, which is false.
     */
    requireReason?: boolean;
    /**
     * auth.approval: with second-admin, an admin binding, a binding on *\/* and a deploy token over
     * a mask with write are answered 202 with a request for a second admin (docs/spec/rbac.md §13).
     * A server before it answers none.
     */
    approval?: "none" | "second-admin";
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
    /**
     * true when the caller has an admin binding that the request's credential does not reach under
     * adminMFA, absent otherwise: a UI offers a sign-in with a second factor.
     */
    adminNeedsMFA?: boolean;
  };
  Webhook: {
    id: number;
    /** A repo mask of rbac.md §3, such as apt/ubuntu-internal, apt/* or *\/*. */
    mask: string;
    url: string;
    /** The types it gets; empty, every type. */
    events: ("version.published" | "version.deleted" | "repo.created" | "repo.deleted" | "policy.rule.created" | "policy.rule.deleted" | "policy.verdict.created" | "policy.verdict.deleted" | "ci.policy.created" | "ci.policy.updated" | "ci.policy.renewed" | "ci.policy.approved" | "ci.policy.expired" | "ci.policy.deleted")[];
    active: boolean;
    description: string;
    /** The principal that created it. */
    createdBy: string;
    createdAt: string;
    updatedAt: string;
  };
  CreatedWebhook: Schemas["Webhook"] & {
    /** whsec_ and the base64 of the key: shown this once. */
    secret: string;
  };
  WebhookList: {
    webhooks: Schemas["Webhook"][];
  };
  /**
   * Create: url is required, and under /api/v1/webhooks the mask too; active is true by default.
   * Change: the fields given change; a mask is refused.
   */
  WebhookRequest: {
    mask?: string;
    url?: string;
    events?: ("version.published" | "version.deleted" | "repo.created" | "repo.deleted" | "policy.rule.created" | "policy.rule.deleted" | "policy.verdict.created" | "policy.verdict.deleted" | "ci.policy.created" | "ci.policy.updated" | "ci.policy.renewed" | "ci.policy.approved" | "ci.policy.expired" | "ci.policy.deleted")[];
    active?: boolean;
    description?: string;
    changeReason?: Schemas["ChangeReason"];
  };
  WebhookSecret: {
    /** Shown this once. */
    secret: string;
  };
  Delivery: {
    id: number;
    /** The CloudEvents id, the same on every attempt. */
    eventId: string;
    eventType: string;
    state: "pending" | "delivered" | "failed";
    attempts: number;
    /** When a pending delivery is due. */
    nextAt?: string;
    lastAt?: string;
    /** The status of the last answer; absent when none came. */
    lastStatus?: number;
    /** Lajstrom's words, never the receiver's body. */
    lastError?: string;
    createdAt: string;
    deliveredAt?: string;
  };
  DeliveryList: {
    deliveries: Schemas["Delivery"][];
    /** The cursor of the next page; absent on the last. */
    next?: string;
  };
  /** Proposed: An issuer of auth.ci.issuers, as a policy names it. */
  CIIssuer: {
    /**
     * The issuer's name: a policy's issuer, and the <issuer> of the principal
     * ci:<issuer>/<project>.
     */
    name: string;
    /** The CI platform of its tokens. */
    platform: "github" | "gitlab";
  };
};
