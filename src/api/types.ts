// Types of the /api/v1 JSON the UI reads, named for the UI. They are those of
// src/api/openapi.gen.ts, generated from public/openapi.yaml: the server's openapi.yaml as
// vendored in openapi/server.yaml (npm run update:openapi), with what the UI proposes from
// openapi/proposed.yaml. A proposed field is not in the server yet; docs/api-proposal.md
// describes them, and the UI shows them only when they are there.

import type { Schemas } from "./openapi.gen";

/** The formats the UI has a spec for (src/lib/formats). */
export type FormatName = "raw" | "pypi" | "apt" | "maven" | "npm" | "rpm";

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

/** The repo's OpenPGP signing key for apt; retired keys are still served for a while. */
export type SigningKey = Schemas["SigningKey"];

export type RepoStats = Schemas["RepoStats"];

/** A repo as GET /api/v1/repos answers it, plus `prefix`, which the UI derives. A group has no
 * registry and no policy; a proxy has its upstream, a group its members. The state of a reindex
 * is not part of it: GET …/reindex has it (ReindexRun). Without `permissions`, from a server
 * before them, the UI offers the actions and the server decides (src/lib/access.ts). */
export type Repo = Schemas["Repo"] & {
  /** <format>/<name>: the repo's path on every protocol and its OCI path below the instance
   * prefix. Not in the answer: src/api/queries.ts derives it. */
  prefix: string;
};

/** One value of a filter facet with its count: suite "jammy" (12). */
export type FacetValue = Schemas["FacetValue"];

/** A row of GET …/packages. latestVersion is what the format's client installs by default,
 * lastPublished the newest by publish time. */
export type PackageSummary = Schemas["Package"];

/** GET …/packages: a page, with the server's cursor; `facets` only for the keys asked with
 * facet=, over the whole repo. */
export type PackageList = Schemas["PackageList"];

/** GET …/packages/{name}; the package page derives it from the versions from a server before it
 * (src/pages/package-model.ts). */
export type PackageDetail = Schemas["PackageDetail"];

/** The attachments of a variant by kind, each as many as …/attachments?kind= lists. */
export type AttachmentCounts = Schemas["AttachmentCounts"];

/** A variant of the version list: its tag, digest, publish time, facts and attachment counts. */
export type VariantSummary = Schemas["Variant"];

/** A version of GET …/packages/{name}/versions, newest first, with its variants. */
export type VersionSummary = Schemas["Version"];

export type FileEntry = Schemas["File"];

/** GET …/versions/{version}/manifest: each variant's manifest, read from the registry and
 * checked against the index's digest. Its annotations are manifest.annotations. */
export type ManifestEntry = Schemas["Manifest"];

export type ManifestList = Schemas["ManifestList"];

/** GET …/versions/{version}/referrers: the manifests whose subject is a variant's, as the
 * registry lists them now. */
export type Referrer = Schemas["Referrer"];

export type ReferrerList = Schemas["ReferrerList"];

/** One variant of GET …/versions/{version}: its row of the index, its facts and its files. */
export type VariantDetail = Schemas["VariantDetail"];

/** GET …/packages/{name}/versions/{version}: one version with every variant in detail. */
export type VersionDetail = Schemas["VersionDetail"];

/** The yank of a pypi version (PEP 592), absent when it is not yanked. */
export type Yank = Schemas["Yank"];

/** What names a version and can move to another: an npm dist-tag, from the package's journal
 * (manifest-profile.md §8). */
export type Pointer = Schemas["Pointer"];

export type BatchDeleteRequest = Schemas["BatchDeleteRequest"];

/** What POST …/versions:delete did with each item, in the order of the request. */
export type BatchDeleteResult = Schemas["BatchDeleteResult"];

export type BatchDeleteItemResult = Schemas["BatchDeleteItemResult"];

/** An attachment of a version: one layer of a referrer of one of its variants, labelled. */
export type Attachment = Schemas["Attachment"];

export type AttachmentList = Schemas["AttachmentList"];

export type SearchHit = Schemas["PackageHit"] | Schemas["VersionHit"];

