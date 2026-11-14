# 0002. The UI stays a React and TypeScript app built with npm

- Status: accepted
- Date: 2026-11-14
- Deciders: gecube

## Context

The prototype is React 19, TypeScript, Vite, Tailwind 4 and TanStack Router and Query, about
10 000 lines with a mock of `/api/v1`, a demo and tests against the server's specs
([ADR 0001](0001-web-ui-in-its-own-repository.md)). It was proposed to rebuild it with htmx,
Alpine.js and Tailwind loaded from a CDN, without npm. The reasons given: a simpler tool chain,
a stack that language models write well, and a UI that is realistic about the server's state but
optimistic where it can be.

What binds the choice:

- The server answers JSON. ADR 0001 and [lajstrom/lajstrom#70](https://github.com/lajstrom/lajstrom/issues/70) rule out server-side rendering and a
  backend for the frontend, and the UI must render without a server (the demo).
- The image's Content-Security-Policy is `script-src 'self'`: no inline scripts, no `eval`, no
  scripts from other origins.
- Lajstrom runs in closed networks next to the registry it fronts. A page that needs a public CDN
  does not load there, and an artifact registry should not pull its own code from a third party
  at run time.
- The server's `/api/v1` changed shape after the prototype ([#2](https://github.com/lajstrom/lajstrom-ui/issues/2)). Types checked at build time
  are what finds such drift before a user does.

## Considered options

- A. Keep React and TypeScript, built with npm; ship static files only.
- B. The same code on Preact (`preact/compat`), for a smaller runtime.
- C. Alpine.js and Tailwind without npm, their files kept in the repository rather than on a CDN.
- D. htmx with HTML rendered by the Go server at `/ui`.

## Decision

Option A. npm is a build-time tool here; what ships is static files behind nginx, as before.

- B saves tens of KiB of runtime, less than splitting the bundle per page ([#17](https://github.com/lajstrom/lajstrom-ui/issues/17)) saves, and some
  of our dependencies need compat shims. It can be revisited when the bundle size matters.
- C fits a JSON API, but Alpine evaluates its expressions with `new Function`, which needs
  `'unsafe-eval'`; its CSP build avoids that with its own parser of a subset of JavaScript. The
  router, the query cache with rollback, the mock and the tests would be written by hand, and the
  contract would have no types. It is a rewrite of working code for fewer guarantees.
- D is where htmx belongs: the server renders HTML and is always the truth. It reverses ADR 0001
  and [#70](https://github.com/lajstrom/lajstrom/issues/70) (the UI in the server, no demo without a server) and is a product decision, not a
  choice of library. It is the option to reopen if the UI has to ship inside the server binary.

The aims of the proposal stay, within A:

- No CDN at run time: every asset comes from the image, as the CSP already enforces.
- Few dependencies: a new runtime dependency is justified in its pull request.
- A size budget for the main chunk ([#17](https://github.com/lajstrom/lajstrom-ui/issues/17)).
- Realistic by default, optimistic where a change is safe to show early ([#3](https://github.com/lajstrom/lajstrom-ui/issues/3)), with TanStack
  Query's cache and rollback.

## Consequences

- No rewrite: the work goes into catching up with the server's API ([#2](https://github.com/lajstrom/lajstrom-ui/issues/2)) and the screens.
- Contributors need Node and npm to build; CI and the image already have them.
- Dependency updates keep coming (Renovate) and keep needing the license check.
- Language models write React and TypeScript well; this is not a reason for either side.
