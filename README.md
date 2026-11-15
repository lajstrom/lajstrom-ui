<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-wordmark-dark.svg">
  <img alt="Lajstrom" src="docs/assets/logo-wordmark.svg" width="308" height="64">
</picture>

# Lajstrom UI

The web UI of [Lajstrom](https://github.com/lajstrom/lajstrom), an artifact registry on top of
any OCI registry. A static single-page app in its own repository and its own container images;
it talks to the server only through `/api/v1`.

**Status: prototype.** Against a server it shows what the server serves today (repositories,
who you are, personal and deploy tokens) and says plainly where the server has no endpoint yet.
Everything else runs in the [demo](#demo), on a mock of `/api/v1` in the browser built from the
server's specs. The read endpoints the UI needs are proposed in
[docs/api-proposal.md](docs/api-proposal.md). Why this is a separate repository:
[ADR 0001](docs/adr/0001-web-ui-in-its-own-repository.md).

## Requirements

- No server-side rendering: a fully static build; all data comes from API calls in the browser.
- Without a backend the UI still works: in the demo, on data generated in the browser.
- Separate images for dev, test and prod (not built yet; see [Not done yet](#not-done-yet)).

## What is in it

- **Repositories**: every repo you can read, by format, with sizes, access and last publish.
- **A repository**: packages with search, sorting and the format's filters (apt suite,
  component, architecture; maven packaging), a file tree for raw repos, a "connect a client"
  page with copyable snippets for pip, uv, twine, apt (sources.list, deb822, auth.conf), Maven,
  Gradle, npm, pnpm and yarn (`.npmrc`, a scoped registry, `.yarnrc.yml`), dnf, yum and zypper
  (a `.repo` file with the repo's key), curl and oras, the repo's policy, index state and signing
  keys, and for maintainers the last reindex report (its counts, and the errors, drift, split
  packages, versions of unknown OCI repositories, foreign manifests and orphans it found), open
  maven deploy sessions and deploy tokens. A format this UI does not know yet shows its packages,
  versions and files, without snippets.
- **Proxy and group repos**: the kind in the list and the header; a proxy's upstream (its TTLs,
  offline, the names it mirrors and refuses), and for maintainers a purge of its cache and a
  prefetch of names or images with a result for each; a group's members in order, each linked,
  with its merged names or, for `oci`, the paths each member serves. Neither shows publish
  snippets.
- **A package**: versions grouped with their variants (architectures, wheel tags), npm's
  dist-tags on the versions they name, install snippets, what the metadata layer says.
- **A version**: files with digests and download URLs, install and `oras`/`cosign` snippets,
  signatures, SBOMs and attestations (OCI referrers), the metadata layer, the manifest
  annotations and the raw OCI manifest.
- **Search** (<kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd> / <kbd>/</kbd>): packages and repos; paste a
  `sha256` digest to find the manifest or file it belongs to.
- **Admin pages**: registries with their capabilities and health, the audit log, every token,
  and users and bindings: create, disable, rename and delete users and set their passwords, bind
  users and OIDC groups to roles on repo masks; a user's page has its bindings and its tokens,
  which the admin may revoke.
- **Sign-in** with a password, which creates a personal access token for the browser (12 hours,
  revoked on sign-out), or with a token you already have. Requests carry it as
  `Authorization: Bearer`; there are no cookies.
- **The first admin** of a new server: "Set up the first admin", linked from the sign-in page,
  exchanges the server's one-time bootstrap token for the first admin with a name and a password,
  then signs in as it.
- **Tokens**: your personal access tokens and a repository's deploy tokens: create one, copy the
  secret the one time it is shown, revoke.
- **Webhooks**: a repository's on its Webhooks tab, for whoever manages it, and those of every
  mask (`oci/*`, `*/*`) on an admin page: create one and copy its secret the one time it is
  shown, change its URL and events, turn it on or off, give it a new secret, send a ping, and
  read its delivery log.
- Every screen state is in the URL (`/ui/apt/ubuntu-internal?suite=jammy&arch=arm64`), so a link
  shows the same view. Light and dark theme.

## Demo

The demo is the whole UI on generated data: a mock of `/api/v1` answers in the browser (a
service worker, MSW), and what you change there, such as tokens, is kept in this browser's
`localStorage`. Nothing reaches a server. It opens at the sign-in page, like the tool behind
its login will: the accounts are `admin` / `admin`, `alice` / `alice`, `bob` / `bob` and
`carol` / `carol` (the password is the name), each with the bindings of the demo's data, so
signing in as another one shows how the UI follows them. The sign-in page lists them; a click
fills the form.

"Set up the first admin" works in the demo too. A real server with an admin answers `404` to the
bootstrap; the demo's server takes its token, `lajstrom-demo-bootstrap-token-0f1e2d3c4b5a6978`,
once, as a new server would, for a first admin next to the accounts above, then answers `404`.
"Reset data" makes the token valid again.

- Next to a server, "Open the demo" on the sign-in page, "See it in the demo" where the server
  has no endpoint yet, or `/ui/?demo=1` enter it; "Exit demo" or `?demo=0` go back. The real
  session is kept apart and is still there afterwards.
- "Reset data" starts the demo over.
- **API** in the header: `/api/v1` in Swagger UI, from [public/openapi.yaml](public/openapi.yaml):
  the server's description and, marked `proposed`, what the UI needs from it
  ([openapi/proposed.yaml](openapi/proposed.yaml)). "Try it out" is answered by the demo as the
  signed-in user, errors included (try deleting `raw/scratch`). `src/mocks/openapi.test.ts`
  keeps the description and the mock's routes the same, both ways, but for the server's
  operations it lists as not answered yet. Against a server, the page shows the server's own
  description, `GET /api/v1/openapi.yaml`.
- **Seeing the requests.** The mock answers through a service worker, so every request of the
  UI and of Swagger shows in the Network panel of the developer tools, with its answer, and each
  one is also logged in the console. Over plain `http://` to an IP or a `.local` name browsers
  allow no service worker; the mock then answers inside the page, and the requests show in the
  console only. For the Network panel there too, open the UI as `http://localhost` (for example
  `ssh -L 8081:localhost:8081 <machine>`), or add the origin to Chrome's
  `chrome://flags/#unsafely-treat-insecure-origin-as-secure`.
- `"mock": true` in `config.json` (`LAJSTROM_UI_MOCK=true`) makes the demo the only mode, for a
  deployment without a server; `"demo": false` (`LAJSTROM_UI_DEMO=false`) stops offering it.

## Run it

Node 22.12 or newer.

```sh
npm ci
npm run dev            # http://localhost:5173/ui/, the demo (public/config.json)
npm run check          # typecheck, lint, tests, production build
```

Against a running Lajstrom:

```sh
LAJSTROM_UI_MOCK=false LAJSTROM_API_UPSTREAM=http://localhost:8080 npm run dev
```

The dev server forwards `/api` and `/-` to the server, so the browser sees one origin: the server
does not answer cross-origin requests. `LAJSTROM_UI_DEMO=false` hides the demo.

`npm run e2e` runs the UI image against a real server and opens every screen in a browser
([e2e/README.md](e2e/README.md)). CI does it on every pull request, against the server's commit
of `openapi/server.yaml`, and every night against the server's main.

## The demo on GitHub Pages

The demo is a static site: no server, nothing to run. `npm run build:pages` builds it into
`dist/pages`, below `LAJSTROM_UI_BASE` (default `/lajstrom-ui/`, the path of the project site
`https://<owner>.github.io/lajstrom-ui/`), with `config.json` set to the demo only, a
`404.html` so that links into the app open, and `.nojekyll`. Any static hosting with HTTPS takes
the same files; over HTTPS the service worker runs, so the requests show in the Network panel.

[.github/workflows/pages.yml](.github/workflows/pages.yml) publishes it on every push to `main`
(or by hand); the repository needs Settings → Pages → Source: GitHub Actions, once.

## Container image

```sh
docker build -t ghcr.io/lajstrom/lajstrom-ui:dev .
docker run --rm -p 8081:8080 -e LAJSTROM_UI_MOCK=true ghcr.io/lajstrom/lajstrom-ui:dev
# http://localhost:8081/ui/
```

nginx (unprivileged, uid 101, port 8080) serves the build below `/ui/`. It writes only to
`/tmp`, so the root filesystem can be read-only. At start, `docker/40-lajstrom-ui.sh` writes the
runtime configuration, [config.json](#configuration), from these variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `LAJSTROM_UI_MOCK` | `false` | `true`: the demo only, on generated data; no server needed |
| `LAJSTROM_UI_DEMO` | `true` | `false`: do not offer the demo next to the server |
| `LAJSTROM_UI_API_URL` | empty | Base URL of the API as the browser sees it; empty = same origin |
| `LAJSTROM_UI_TITLE` | `Lajstrom` | Instance name in the header and the title |
| `LAJSTROM_UI_LOGO` | empty | The header's logo: a path relative to `/ui/`, an http(s) URL or a `data:image` URL; empty = Lajstrom's mark |
| `LAJSTROM_UI_COLOR` | empty | The primary colour, `#rgb` or `#rrggbb`; empty = Lajstrom's blue |
| `LAJSTROM_UI_COLOR_DARK` | `LAJSTROM_UI_COLOR` | The primary colour of the dark theme |
| `LAJSTROM_UI_SUPPORT_URL` | empty | Where to get help, http(s) or `mailto:`: in the about dialog and on the error pages |
| `LAJSTROM_UI_CONFIG` | `/etc/lajstrom-ui/config.json` | A `config.json` to serve as it is instead, such as a ConfigMap; the variables above are then not read |
| `LAJSTROM_API_UPSTREAM` | empty | `http://lajstrom:8080`: this nginx proxies `/api/` and `/-/` (use without an Ingress) |

A mounted `config.json` is served as it is, and a change of it shows on the next page load; its
`apiBaseUrl` and the origin of its logo go into the Content-Security-Policy at start, so a change
of those needs a restart. A logo of the image's own is mounted below `/usr/share/nginx/html/ui/`
and named relative to it, such as `branding/logo.svg`.

`/healthz` answers `ok` for probes. Responses carry a Content-Security-Policy without inline
scripts, `X-Frame-Options: DENY` and `nosniff`.

### From other devices on the local network

`docker run -p 8081:8080 …` listens on every interface, so a phone or a laptop on the same
network opens `http://<ip-of-this-machine>:8081/ui/` (macOS: `ipconfig getifaddr en0`, or the
Bonjour name `http://<LocalHostName>.local:8081/ui/`). With a server running on the same machine,
let the image proxy the API, so that the browser sees one origin:

```sh
docker run -d -p 8081:8080 -e LAJSTROM_API_UPSTREAM=http://host.docker.internal:8080 ghcr.io/lajstrom/lajstrom-ui:dev
```

For the dev server with hot reload: `npm run dev -- --host` (with `LAJSTROM_UI_MOCK=false` and
`LAJSTROM_API_UPSTREAM` for a real server), then port 5173; it answers the `.local` name too.

On macOS 15 and later the app that serves (Docker Desktop, or the terminal running the dev
server) needs the **Local Network** permission (System Settings → Privacy & Security → Local
Network); without it other devices get `ERR_ADDRESS_UNREACHABLE` or a request that hangs.

Plain `http://` to an IP is not a secure context: browsers offer neither service workers nor the
Clipboard API there. The demo still works, because MSW falls back to intercepting `fetch` in the
page, and copy buttons fall back to a hidden textarea. Each device generates its own demo data;
what is done in the demo and the theme are kept per browser.

## Configuration

The UI reads `config.json` next to its `index.html` when it starts: the image writes it from
its variables or serves a mounted one (above); next to the tar.gz you write it yourself
([Deploying the bundle](#deploying-the-bundle)). Every key but `schema` may be left out:

```json
{
  "schema": 1,
  "apiBaseUrl": "",
  "mock": false,
  "demo": true,
  "branding": {
    "title": "Acme Artifacts",
    "logo": "branding/logo.svg",
    "colors": { "primary": "#c2410c", "primaryDark": "#fb923c" },
    "supportUrl": "mailto:platform@example.com"
  }
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `schema` | | `1`, the version of this file; required |
| `apiBaseUrl` | `""` | Base URL of the API, `https://…`; empty = the UI's own origin |
| `mock` | `false` | `true`: the demo only, on generated data; no server needed |
| `demo` | `true` | `false`: do not offer the demo next to the server |
| `branding.title` | `Lajstrom` | Instance name in the header, the sign-in page and the page title |
| `branding.logo` | `""` | The header's logo: a path relative to the bundle, an http(s) URL or a `data:image` URL; empty = Lajstrom's mark |
| `branding.colors.primary` | `""` | The primary colour, `#rgb` or `#rrggbb`, which buttons, links and focus rings take; empty = Lajstrom's blue |
| `branding.colors.primaryDark` | `primary` | The same for the dark theme; choose one that reads on a dark background |
| `branding.supportUrl` | `""` | Where to get help, http(s) or `mailto:`: in the about dialog and on the error pages |

The About dialog in the footer keeps naming Lajstrom and the versions of the UI and the server,
whatever the branding, for support.

The start-up never leaves the page blank:

- No `config.json` (a `404`, or the `index.html` that a static host answers instead) means the
  defaults. A file that is not JSON, has no `"schema": 1`, or a setting of the wrong kind
  renders a page that names the problem; a key that schema 1 does not have is a warning in the
  browser's console.
- Then, unless it runs the demo, the UI asks the server `GET {apiBaseUrl}/-/version`. No answer,
  an error status, or an answer that is not Lajstrom's renders a page with the URL and what came
  back, with "Try again" and, if the demo is offered, "Open the demo".
- A server older or newer than the API this UI was built for ([Compatibility](#compatibility))
  gets a warning under the header, and the UI goes on.
- If the UI's own scripts do not load, such as below a path that `<base href>` does not name,
  `index.html` says so after a few seconds.

## Kubernetes

[deploy/k8s/lajstrom-ui.yaml](deploy/k8s/lajstrom-ui.yaml): a Deployment (2 replicas,
non-root, read-only root filesystem), a Service, and an Ingress that sends `/ui` to the UI and
everything else to the Lajstrom server on the same host. One origin means no CORS, which the
server does not answer. [deploy/compose.yaml](deploy/compose.yaml) runs the image
alone.

## Releases

A tag `vX.Y.Z` releases the UI: [.github/workflows/release.yml](.github/workflows/release.yml)
builds one bundle and publishes it twice, as a tar.gz for any static origin and as the image.

| Artifact | Where |
| --- | --- |
| `lajstrom-ui-X.Y.Z.tar.gz`: one directory with `index.html`, `assets/`, `build.json` and the rest of the build, relative asset paths, no `config.json` | the GitHub release |
| `lajstrom-ui-X.Y.Z.tar.gz.sbom.json`, an SPDX SBOM of the npm packages in the bundle | the GitHub release |
| `checksums.txt` (SHA-256 of both) and `checksums.txt.sigstore.json`, its cosign bundle | the GitHub release |
| the image: the same files behind nginx, linux/amd64 and linux/arm64, with SBOM and provenance attestations, the bundle's SBOM as an attestation and a cosign signature | `ghcr.io/lajstrom/lajstrom-ui:vX.Y.Z`; `:latest` too on a stable version |

The signatures are keyless, as the server's: cosign gets a certificate for the identity of the
release workflow at the tag. A tag with a suffix (`v0.1.0-rc.1`) is a pre-release, without
`latest`. The notes list the changes since the previous stable tag.

Every build knows what it is and which server API it was built for. `build.json` next to
`index.html` says it (`curl https://<host>/ui/build.json`), and so do the About dialog (in the
footer), the image's label `io.lajstrom.ui.server-api` and the release notes:

```json
{
  "version": "v0.1.0",
  "commit": "8d05e41",
  "date": "2026-11-15T21:52:08Z",
  "contract": { "api": "v1", "serverCommit": "f0d887d5…", "serverVersion": "v0.0.1-959-gf0d887d" }
}
```

### Cutting a release

1. `main` is green, e2e included. For a stable version, vendor the server's API at the server
   release this UI is for: `npm run update:openapi -- vA.B.C`.
2. Tag and push the tag; the run takes about five minutes:

   ```sh
   TAG=v0.1.0-rc.1
   git switch main && git pull --ff-only
   git tag -a "$TAG" -m "$TAG" && git push origin "$TAG"
   gh run watch "$(gh run list --workflow release.yml --branch "$TAG" --limit 1 --json databaseId --jq '.[0].databaseId')"
   ```

3. Read the draft, `gh release view "$TAG" --web`: four assets and the server API it was built
   for. Add the version to [Compatibility](#compatibility).
4. The first release only: `gh api orgs/lajstrom/packages/container/lajstrom-ui --jq .visibility`
   prints `public`; otherwise make the package public in its settings.
5. Publish the draft: `gh release edit "$TAG" --draft=false`.

A failed run: rerun it. A published release keeps its tag; fix forward with the next version.

Every pull request and push to `main` runs the same workflow as a dry run. It builds the bundle,
tries the tar.gz at the root of a static origin and below `/ui/` of the image made of it, in
Chromium (`scripts/try-bundle.ts`), builds the image for both platforms, and keeps the bundle as
the run's artifact `release`. It pushes, signs and releases nothing. Locally:

```sh
npm run build:release                              # dist/release/, as the workflow builds it
node scripts/try-bundle.ts http://localhost:8081/  # a served bundle, with "mock": true
```

Verifying a release, with cosign 3:

```sh
TAG=v0.1.0-rc.1
ID="https://github.com/lajstrom/lajstrom-ui/.github/workflows/release.yml@refs/tags/${TAG}"
ISSUER=https://token.actions.githubusercontent.com
gh release download "$TAG" --repo lajstrom/lajstrom-ui --dir "$(mktemp -d)" && cd "$_"
cosign verify-blob checksums.txt --bundle checksums.txt.sigstore.json \
  --certificate-identity "$ID" --certificate-oidc-issuer "$ISSUER"
sha256sum -c checksums.txt   # shasum -a 256 -c on macOS
cosign verify "ghcr.io/lajstrom/lajstrom-ui:${TAG}" \
  --certificate-identity "$ID" --certificate-oidc-issuer "$ISSUER" > /dev/null
```

### Deploying the bundle

The bundle is static files whose paths are relative to `<base href="/">` in its `index.html`:
that one tag says where it lives, and the code finds the rest from where its files came. It
reads `config.json` next to `index.html`; without one it takes the defaults, the API on the
same origin. Answer `index.html` for a path below the bundle that has no file, so that links
into the app open; serve `config.json` and `index.html` with `Cache-Control: no-cache` and
`assets/` as immutable.

- **The image, below `/ui/`** behind the edge of Lajstrom ([Kubernetes](#kubernetes)): nothing
  to do. Its nginx serves `index.html` with `<base href="/ui/">` and writes `config.json` from
  the environment.
- **Below `/ui/` of a web server you run**, such as the edge itself: unpack the tar.gz into
  `<root>/ui/` and set the base as the image does, for nginx:

  ```nginx
  location /ui/ {
    try_files $uri /ui/index.html;
    sub_filter '<base href="/">' '<base href="/ui/">';
  }
  ```

  A server that cannot rewrite answers takes the tag changed once after unpacking:
  `sed -i 's|<base href="/">|<base href="/ui/">|' index.html`.
- **At the root of a static origin**, such as object storage behind a CDN: upload the files as
  they are, with `config.json`, and let the CDN answer a path without a file with `/index.html`
  and status 200. The base `/` is right there. An API on another origin needs CORS, which the
  server does not answer yet ([lajstrom/lajstrom#949](https://github.com/lajstrom/lajstrom/issues/949)):
  until then such a UI runs the demo (`"mock": true`), or the CDN also routes `/api/` and `/-/`
  to Lajstrom.

### Compatibility

The UI reads one major version of the server's API, `/api/v1`, and is built against the
server's `openapi.yaml` at one commit, `openapi/server.yaml`: that commit is its contract.
e2e runs the UI against the server at that commit on every pull request, and against the
server's main every night. Before 1.0 a minor version of the server may change the API, so a UI
release works with the server release that contains its contract and that release's patch
versions. Against an older server some screens say that the server has no endpoint yet.

| UI | Built for the server's API at | Works with |
| --- | --- | --- |
| `main` | lajstrom/lajstrom@f0d887d (v0.0.1-959-gf0d887d) | the server at that commit; its `main`, checked every night |

## Layout

```
src/
  api/          types of /api/v1 (openapi.gen.ts from public/openapi.yaml), fetch client, session
                and sign-in, queries and mutations; change.ts, how a change shows (ADR 0003)
  app/          bootstrap, runtime config, demo mode, router, shell (header, menus), palette, theme
  pages/        one file per screen; package-model.ts groups versions and builds breadcrumbs
  components/   shared pieces; ui/ holds the primitives (button, table, tooltip, …)
  lib/
    formats/    one module per format: labels, snippets, file roles, metadata fields
    profile.ts  Escape, EscapeComponent, tags and package paths (manifest profile §4)
  mocks/        the demo's API: handlers, authentication and tokens (auth.ts), an in-memory
                "server" (db.ts), seed data per format
openapi/        server.yaml: the server's OpenAPI description, vendored at a commit;
                proposed.yaml: what the UI adds to it (docs/api-proposal.md)
scripts/        vendoring it, generating public/openapi.yaml and src/api/openapi.gen.ts; the
                Pages build; the release bundle and its try in a browser
e2e/            the end-to-end test against a real server: the server and its packages
                (server.sh, fixtures.py), the screens in Playwright (*.e2e.ts)
docker/         nginx.conf and the start script of the image
deploy/         Kubernetes and compose examples
docs/           the API proposal and the ADRs of the UI
public/         config.json of the dev server, openapi.yaml (generated), the mock's service worker
```

## Relation to the server repository

Comments in the code cite the server's documents by path, such as
`docs/spec/manifest-profile.md §4.2`, `docs/spec/rbac.md` or `docs/architecture.md`; those are
files of [lajstrom/lajstrom](https://github.com/lajstrom/lajstrom/tree/main/docs), not of this
repository.

`src/lib/profile.ts` is a port of the server's `internal/oci/profile` naming rules, tested with
the same vectors; `src/mocks/data/profile-conformance.test.ts` checks every mock manifest against
the manifest profile. Digests in the mock are the real sha256 of the manifest JSON; times inside
manifests count back from the start of the UTC day, so digests stay the same across reloads
during a day.

## Stack and licenses

React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Router and Query, Radix primitives, cmdk,
lucide icons, MSW for the mock. Everything shipped to the browser is under a license from the
allowlist of [CONTRIBUTING.md](CONTRIBUTING.md#dependency-license-policy):

```sh
npx license-checker-rseidelsohn@5.0.1 --production --excludePrivatePackages \
  --onlyAllow 'Apache-2.0;MIT;BSD-2-Clause;BSD-3-Clause;ISC;MPL-2.0;Unlicense;CC0-1.0;0BSD'
```

The UI primitives are written for this project rather than copied from a component registry, so
the snippet scan has nothing to match.

## Not done yet

- **Images per environment**: dev, test and prod images are a requirement; one image configured
  by environment variables exists today. What differs between them is still open
  ([#16](https://github.com/lajstrom/lajstrom-ui/issues/16)). A release builds one tar.gz and
  one image of it; images per environment would be built from that same tar.gz in the release's
  job `publish`, so that no environment gets a bundle of its own.
- **Management screens** (repositories, users, bindings): after the read-only UI. The server's
  endpoints can be tried on the API page meanwhile.
- Code splitting per page (the main chunk is about 190 KiB gzipped).

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md): every commit is signed off (DCO), contributors sign the
[CLA](https://github.com/lajstrom/lajstrom/blob/main/CLA.md) once, AI assistance is disclosed with an `Assisted-by:` trailer. Security issues:
[SECURITY.md](https://github.com/lajstrom/lajstrom/blob/main/SECURITY.md).

Lajstrom UI is licensed under the [Apache License 2.0](LICENSE). Copyright 2026 The Lajstrom Authors.