/** GET /api/v1/search?q=: a page of hits, rank after rank, without a total. A sha256 digest
 * finds manifests and files. */
export type SearchResult = Schemas["SearchResult"];

/** GET /api/v1/registries (system resource, admin only); its status is the answering replica's. */
export type Registry = Schemas["Registry"];

/** provider.Capabilities (internal/provider/provider.go). */
export type Capabilities = Schemas["Capabilities"];

/** The support tier of a registry's vendor in the server's release. */
export type SupportTier = NonNullable<Registry["support"]>;

export type AuditEvent = Schemas["AuditEntry"];

/** A page of the audit log, newest first; `next` is the cursor of the page after it. */
export type AuditList = Schemas["AuditList"];

/** A user, local or made by an OIDC login. Whether it is an admin follows from its bindings and
 * its groups' (rbac.md §3, §8). */
export type User = Schemas["User"];

/** The body of POST /api/v1/bootstrap: the server's one-time bootstrap token, and the name and
 * the password of the first admin. */
export type BootstrapRequest = Schemas["BootstrapRequest"];

/** POST /api/v1/users: a local user and its password; `admin` binds it to the admin role on
 * `*\/*` in the same step. */
export type UserRequest = Schemas["UserRequest"];

/** PATCH /api/v1/users/{user}: the name, disabled, or both. */
export type UserPatch = Schemas["UserPatch"];

/** A personal access token or a deploy token (docs/api.md, Tokens). The secret is answered only
 * once, by the creation: CreatedToken. */
export type Token = Schemas["Token"];

export type TokenScope = Token["scopes"][number];

/** The answer of a token creation: the resource and its secret, shown this one time. */
export type CreatedToken = Schemas["CreatedToken"];

/** The body of POST /api/v1/login: a local user's name and password, or the code of an OIDC
 * login and its PKCE verifier. */
export type LoginRequest = Schemas["LoginRequest"];

/** The answer of POST /api/v1/login: the token of a sign-in, bound to the DPoP key of its proof
 * (dpopJkt), with tokenType DPoP. */
export type LoginToken = Schemas["LoginToken"];

/** The body of POST /api/v1/users/{name}/tokens and …/deploy-tokens. */
export type TokenRequest = Schemas["TokenRequest"];

/** POST /api/v1/deploy-tokens: a deploy token over a mask of repos, oci/* or *\/talos. */
export type MaskTokenRequest = Schemas["MaskTokenRequest"];

/** A request for a second admin (docs/spec/rbac.md §13): a binding of the role admin or on
 * `*\/*`, or a deploy token over a mask with write, made by an admin and waiting for another one;
 * it never changes but for its decision. */
export type Approval = Schemas["Approval"];

export type ApprovalState = Approval["state"];

export type ApprovalList = Schemas["ApprovalList"];

/** The answer 202 of a change that waits for a second admin: the request, and for a deploy token
 * its secret, shown this once, which is no credential until the request is approved. */
export type CreatedApproval = Schemas["CreatedApproval"];

/** Who has what at one moment (docs/spec/rbac.md §14): one document in its canonical form, which
 * a review names by the sha256 of its bytes. */
export type AccessReport = Schemas["AccessReport"];

export type AccessFlag = Schemas["AccessFlags"][number];

/** The body of POST /api/v1/access-reviews: the report reviewed and what was found. */
export type AccessReviewRequest = Schemas["AccessReviewRequest"];

/** A role binding; `principal` is canonical, `user:<uid>` or `group:<name>`, and `name` the
 * user's name now. */
export type Binding = Schemas["Binding"];

/** POST /api/v1/bindings: the principal as `user:<name>`, `user:<uid>` or `group:<name>`, the
 * role and the mask. */
export type BindingRequest = Schemas["BindingRequest"];

/** An open publication session: maven deploys file by file until maven-metadata.xml. */
export type PublishSession = Schemas["Session"];

/** GET …/repos/{format}/{repo}/reindex: the latest run that covered the repo. */
export type ReindexRun = Schemas["ReindexRun"];

/** The repo's part of a run's report (lajstrom/lajstrom#1128): counts, and lists of at most
 * 1000 entries each. */
export type ReindexReport = NonNullable<ReindexRun["report"]>;

