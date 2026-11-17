# Proposal: what the web UI reads from `/api/v1` that the server does not answer yet

- Status: the server answers all of it but an OIDC user's groups (§2.8) and the issuers of the
  CI trust policies (§2.9), since lajstrom/lajstrom@6c5bf5c, in the shapes its
  `internal/api/openapi.yaml` gives, which are the contract (lajstrom/lajstrom-ui#2). Each part was an issue labelled `contract` in lajstrom/lajstrom,
  named below.
- Shapes: [`openapi/proposed.yaml`](../openapi/proposed.yaml), additions to the server's OpenAPI
  description. `npm run gen:api` merges the two into [`public/openapi.yaml`](../public/openapi.yaml),
  where each addition is marked `x-lajstrom-status: proposed`: the API page of the demo shows it.
- Implemented by: the mock in [`src/mocks/`](../src/mocks/). The UI's types are generated from
  the merged spec (`src/api/openapi.gen.ts`), so a proposed field is optional on a server's
  schema, as the UI must treat it.
- Related: [ADR 0001](adr/0001-web-ui-in-its-own-repository.md); lajstrom/lajstrom#70, the UI.

## 1. Why

The server's `/api/v1` had the repos, their packages and versions, attachments, reindex runs,
users, bindings, tokens and the audit log. A list that says what a package is, a search box and
the admin's view of registries needed more, and the protocol frontends serve it only in each
format's own shape (apt `Packages`, pypi simple pages, `maven-metadata.xml`), which the UI should
not parse.

## 2. Endpoints and fields

| What | Issue | Where the server has it | How it differs from what was proposed |
| --- | --- | --- | --- |
| The repo's counts, the caller's permissions, apt signing keys | lajstrom/lajstrom#957 | `Repo`: `stats`, `permissions`, `signingKeys` | No reindex state on the repo: `GET …/reindex` has it, for whoever manages the repo; `stats.lastPublishedAt` |
| The facts of a package row, filters, facets, sorting | lajstrom/lajstrom#955, lajstrom/lajstrom#954 | `Package`, `PackageList`; `attr`, `sort`, `order`, `facet` on `listPackages` | Attributes by their full key (`lajstrom.deb.suite`), in `attr` too; facets only for the keys asked with `facet`; no `dir`: `prefix=<dir>/` lists a raw directory's subtree, which the UI shows a level at a time; `latestVersion` is what the format's client installs, `lastPublished` the newest |
| One package | lajstrom/lajstrom#958 | `GET …/packages/{name}`, `PackageDetail` | |
| The facts of a variant in the version list | lajstrom/lajstrom#1132 | `Variant`: `artifactType`, `attrs`, `size`, `fileCount`, `degraded`, `attachments` | `attachments` counts six kinds, as `…/attachments?kind=` lists them, for `referrers` |
| A version's manifest and annotations | lajstrom/lajstrom#951 | `GET …/versions/{version}/manifest` and `…/referrers` | Endpoints of their own, not fields of `VariantDetail`; the annotations are the manifest's |
| A maven repo's open deploys | lajstrom/lajstrom#960 | `GET …/sessions`, `Session` | Needs `manage`; only open sessions, without a state |
| Search | lajstrom/lajstrom#956 | `GET /api/v1/search`, `SearchResult` | No `total`: pages with `next`; a file hit is `matched: "file"` with `file` |
| The registries, their capabilities and health | lajstrom/lajstrom#952, lajstrom/lajstrom#953 | `GET /api/v1/registries`, `Registry` | `vendor` for `product`; four support tiers with `hosted`; capabilities null before a probe; the status is the answering replica's, with its circuit breaker |
| Every token, for the admin | lajstrom/lajstrom#959 | `GET /api/v1/tokens` | |
| An OIDC user's kind and groups | none yet; OIDC is lajstrom/lajstrom#69 | `User.kind` `oidc` | `groups` is still proposed (§2.8) |

### 2.8 An OIDC user

The server makes a user of `kind` `oidc` at the first OIDC login of an identity (rbac.md §8).
Its groups, those of its latest login that count now, are in whoami for the caller and nowhere
for the admin, who binds groups and should see which users a group's bindings reach: the user
resource gets `groups`, absent for a local user, as whoami has it.

### 2.9 The issuers of the CI trust policies

A CI trust policy names an issuer of the server's `auth.ci.issuers`, and may name only the claims
of that issuer's platform, GitHub's or GitLab's (rbac.md §11). `GET /api/v1/ci/policies` lists the
policies but not the issuers, so a form of a policy can neither offer the issuers nor know which
claims to offer. The list gets `issuers`, `[{name, platform}]` in the configuration's order: the
admin reads it already, and the names and platforms are no secret of the configuration (its
issuer URLs, audiences and CA files stay out). Without it the UI offers the issuer names its
policies use, takes the platform from the ids their claims name, and else lets the person pick
the platform of the hints; the server refuses a wrong issuer or claim with `400` naming it.

One thing outside the description: a UI on another origin than the server's (`server.corsOrigins`)
cannot read an `ETag`, nor send `If-Match`, because the server's CORS answers expose and allow
neither. It then changes a policy without a condition, and cannot approve one at all, since an
approval requires `If-Match`. `Access-Control-Expose-Headers` would need `ETag`, and
`Access-Control-Allow-Headers` `If-Match`.

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

None: the mock answers the server's shapes, on generated data.

## 5. Browser session

Settled: the UI talks to `/api/v1` with tokens in a header, never cookies, and needs no endpoint
of its own (the server's ADR 0022). Signing in with a password, or through the server's OIDC
login, is `POST /api/v1/login` with a DPoP proof (RFC 9449) of a P-256 key that the browser makes
with WebCrypto, non-extractable, and keeps in IndexedDB. The server answers a personal access
token bound to that key (`tokenType: "DPoP"`, `dpopJkt`), living `info.login.tokenLifetime`
(12 hours by default), without refresh. The UI sends it as `Authorization: DPoP` with a new proof
in `DPoP` on every request: `htm`, `htu` (the URL without query, so `apiBaseUrl` must be the
server's `server.externalURL`), `iat`, `ath` and a new `jti`. The server sends no nonce: a proof
refused for its `iat` is signed again by the server's clock, from the `Date` of the refusal.
OIDC hands the UI a code:
`/-/oidc/login?return_to=&code_challenge=&code_challenge_method=S256&dpop_jkt=` returns to the
sign-in page with `#code=…`, which the UI redeems at `POST /api/v1/login` with its PKCE
verifier, kept in `sessionStorage`. Signing out revokes the token (`DELETE …/tokens/{id}`) and
forgets the key.

With `info.login.idleTimeout` (seconds, `0` or absent when off; the server's
`auth.login.idleTimeout`), a token unused that long is refused, `401` with
`WWW-Authenticate: DPoP error="invalid_token", error_description="idle"`, and revoked. Every
request with the token is a use, so the UI makes none on its own while nobody touches it: polls
and refetches stop a minute after the last key or pointer event in any tab, and resume with the
next. It counts the idle time from its last request with the token in any tab
(`localStorage`), warns two minutes before a minute short of the bound (the server keeps the
last use to the minute), signs out there, and says why on the sign-in page; so does a refusal
with `error_description="idle"`.

A server without `login` in `GET /api/v1/info` gets the token created with the password
(`POST /api/v1/users/{user}/tokens` with Basic credentials, 12 hours) and sent as
`Authorization: Bearer`. A user can also sign in with a personal access token they already have,
a bearer too; signing out then forgets it without revoking it. The sign-in page offers the modes
of `info.authModes`. The token is kept in `localStorage`, shared by the UI's tabs; the image's
Content-Security-Policy allows no inline or foreign scripts. Requests go out with
`credentials: "omit"`, so a `401` with the Basic challenge never opens the browser's own login
dialog.
