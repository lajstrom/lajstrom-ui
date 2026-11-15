# Proposal: what the web UI reads from `/api/v1` that the server does not answer yet

- Status: each part is an issue labelled `contract` in lajstrom/lajstrom, named below.
- Shapes: [`openapi/proposed.yaml`](../openapi/proposed.yaml), additions to the server's OpenAPI
  description. `npm run gen:api` merges the two into [`public/openapi.yaml`](../public/openapi.yaml),
  where each addition is marked `x-lajstrom-status: proposed`: the API page of the demo shows it.
- Implemented by: the mock in [`src/mocks/`](../src/mocks/); the types in
  [`src/api/types.ts`](../src/api/types.ts), where the proposed fields are optional on top of the
  server's types.
- Related: [ADR 0001](adr/0001-web-ui-in-its-own-repository.md); lajstrom/lajstrom#70, the UI.

## 1. Why

The server's `/api/v1` has the repos, their packages and versions, attachments, reindex runs,
users, bindings, tokens and the audit log. A list that says what a package is, a search box and
the admin's view of registries need more, and the protocol frontends serve it only in each
format's own shape (apt `Packages`, pypi simple pages, `maven-metadata.xml`), which the UI should
not parse.

Everything below comes from the index database, except a version's manifest and annotations
and a registry's status, which are read live (§2.5, §2.7).

The UI shows a proposed field or screen only when the server answers it: against today's
server, the package list has names and first publish times, the package page is built from the
versions, and the screens of the proposed endpoints say the server does not have them yet and
offer the demo.

## 2. Endpoints and fields

| What | Issue | In `openapi/proposed.yaml` |
| --- | --- | --- |
| The repo's counts, the caller's permissions, reindex state, apt signing keys | lajstrom/lajstrom#957 | `Repo`: `stats`, `permissions`, `reindex`, `signingKeys` |
| The facts of a package row, filters, facets, sorting, raw directories | lajstrom/lajstrom#955, #954 (summary) | `Package`, `PackageList`; `attr`, `sort`, `order`, `dir` on `listPackages` |
| One package | lajstrom/lajstrom#958 | `GET …/packages/{name}`, `PackageDetail` |
| The facts of a variant in the version list | none yet | `Variant`: `artifactType`, `attrs`, `size`, `fileCount`, `degraded`, `referrers` |
| A version's manifest and annotations | lajstrom/lajstrom#951 | `VariantDetail`: `manifest`, `annotations` |
| The report of a reindex run, as docs/api.md shows it | lajstrom/lajstrom#1128 | `ReindexRun.report` |
| A maven repo's open deploys | lajstrom/lajstrom#960 | `GET …/sessions`, `PublishSession` |
| Search | lajstrom/lajstrom#956 | `GET /api/v1/search`, `SearchResult` |
| The registries, their capabilities and health | lajstrom/lajstrom#952, #953 | `GET /api/v1/registries`, `Registry` |
| Every token, for the admin | lajstrom/lajstrom#959 | `GET /api/v1/tokens` |

### 2.1 The repo

The header of a repo page and the rows of the repo list in one call: `stats` (aggregates over
the derived tables), `permissions` (the caller's actions on the repo, from the RBAC evaluator,
so the UI does not offer what the server would refuse), `reindex` (reindex and reconcile state)
and, for apt, the signing keys (public fingerprints only).

### 2.2 The package list

- `attr` filters on `versions.attrs` (`lajstrom.<format>.*` without the prefix); a package
  matches when any of its manifests does. Repeat it for several attributes.
- `sort` and `order`: name, last update, size or number of versions.
- `dir` (raw only) lists one directory: the files directly in it as `packages`, its
  subdirectories as `directories` with file counts and sizes.
- `facets`: for the filter keys of the format (apt: `deb.suite`, `deb.component`, `deb.arch`;
  maven: `maven.packaging`), the values present in the whole repo with package counts. An answer
  with `facets` tells the UI that the server takes the parameters above.
- A row adds `nameOci`, `latestVersion`, `versions` (distinct), `manifests`, `latestVariants`,
  `size`, `summary`, `attrs` (of the newest manifest) and `updatedAt`. `summary` is one line from
  the metadata layer (pypi `summary`, deb `Description`, maven POM `name`); it can be a derived
  column of `packages`, rebuilt by reindex.

### 2.3 One package

The row's facts with the OCI repository and the newest manifest's metadata layer, for the header
of the package page. Without it, the UI derives the package from its versions and fetches the
newest version (`src/pages/package-model.ts`).

### 2.4 The variants of the version list

The version list names each variant's tag, digest and publish time. Its size, file count, format
attributes, whether it is degraded (no readable metadata layer: manifest-profile.md §2) and the
counts of its signatures, SBOMs and attestations let the version table show them without one
request per version.

### 2.5 A version's manifest

`GET …/versions/{version}` has the index's row of each variant. The manifest itself and its
annotations come from the registry through the provider; a manifest never changes, so the server
can cache it by digest. Without them the version page shows the `oras manifest fetch` command
that reads them.

### 2.6 Search

`GET /api/v1/search?q=&format=&limit=` over the repos the caller can read: package names (exact,
then prefix, then substring, then summary). A `sha256:` digest, or 8 or more hex digits, matches
manifest digests and file layer digests by prefix, which answers "which package is this blob
from?" from a CI log or a scanner report.

### 2.7 Registries

Admin only. The configured backends with the capabilities the provider detected, the support
tier of the product, the repos on each and a health check.

## 3. Conventions

- JSON keys in camelCase, as in the configuration and `repos.policy`. Format metadata keeps its
  own spelling (pypi core metadata is snake_case, deb control fields are `Installed-Size`).
- Lists page forward with the server's `limit` and opaque `cursor`, the answer's `next` naming
  the page after it.
- Path segments are percent-encoded by the client. A raw package name is a path
  (`installers/acme-agent/2.5.0/SHA256SUMS` → `installers%2Facme-agent%2F2.5.0%2FSHA256SUMS`);
  Go 1.22 `ServeMux` matches the escaped path, so `%2F` stays inside one `{name}` segment and
  `PathValue` returns it unescaped. Proxies must pass the URI unchanged (nginx: `proxy_pass`
  without a URI part).
- A repo the caller cannot read is `404`, as everywhere (rbac.md §3); `registries` and every
  `tokens` need `admin`.

## 4. Mock-only parts

The mock fills these with plausible values; the real shapes are open:

- registry `status` and `support` (the support tiers: `ci`, `manual`, `untested`).

## 5. Browser session

Settled: the UI talks to `/api/v1` with bearer tokens, never cookies, and needs no endpoint of its
own. Signing in with a password creates a personal access token for the browser
(`POST /api/v1/users/{user}/tokens` with Basic credentials, 12 hours), which the UI sends as
`Authorization: Bearer` from then on; signing out revokes it (`DELETE …/tokens/{id}`). A user can
also sign in with a personal access token they already have; signing out then forgets it without
revoking it. The token is kept in `localStorage`, shared by the UI's tabs; the image's
Content-Security-Policy allows no inline or foreign scripts. Requests go out with
`credentials: "omit"`, so a `401` with the Basic challenge never opens the browser's own login
dialog. OIDC login later replaces the password form, not the token.

## 6. Open questions

1. Should `VersionDetail` embed the manifest (one registry call per detail view) or should it be
   a separate `…/versions/{version}/manifest`? (lajstrom/lajstrom#951)
2. Does `GET /api/v1/registries` belong in the API at all, given registries are configuration?
   The UI shows capabilities and health; `/-/readyz` details could serve that instead.
   (lajstrom/lajstrom#952)