/** A manifest, or a failure, of a report's list: foreign, orphans, errors. */
export type ReindexFinding = Schemas["ReindexFinding"];

/** A tag that names another digest in the registry than in the index. */
export type ReindexDrift = Schemas["ReindexDrift"];

/** A package at two forms of its OCI name (ADR 0017 of the server). */
export type ReindexSplit = Schemas["ReindexSplit"];

/** A version of the index whose OCI repository the registry does not know. */
export type ReindexRepositoryUnknown = Schemas["ReindexRepositoryUnknown"];

/** A referrers index that a run pushed again with the referrers it lacked. */
export type RepairedReferrersIndex = Schemas["RepairedReferrersIndex"];

// Webhooks (docs/api.md, Webhooks; docs/spec/webhooks.md).

/** A webhook: the events of the repos its mask matches, sent to its URL. Never its secret. */
export type Webhook = Schemas["Webhook"];

/** A type of event a webhook gets; a webhook whose `events` is empty gets every type. */
export type WebhookEvent = Webhook["events"][number];

/** The answer of a creation: the webhook and its secret, shown this one time. */
export type CreatedWebhook = Schemas["CreatedWebhook"];

/** The body of a creation, and of a change: the fields given change, never the mask. */
export type WebhookRequest = Schemas["WebhookRequest"];

/** The answer of a rotation: the new secret, shown this one time. */
export type WebhookSecret = Schemas["WebhookSecret"];

/** A row of a webhook's delivery log: pending (due at nextAt), delivered or failed. */
export type Delivery = Schemas["Delivery"];

/** A page of a delivery log, newest first; `next` is the cursor of the page after it. */
export type DeliveryList = Schemas["DeliveryList"];

// Proxy and group repos (docs/spec/proxy-and-group.md).

/** A proxy repo's settings: its upstream by the configuration's name, the TTLs of its cache,
 * offline, and the names it mirrors (allow) and never fetches (deny). */
export type Upstream = Schemas["Upstream"];

/** A group's settings: its members in order, and the merged names, or an oci group's routes. */
export type RepoGroup = Schemas["Group"];

/** POST …/prefetch: package names of a format's proxy, or images and platforms of an oci one. */
export type PrefetchRequest = Schemas["PrefetchRequest"];

/** What a prefetch did, one result per version, or per image, platform and blob of an oci repo. */
export type PrefetchResult = Schemas["PrefetchResult"];

export type PrefetchItemResult = Schemas["PrefetchItemResult"];

// Managing repos (docs/api.md, Repos).

/** POST /api/v1/repos: a hosted repo, a proxy with its upstream, or a group with its members. */
export type CreateRepoRequest = Schemas["CreateRepo"];

/** PATCH …/repos/{format}/{repo}: the fields to change; policy, upstream and group merged as
 * RFC 7396 merge patches. */
export type RepoPatch = Schemas["RepoPatch"];

/** A merge patch of a policy: null removes a key. */
export type PolicyPatch = Schemas["PolicyPatch"];

/** POST …/reindex: prune, verify; an empty body takes the defaults. */
export type ReindexRequest = Schemas["ReindexRequest"];

// CI trust policies (docs/api.md, CI trust policies; docs/spec/rbac.md §11).

/** A CI trust policy: which tokens of an issuer's CI jobs the server exchanges for a CI token,
 * and what that token may do. One of the configuration (source config) is read-only; one of the
 * API has its state, its people and its revision (the ETag of its GET). */
export type CIPolicy = Schemas["CIPolicy"];

/** A role on the repos of a mask, of a policy: reader, writer or maintainer. */
export type CIGrant = Schemas["CIGrant"];

/** GET /api/v1/ci/policies: those of the configuration, then those of the API; and, proposed,
 * the server's issuers. */
export type CIPolicyList = Schemas["CIPolicyList"];

/** An issuer of the server's auth.ci.issuers and its platform (proposed). */
export type CIIssuer = Schemas["CIIssuer"];

/** POST …/{name}/renew: the expiry asked, 180 days ahead when absent. */
export type CIPolicyRenewal = Schemas["CIPolicyRenewal"];
