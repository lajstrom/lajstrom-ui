# 0004. One image for every environment, its profile chosen at start

- Status: accepted
- Date: 2026-11-16
- Deciders: gecube

## Context

[ADR 0001](0001-web-ui-in-its-own-repository.md) set the requirement of separate images for dev,
test and prod and left open what differs between them
([#16](https://github.com/lajstrom/lajstrom-ui/issues/16)). Since then a release builds one
bundle, a tar.gz, and one image of it (`.github/workflows/release.yml`), and the bundle is never
built again for an environment
([lajstrom/lajstrom#70](https://github.com/lajstrom/lajstrom/issues/70)).

What could differ between environments: the demo and the mock, source maps, the
Content-Security-Policy, the default configuration and a log of the requests. None of it is in
the bundle. The browser reads `config.json`, and nginx serves the files with the headers that
`docker/40-lajstrom-ui.sh` writes at start. Today the image has the mock off, the demo offered
next to the server (`LAJSTROM_UI_DEMO` defaults to `true`), the source maps served and
`script-src 'self'`.

## Considered options

- **A. Three images, built from the one tar.gz in the job `publish`**: `lajstrom-ui:<tag>` for
  prod, `-test` and `-dev`, which differ in the defaults of their variables and in nginx's
  configuration. The prod image could leave out the source maps and the mock's service worker.
  But it is not the digest that was tried in test, and there are three images to build, sign,
  scan and describe with an SBOM. Leaving files out hides nothing either: the code is open, and
  the mock runs only in the visitor's browser and reaches nothing on the server.
- **B. One image, with a profile chosen at start**, `LAJSTROM_UI_PROFILE`: `prod` (the default),
  `test` or `dev`. The digest tried in test is the one that runs in prod, and there is one image
  to build, sign and scan. A wrong variable gives prod the defaults of another profile. The start
  log names the profile, and no profile turns on anything that reaches the server.
- **C. One image as today, with no profile**: every difference is a variable of its own. There
  are no named environments, every deployment copies its list of variables, and the requirement
  of three environments is not met.

## Decision

Option B. The image reads `LAJSTROM_UI_PROFILE` at start. The profile sets the defaults of the
variables and what nginx serves, and never changes the bundle:

| | `prod` (default) | `test` | `dev` |
| --- | --- | --- | --- |
| `LAJSTROM_UI_DEMO` default | `false` | `false` | `true` |
| `LAJSTROM_UI_MOCK` default | `false` | `false` | `false` |
| source maps (`/ui/assets/*.map`) | `404` | served | served |
| Content-Security-Policy | as today | as today | as today |

- A variable that is set wins over its profile's default: a prod instance that offers the demo
  sets `LAJSTROM_UI_DEMO=true`, and a demo-only instance on any profile sets
  `LAJSTROM_UI_MOCK=true`. The mock-only mode stays a choice of its own, because it ignores the
  server. A dev stand usually has one.
- With a mounted `config.json`, the file says everything the browser reads, and the profile
  decides only what nginx serves.
- Every profile gets the same strict Content-Security-Policy. Vite's dev server is not the
  image and needs no relaxation in it.
- No profile logs the requests. The browser's Network panel shows the calls to a server, and the
  mock logs its own. If a log is needed later, it is a field of `config.json`, not a build.
- Any other value of `LAJSTROM_UI_PROFILE` stops the start, as the other variables do. The start
  log names the profile.
- A release pushes one image per tag, `ghcr.io/lajstrom/lajstrom-ui:<tag>`. The tar.gz on a
  static origin, the Pages demo for one, has no profile: its `config.json` says what it wants.

## Consequences

- The requirement reads "one image; dev, test and prod are profiles of it". README.md, CLAUDE.md
  and ADR 0001 say so.
- An image that relied on the demo being offered by default gets `prod` and no demo. It sets
  `LAJSTROM_UI_DEMO=true` or `LAJSTROM_UI_PROFILE=dev`. The release notes of the version that
  brings the profile say so.
- A stack trace from prod is read with the source maps of the release's tar.gz, which has the
  same files as the image.
- The e2e job runs the image with `test`, so a failure shows mapped stack traces.
- The implementation is [#57](https://github.com/lajstrom/lajstrom-ui/issues/57).
