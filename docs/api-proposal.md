# Proposal: the `/api/v1` read endpoints the web UI needs

- Status: draft for an issue labelled `contract` in lajstrom/lajstrom (changes
  [`docs/spec/http-routing.md`](https://github.com/lajstrom/lajstrom/blob/main/docs/spec/http-routing.md) §4).
- Implemented by: the mock in [`src/mocks/`](../src/mocks/) (MSW handlers and data);
  TypeScript shapes in [`src/api/types.ts`](../src/api/types.ts).
- Related: [ADR 0001](adr/0001-web-ui-in-its-own-repository.md), lajstrom/lajstrom P-07 (#70), M2-09 (#47).

## 1. Why

`http-routing.md` §4 lists the management resources (repos, users, tokens, bindings, audit,
whoami) and leaves their shapes to M2-09. A browser UI needs to *read* what is in a repository,
and nothing in the plan serves that: no listing of packages, versions, files or referrers, no
search, no server information. The protocol frontends serve that data, but each in its own
format (apt `Packages`, pypi simple pages, `maven-metadata.xml`); the UI should not parse them.

Everything below is served from the index database (the derived tables), except the manifest
and the referrers of one version (§3.7).

## 2. Conventions

- JSON keys in camelCase, as in the configuration and `repos.policy`. Format metadata keeps its
  own spelling (pypi core metadata is snake_case, deb control fields are `Installed-Size`).
- Times RFC 3339 UTC; digests `sha256:<hex>`; sizes in bytes.
- Errors: the envelope of §4, `{"error": {"code": "NOT_FOUND|CONFLICT|FORBIDDEN|INVALID|UNAVAILABLE", "message": "…"}}`.
- Lists: `limit` (default 50, at most 200) and an opaque `cursor`, as M2-09 says; responses carry
  `total`, `limit`, `next` and `prev` (cursors or `null`). `total` lets the UI say "51–100 of 312".
- Path segments are percent-encoded by the client. A raw package name is a path
  (`installers/acme-agent/2.5.0/SHA256SUMS` → `installers%2Facme-agent%2F2.5.0%2FSHA256SUMS`);
  Go 1.22 `ServeMux` matches the escaped path, so `%2F` stays inside one `{name}` segment and
  `PathValue` returns it unescaped. Proxies must pass the URI unchanged (nginx: `proxy_pass`
  without a URI part).
- Authorization: the read endpoints need `read` on the repo and list only what the caller can
  read; a repo the caller cannot read is `404`, as everywhere (rbac.md §3). System resources
  (`registries`, `audit`, `users`, `bindings`, all `tokens`) need `admin`. See open question 1.

## 3. Endpoints

| Method and path | New? | Needs | Response |
| --- | --- | --- | --- |
| `GET /api/v1/info` | new | nothing | `ServerInfo` |
| `GET /api/v1/whoami` | in §4 | nothing | `WhoAmI` |
| `GET /api/v1/repos?format=` | in §4, shape new | read (filters) | `{repos: Repo[]}` |
| `GET /api/v1/repos/{format}/{repo}` | in §4, shape new | read | `Repo` |
| `GET /api/v1/repos/{format}/{repo}/packages` | new | read | `PackageList` |
| `GET /api/v1/repos/{format}/{repo}/packages/{name}` | new | read | `PackageDetail` |
| `GET /api/v1/repos/{format}/{repo}/packages/{name}/versions` | new | read | `{versions: VersionSummary[]}` |
| `GET /api/v1/repos/{format}/{repo}/packages/{name}/versions/{digest}` | new | read | `VersionDetail` |
| `GET /api/v1/repos/{format}/{repo}/reindex` | new (M1-06 "poll with GET") | manage | `ReindexReport` |
| `GET /api/v1/repos/{format}/{repo}/sessions` | new | read | `{sessions: PublishSession[]}` |
| `GET /api/v1/repos/{format}/{repo}/deploy-tokens` | in §4 | manage | `{tokens: Token[]}` |
| `GET /api/v1/search?q=&format=&limit=` | new | read (filters) | `SearchResult` |
| `GET /api/v1/registries` | new | admin | `{registries: Registry[]}` |
| `GET /api/v1/audit?repo=&principal=&action=&since=&until=&cursor=` | in §4 | admin | `AuditPage` |
| `GET /api/v1/users`, `GET /api/v1/bindings` | in §4 | admin | `{users}`, `{bindings}` |
| `GET /api/v1/tokens` | new | admin | `{tokens: Token[]}`: every token, for the access page |

### 3.1 `GET /api/v1/info`

What the UI needs before anything else: the external URL its snippets are built from, the
server-wide anonymous-read switch, and the enabled formats.

```json
{
  "version": "v0.1.0", "commit": "28bf6ca", "date": "2026-12-04T12:00:00Z",
  "externalURL": "https://art.example.com",
  "anonymousRead": true,
  "formats": [{ "name": "apt", "artifactType": "application/vnd.lajstrom.deb.v1" }]
}
```

### 3.2 `Repo`

The `repos` row plus what the list and the header of a repo page show, so the UI makes one call
per page: `stats` (aggregates over the derived tables), `permissions` (the caller's actions on
this repo, from the RBAC evaluator), `reindex` (M1-06/M1-07 status) and, for apt, the signing
keys (M2-03; public fingerprints only).

```json
{
  "format": "apt", "name": "ubuntu-internal", "kind": "hosted", "registry": "ecr-prod",
  "prefix": "apt/ubuntu-internal", "anonymousRead": true,
  "policy": { "blobRedirect": "auto" },
  "createdAt": "…", "updatedAt": "…",
  "stats": { "packages": 8, "versions": 13, "manifests": 21, "files": 21, "size": 116391424, "lastPushAt": "…" },
  "permissions": ["read", "write", "delete", "manage"],
  "reindex": { "state": "idle", "startedAt": "…", "finishedAt": "…", "errors": 0, "nextReconcileAt": "…" },
  "signingKeys": [{ "algorithm": "ed25519", "fingerprint": "…", "createdAt": "…", "retiredAt": null }]
}
```

### 3.3 Packages

`GET …/packages?q=&attr=deb.suite:jammy&attr=deb.arch:amd64&sort=name|updated|versions|size&order=asc|desc&dir=&limit=&cursor=`

- `q` matches the name and the one-line summary, case-insensitively.
- `attr` filters on `versions.attrs` (`lajstrom.<format>.*` without the prefix); a package
  matches when any of its manifests matches. Repeat for several attributes.
- `dir` (raw only) lists one directory: the files directly in it as `packages`, its
  subdirectories as `directories` with file counts and sizes.
- `facets`: for the filter keys of the format (apt: `deb.suite`, `deb.component`, `deb.arch`;
  maven: `maven.packaging`), the values present in the whole repo with package counts.

A row (`PackageSummary`) has `name`, `nameOci`, `latestVersion`, `versions` (distinct),
`manifests`, `latestVariants`, `size`, `summary`, `attrs` (of the newest manifest),
`createdAt`, `updatedAt`. `summary` is one line from the metadata layer (pypi `summary`, deb
`Description`, maven POM `description`); it can be a derived column of `packages`, rebuilt by
reindex.

### 3.4 Versions

`GET …/packages/{name}/versions` returns every manifest of the package, newest first: one row
per (version, variant), so a pypi release with five wheels is five rows. The UI groups them.
Rows carry `tag`, `digest`, `attrs`, `size`, `fileCount`, `uploadedBy`
(`lajstrom.uploaded-by`), `referrers` counts (`signatures`, `sboms`, `attestations`) and
`degraded` (no readable metadata layer; manifest-profile.md §2).

### 3.5 One version

`GET …/versions/{digest}` adds `files` (with the protocol `path` a client downloads from),
`metadata` (the metadata layer), `annotations`, the `manifest` itself, `referrerList` and
`ociReference`. The manifest and the referrers come from the registry through the provider; a
manifest never changes, so the server can cache it by digest.

### 3.6 Search

`GET /api/v1/search?q=&format=&limit=` over the repos the caller can read: package names
(exact, then prefix, then substring, then summary). A `sha256:` digest, or 8 or more hex
digits, matches manifest digests and file layer digests by prefix, which answers "which package
is this blob from?" from a CI log or a scanner report.

### 3.7 What is not derived

`VersionDetail.manifest`, `annotations` and `referrerList`, and `Registry.status`, are read
live; everything else comes from the index database.

## 4. Mock-only parts

The mock fills these with plausible values; the real shapes are open:

- audit actions beyond `push`, `delete`, `repo.create`, `token.create` (index-schema.md): the
  mock adds `repo.update`, `repo.reindex`, `token.revoke`, `binding.create`, `user.create`,
  `user.disable`, `key.rotate`, following `<resource>.<verb>`;
- the key of the maven session expiry policy (`maven.sessionExpiry`: `seal` or `abort`);
- the fields of the reindex report (`ociRepositories`, `manifests`, `added`, `updated`,
  `removed`, `degraded`, `foreign[]`);
- registry `status` and `support` (the M1-12 tiers: `ci`, `manual`, `untested`).

## 5. Browser session (needed before management screens)

The API takes Basic or a PAT bearer. A browser should not keep a token in JavaScript. Proposal:
`POST /api/v1/session` with a user and password (or a PAT) sets an `HttpOnly; Secure;
SameSite=Strict` cookie with a short lifetime; `DELETE /api/v1/session` ends it; mutations with
the cookie also require a custom header (`X-Lajstrom-Client: ui`) as CSRF protection. OIDC login
(P-06) later replaces the password form, not the cookie.

## 6. Open questions for the lead

1. M2-07 says every `/api/v1` call needs `manage` or `admin`, rbac.md §2 says `read` covers
   "list in `/api/v1/repos`". This proposal takes rbac.md's side for the read endpoints.
2. Cursor pagination (M2-09) against `AuditFilter`'s `Limit`/`Offset` in the code: the cursor
   can encode an offset, as the mock does.
3. Should `VersionDetail` embed the manifest (one registry call per detail view) or should it be
   a separate `…/versions/{digest}/manifest`?
4. Does `GET /api/v1/registries` belong in the API at all, given registries are configuration?
   The UI shows capabilities and health; `/-/readyz` details could serve that instead.
