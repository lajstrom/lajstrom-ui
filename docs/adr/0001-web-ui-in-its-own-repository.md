# 0001. The web UI lives in its own repository and ships as its own images

- Status: proposed
- Date: 2026-11-06
- Deciders: gecube, Pavel

## Context

The server's plan has a read-only web UI after the MVP: "SPA
served at `/ui`, backed by `/api/v1`; search; per-format usage snippets; later: management
screens". `/ui` is a reserved first segment of the one-host layout (lajstrom ADR 0004,
`docs/spec/http-routing.md` §1).

Lajstrom runs as containers, often on Kubernetes next to the registry it fronts. The UI is
developed by different people, in a TypeScript tool chain, on its own schedule. Requirements
for it:

- no server-side rendering: a fully static build; the browser gets all data through API calls;
- it renders without a backend (mock data for now), so it can be shown and tested on its own;
- separate images for dev, test and prod.

Comparable projects split in different ways:

| Project | Where the UI code lives | How it ships |
| --- | --- | --- |
| Zot | separate repository (`zui`) | embedded in the server at build time |
| Harbor | server repository, `src/portal/` | separate nginx image and pod |
| VictoriaMetrics | server repository, `app/vmui/` | embedded with `go:embed`, and a separate image |
| Quay, Argo CD, Grafana, Headlamp | server repository | embedded or served by the server |

## Considered options

- A. SPA embedded in the Go binary (`go:embed`), served at `/ui` by the server.
- B. Separate repository, separate images.
- C. Code in `ui/` of the server repository, built into a separate image.

## Decision

Option B. The UI lives in `lajstrom/lajstrom-ui`, started as a clone of `lajstrom/lajstrom` so
that it keeps the license, the CLA, the contribution policy and the history. It is a static SPA
(React, TypeScript, Vite) served by an unprivileged nginx and configured at start from
environment variables. Its only contract with the server is `/api/v1`: the server repository
owns the specification (`docs/spec/http-routing.md`); this repository proposes what the UI
needs ([api-proposal.md](../api-proposal.md)) and mocks it until the server implements it.

On Kubernetes one Ingress host routes `/ui` to the UI pods and everything else to the server,
so the browser sees one origin and the server needs no CORS. The server keeps `/ui` reserved
and does not serve it.

## Consequences

- The UI is released, scaled and rolled back on its own; a broken UI release does not touch the
  server, and the server's binary carries no Node tool chain.
- An API change takes two pull requests: the spec and the server first, then the UI. The UI
  must tolerate a server that lacks an endpoint (an older server, or one not built yet), which
  the mock-first approach already forces.
- UI and server versions are independent; the UI needs to show which API it expects, and the
  compatibility has to be written down once both ship releases.
- Governance files (CONTRIBUTING, CLA workflow, CODEOWNERS, issue templates) exist twice and have
  to be kept in step; the CLA document itself stays the server repository's `CLA.md`.
- Single-binary installs get no UI unless an embedded build is added later.
- Before management screens, the browser needs a login that does not keep tokens in JavaScript:
  the cookie session proposed in api-proposal.md §5.
- Dev, test and prod images are not built yet; what differs between them is still open.
