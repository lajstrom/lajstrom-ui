// Types of the /api/v1 JSON the UI reads, named for the UI. They are those of
// src/api/openapi.gen.ts, generated from public/openapi.yaml: the server's openapi.yaml as
// vendored in openapi/server.yaml (npm run update:openapi), with what the UI proposes from
// openapi/proposed.yaml. A proposed endpoint or field is not in the server yet;
// docs/api-proposal.md describes them, and the UI shows them only when they are there.

import type { Schemas } from "./openapi.gen";

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

/** Reindex and reconcile state of a repo (proposed). */
export type ReindexStatus = Schemas["ReindexStatus"];

/** The repo's OpenPGP signing key for apt; retired keys are still served for a while. */
export type SigningKey = Schemas["SigningKey"];

export type RepoStats = Schemas["RepoStats"];

/** A repo as GET /api/v1/repos answers it, with the proposed fields of lajstrom/lajstrom#957
 * (stats, permissions, reindex, signingKeys), plus `prefix`, which the UI derives. A group has
 * no registry and no policy; a proxy has its upstream, a group its members. Without
 * `permissions` the UI offers the actions and the server decides (src/lib/access.ts). */
export type Repo = Schemas["Repo"] & {
  /** <format>/<name>: the repo's path on every protocol and its OCI path below the instance
   * prefix. Not in the answer: src/api/queries.ts derives it. */
  prefix: string;
};

/** A directory of a raw repo, for browsing paths like a file tree. */
export type RawDirectory = Schemas["RawDirectory"];

/** One value of a filter facet with its count: suite "jammy" (12). */
export type FacetValue = Schemas["FacetValue"];

/** A row of GET …/packages: the server's name and createdAt, and the proposed facts of
 * lajstrom/lajstrom#955 when the answer has them. */
export type PackageSummary = Schemas["Package"];

/** GET …/packages: a page ordered by name, with the server's cursor. `facets` and `directories`
 * are proposed; an answer with facets takes the proposed filters too. */
export type PackageList = Schemas["PackageList"];

/** GET …/packages/{name} (proposed, lajstrom/lajstrom#958); the package page derives it from the
 * versions when the server does not have it (src/pages/package-model.ts). */
export type PackageDetail = Schemas["PackageDetail"];

export type ReferrerCounts = Schemas["ReferrerCounts"];

/** A variant of the version list: its tag, digest and publish time, and the proposed facts
 * when the answer has them. */
export type VariantSummary = Schemas["Variant"];

/** A version of GET …/packages/{name}/versions, newest first, with its variants. */
export type VersionSummary = Schemas["Version"];

export type FileEntry = Schemas["File"];

export type OciDescriptor = Schemas["OciDescriptor"];

export type OciManifest = Schemas["OciManifest"];

/** One variant of GET …/versions/{version}; the manifest and its annotations are proposed
 * (lajstrom/lajstrom#951): the server reads them from the registry on /v2. */
export type VariantDetail = Schemas["VariantDetail"];

/** GET …/packages/{name}/versions/{version}: one version with every variant in detail. */
export type VersionDetail = Schemas["VersionDetail"];

/** The yank of a pypi version (PEP 592), absent when it is not yanked. */
export type Yank = Schemas["Yank"];

export type BatchDeleteRequest = Schemas["BatchDeleteRequest"];

/** What POST …/versions:delete did with each item, in the order of the request. */
export type BatchDeleteResult = Schemas["BatchDeleteResult"];

export type BatchDeleteItemResult = Schemas["BatchDeleteItemResult"];

/** An attachment of a version: one layer of a referrer of one of its variants, labelled. */
export type Attachment = Schemas["Attachment"];

export type AttachmentList = Schemas["AttachmentList"];

export type SearchHit = Schemas["SearchHit"];

/** GET /api/v1/search?q= (proposed). A sha256 digest finds manifests and files. */
export type SearchResult = Schemas["SearchResult"];

/** GET /api/v1/registries (proposed; system resource, admin only). */
export type Registry = Schemas["Registry"];

/** provider.Capabilities (internal/provider/provider.go). */
export type Capabilities = Registry["capabilities"];

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

/** An open publication session (proposed): maven deploys file by file until
 * maven-metadata.xml. */
export type PublishSession = Schemas["PublishSession"];

/** GET …/repos/{format}/{repo}/reindex: the latest run that covered the repo. */
export type ReindexRun = Schemas["ReindexRun"];

/** The repo's part of a run's report. The server's openapi.yaml names two of its fields; the
 * others, proposed, are those docs/api.md shows (lajstrom/lajstrom#1128). */
export type ReindexReport = NonNullable<ReindexRun["report"]>;
