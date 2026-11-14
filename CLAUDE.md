# CLAUDE.md — working on the Lajstrom web UI with Claude Code

This repository is the web UI of Lajstrom, an artifact registry on top of any OCI registry. The
server is a separate repository, [lajstrom/lajstrom](https://github.com/lajstrom/lajstrom); the
UI talks to it only through `/api/v1`. Static SPA: React 19, TypeScript, Vite, Tailwind 4,
TanStack Router and Query; MSW mocks the API.

## Read before changing anything

1. `README.md` — what the UI does, how it runs and ships.
2. `docs/adr/` — decisions about the UI; `docs/api-proposal.md` — the read API the UI needs.
3. The server's specs, when the task touches what the UI shows: `docs/spec/manifest-profile.md`,
   `http-routing.md`, `index-schema.md` and `rbac.md` in lajstrom/lajstrom. Paths like
   `docs/spec/…` in code comments point there, not here.

## Requirements you must not break

- No server-side rendering. The build is static files only; nginx serves them and nothing runs
  on the server side of the UI.
- All data comes from `/api/v1` calls in the browser. No backend-for-frontend, no other service.
- Without a backend the UI still renders: on mock data, for now. Keep the mock working.
- Separate images for dev, test and prod are required; today there is one image configured at
  start. Do not design anything that needs a rebuild per environment until that is settled.
- Every screen state lives in the URL query (filters, tabs, cursors), so links are shareable.

## Contracts

- `src/api/types.ts` mirrors the server's API. Where the server has a resource, the type is the
  server's, from `src/api/server.gen.ts`: generated from `openapi/server.yaml`, the server's
  `internal/api/openapi.yaml` vendored at a commit. Never edit either by hand;
  `npm run update:openapi -- <ref>` takes a newer server, and what then fails to typecheck is
  what the server changed. Shapes the server does not have yet follow `docs/api-proposal.md`.
- `src/lib/profile.ts` ports the server's `internal/oci/profile` (Escape, EscapeComponent, Tag).
  When the server's spec or code changes, update the port and copy the new test vectors.
- The mock must follow the manifest profile: `src/mocks/data/profile-conformance.test.ts` has to
  pass. Mock-only shapes are listed in `docs/api-proposal.md` §4.

## Commands

```sh
npm ci
npm run dev           # http://localhost:5173/ui/ on mock data
npm run check         # typecheck, lint, tests, production build: run before every push
npm run update:openapi -- main   # vendor the server's openapi.yaml and regenerate the types
docker build -t ghcr.io/lajstrom/lajstrom-ui:dev .
npx license-checker-rseidelsohn@5.0.1 --production --excludePrivatePackages \
  --onlyAllow 'Apache-2.0;MIT;BSD-2-Clause;BSD-3-Clause;ISC;MPL-2.0;Unlicense;CC0-1.0;0BSD'
```

## Code rules

- TypeScript strict; no `any` without a reason in a comment.
- UI primitives in `src/components/ui` are written here. Do not paste components from shadcn/ui
  or other projects: CI runs a snippet scan.
- Dependencies only under the license allowlist of CONTRIBUTING.md. Anything shipped to the
  browser (MSW included) is a `dependency`, so the license check covers it.
- React: no impure calls (`Date.now()`, random) in render; keep non-component helpers out of
  component files (fast refresh); `react-hooks` lint must pass.
- Tests with vitest for pure logic: formats, profile, mock conformance.
- UI text in English, like the server's documentation.

## Commits and pull requests

- Conventional Commits subject: `feat(repo): filter packages by suite`. Types: feat, fix, docs,
  test, refactor, perf, build, ci, chore, revert.
- Every commit: `Signed-off-by:` (`git commit -s`) and, for commits you helped write,
  `Assisted-by: Claude Code`.
- The PR description is written by the human. Never push to `main`; never force-push a shared
  branch; do not merge, the human does.
