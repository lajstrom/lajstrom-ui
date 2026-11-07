<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-wordmark-dark.svg">
  <img alt="Lajstrom" src="docs/assets/logo-wordmark.svg" width="308" height="64">
</picture>

# Lajstrom UI

The web UI of [Lajstrom](https://github.com/lajstrom/lajstrom), an artifact registry on top of
any OCI registry. A static single-page app in its own repository and its own container images;
it talks to the server only through `/api/v1`.

**Status: prototype on mock data.** The server does not serve the read API yet, so the UI runs
against a mock of `/api/v1` (MSW, in the browser) built from the server's specs. The endpoints
it needs are proposed in [docs/api-proposal.md](docs/api-proposal.md), for a `contract` issue in
the server repository. Why this is a separate repository: [ADR 0001](docs/adr/0001-web-ui-in-its-own-repository.md).

## Requirements

- No server-side rendering: a fully static build; all data comes from API calls in the browser.
- Without a backend the UI still renders: on mock data, for now.
- Separate images for dev, test and prod (not built yet; see [Not done yet](#not-done-yet)).

## What is in it

- **Repositories**: every repo you can read, by format, with sizes, access and last publish.
- **A repository**: packages with search, sorting and the format's filters (apt suite,
  component, architecture; maven packaging), a file tree for raw repos, a "connect a client"
  page with copyable snippets for pip, uv, twine, apt (sources.list, deb822, auth.conf), Maven,
  Gradle, curl and oras, the repo's policy, index state and signing keys, and for maintainers the
  last reindex report (with foreign manifests), open maven deploy sessions and deploy tokens.
- **A package**: versions grouped with their variants (architectures, wheel tags), install
  snippets, what the metadata layer says.
- **A version**: files with digests and download URLs, install and `oras`/`cosign` snippets,
  signatures, SBOMs and attestations (OCI referrers), the metadata layer, the manifest
  annotations and the raw OCI manifest.
- **Search** (<kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd> / <kbd>/</kbd>): packages and repos; paste a
  `sha256` digest to find the manifest or file it belongs to.
- **Admin pages**: registries with their capabilities and health, the audit log, and a read-only
  preview of users, tokens and bindings.
- Every screen state is in the URL (`/ui/apt/ubuntu-internal?suite=jammy&arch=arm64`), so a link
  shows the same view. Light and dark theme.

In mock mode the user menu switches between three personas, to see how the UI follows RBAC:
`admin` (admin on `*/*`), `alice` (reader on `*/*`, writer on `*/payments`) and `anonymous`
(anonymous-read repos only).

## Run it

Node 22.12 or newer.

```sh
npm ci
npm run dev            # http://localhost:5173/ui/, on mock data (public/config.json)
npm run check          # typecheck, lint, tests, production build
```

Against a running Lajstrom, set `"mock": false` in `public/config.json`; the dev server forwards
`/api` and `/-` to `LAJSTROM_API_UPSTREAM` (default `http://localhost:8080`).

## Container image

```sh
docker build -t ghcr.io/lajstrom/lajstrom-ui:dev .
docker run --rm -p 8081:8080 -e LAJSTROM_UI_MOCK=true ghcr.io/lajstrom/lajstrom-ui:dev
# http://localhost:8081/ui/
```

nginx (unprivileged, uid 101, port 8080) serves the build below `/ui/`. It writes only to
`/tmp`, so the root filesystem can be read-only. At start, `docker/40-lajstrom-ui.sh` writes the
runtime configuration from these variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `LAJSTROM_UI_MOCK` | `false` | `true`: generated data from the mock, no server needed |
| `LAJSTROM_UI_API_URL` | empty | Base URL of the API as the browser sees it; empty = same origin |
| `LAJSTROM_UI_TITLE` | `Lajstrom` | Instance name in the header and the title |
| `LAJSTROM_API_UPSTREAM` | empty | `http://lajstrom:8080`: this nginx proxies `/api/` and `/-/` (use without an Ingress) |

`/healthz` answers `ok` for probes. Responses carry a Content-Security-Policy without inline
scripts, `X-Frame-Options: DENY` and `nosniff`.

### From other devices on the local network

`docker run -p 8081:8080 …` listens on every interface, so a phone or a laptop on the same
network opens `http://<ip-of-this-machine>:8081/ui/` (macOS: `ipconfig getifaddr en0`, or the
Bonjour name `http://<LocalHostName>.local:8081/ui/`). For the dev server with hot reload:
`npm run dev -- --host`, then port 5173.

On macOS 15 and later the app that serves (Docker Desktop, or the terminal running the dev
server) needs the **Local Network** permission (System Settings → Privacy & Security → Local
Network); without it other devices get `ERR_ADDRESS_UNREACHABLE` or a request that hangs.

Plain `http://` to an IP is not a secure context: browsers offer neither service workers nor the
Clipboard API there. The mock still works, because MSW falls back to intercepting `fetch` in the
page, and copy buttons fall back to a hidden textarea. Each device generates its own mock data;
the persona and the theme are kept per browser.

## Kubernetes

[deploy/k8s/lajstrom-ui.yaml](deploy/k8s/lajstrom-ui.yaml): a Deployment (2 replicas,
non-root, read-only root filesystem), a Service, and an Ingress that sends `/ui` to the UI and
everything else to the Lajstrom server on the same host. One origin means no CORS and, later,
one cookie for the browser session. [deploy/compose.yaml](deploy/compose.yaml) runs the image
alone.

## Layout

```
src/
  api/          types of /api/v1, fetch client, TanStack Query options
  app/          bootstrap, runtime config, router, shell (header, menus), command palette, theme
  pages/        one file per screen; package-model.ts groups versions and builds breadcrumbs
  components/   shared pieces; ui/ holds the primitives (button, table, tooltip, …)
  lib/
    formats/    one module per format: labels, snippets, file roles, metadata fields
    profile.ts  Escape, EscapeComponent, tags and package paths (manifest profile §4)
  mocks/        the mock API: handlers, an in-memory "server" (db.ts), seed data per format
docker/         nginx.conf and the start script of the image
deploy/         Kubernetes and compose examples
docs/           the API proposal and the ADRs of the UI
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
  by environment variables exists today. What differs between them is still open.
- **Login**: the browser session of api-proposal.md §5; management screens (create repos,
  tokens, bindings) come after it.
- **Real API**: switching `mock` off shows what the server does not implement yet.
- Code splitting per page (the main chunk is about 190 KiB gzipped).

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md): every commit is signed off (DCO), contributors sign the
[CLA](https://github.com/lajstrom/lajstrom/blob/main/CLA.md) once, AI assistance is disclosed with an `Assisted-by:` trailer. Security issues:
[SECURITY.md](https://github.com/lajstrom/lajstrom/blob/main/SECURITY.md).

Lajstrom UI is licensed under the [Apache License 2.0](LICENSE). Copyright 2026 The Lajstrom Authors.
