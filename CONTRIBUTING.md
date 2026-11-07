# Contributing to the Lajstrom UI

Thank you for your interest in Lajstrom. This repository is the web UI; the server lives in
[lajstrom/lajstrom](https://github.com/lajstrom/lajstrom). New here? Read the
[README](README.md), then the project's [onboarding](https://github.com/lajstrom/lajstrom/blob/main/docs/onboarding.md) and
[process](https://github.com/lajstrom/lajstrom/blob/main/docs/process.md): the same rules apply to both repositories. This page holds the
legal and mechanical rules every pull request must satisfy.

Everyone taking part is expected to follow the [Code of Conduct](https://github.com/lajstrom/lajstrom/blob/main/CODE_OF_CONDUCT.md).
Security issues are never reported in public issues; see [SECURITY.md](https://github.com/lajstrom/lajstrom/blob/main/SECURITY.md).

## Summary: what every pull request needs

1. Every commit is signed off under the Developer Certificate of Origin (`git commit -s`).
2. You have signed the Contributor License Agreement (once, before your first merge).
3. Any AI assistance is disclosed with an `Assisted-by:` commit trailer.
4. A description, written by you, of what the change does and why.
5. Tests for the change, and an ADR if the change is architectural.
6. New dependencies are under a license from the allowlist below.
7. CI is green.

## Developer Certificate of Origin (DCO)

Every commit must carry a `Signed-off-by:` line. By adding it you certify the
[Developer Certificate of Origin 1.1](https://developercertificate.org/): that you wrote the change
or otherwise have the right to submit it under the project's open source license.

```sh
git commit -s -m "feat(repo): filter packages by suite"
```

The `Signed-off-by:` name and email must match the commit author. To fix a missing sign-off on the
last commit, run `git commit --amend -s --no-edit`; for older commits, use
`git rebase --signoff main` and push the branch again. The `dco` CI job fails if any commit in the
pull request lacks a sign-off.

## Contributor License Agreement (CLA)

In addition to the DCO, contributors sign the [Contributor License Agreement](https://github.com/lajstrom/lajstrom/blob/main/CLA.md) once, before
their first pull request is merged. The CLA lets the project owner license and relicense
contributions under OSI-approved licenses and includes a patent license; the DCO records the
provenance of each individual commit. The reasoning is in
[ADR 0003](https://github.com/lajstrom/lajstrom/blob/main/docs/adr/0003-license-and-contribution-terms.md).

Signing is handled by a bot that runs inside this repository's GitHub Actions; no external
service is involved:

- On your first pull request the CLA bot posts a comment and sets a failing `CLAAssistant` check.
- Read [CLA.md](https://github.com/lajstrom/lajstrom/blob/main/CLA.md), then sign by posting this exact comment on the pull request:

  ```text
  I have read the CLA Document and I hereby sign the CLA
  ```

- The bot records your GitHub user name, user id, the pull request and the time in
  `signatures/version1/cla.json` on the `cla-signatures` branch of this repository, and the check
  turns green. Comment `recheck` to re-run the check.
- If you contribute on behalf of your employer, your employer must also accept the corporate part
  of the CLA. Contact the maintainers before your first pull request.

## AI-assisted contributions

Lajstrom is built with a lot of help from AI tools, and contributions made with AI assistance are
welcome. They are held to the same bar as any other contribution, plus a few rules:

- **A human is responsible.** The human author of the pull request is responsible for its
  correctness, its tests and its license cleanliness, exactly as if they had typed every line.
  Understand and review what you submit; "the tool wrote it" is not an answer in review.
- **Disclose the tool.** Every commit that contains AI-assisted work carries a trailer naming the
  tool, for example:

  ```text
  feat(api): add tag listing endpoint

  Assisted-by: <tool name>
  Signed-off-by: Your Name <your-email>
  ```

  Use one `Assisted-by:` line per tool. Plain autocompletion of a single identifier does not
  need a trailer; generated functions, tests, documentation or refactorings do.
- **No verbatim copying.** Do not copy code from other projects, whether by hand or through a
  tool. If a tool produces code that you recognise from another project, do not submit it.
- **Snippet scan.** CI runs a snippet scan (`snippet-scan` job) against a public database of open
  source code. A flagged match blocks the merge until it is explained in the pull request and a
  maintainer has decided how to handle it: rewrite it, or record it as an approved component in
  `scanoss.json`.
- **Human-written description.** Pull requests without a human-written description of what the
  change does and why are closed.
- **No automation at scale.** Fully automated or bulk AI-generated pull requests and issues are
  closed without review.

## Dependency license policy

Lajstrom is licensed under Apache-2.0 and must stay distributable under it. Direct and transitive
dependencies must use one of these licenses (SPDX identifiers):

| Allowed without discussion |
| --- |
| Apache-2.0, MIT, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0, Unlicense, CC0-1.0, 0BSD |

Every other license is **denied by default** and needs an explicit maintainer decision, recorded
in the pull request that introduces the dependency. This includes, among others, GPL, LGPL, AGPL,
SSPL, BSL (Business Source License) and EUPL, as well as dependencies with no detectable license.

The `licenses` CI job enforces the allowlist with
[license-checker-rseidelsohn](https://github.com/RSeidelsohn/license-checker-rseidelsohn) on
everything shipped to the browser: the `dependencies` of `package.json`, including the mock.
Build and test tools stay in `devDependencies`. Prefer the platform and few, well-maintained
dependencies.

## Architecture decision records (ADRs)

Architectural changes of the UI need an ADR in [`docs/adr/`](docs/adr/), submitted in the same
pull request as the change or before it: how the UI is built, shipped or deployed, how it
authenticates, or a significant dependency. See [docs/adr/README.md](docs/adr/README.md). A change
to the API the UI calls is a change to the server's contract: it goes to lajstrom/lajstrom as an
issue labelled `contract` (see [docs/api-proposal.md](docs/api-proposal.md)). If in doubt, open an
issue and ask.

## Pull requests

- **Small and focused.** One logical change per pull request. Large changes are easier to land as
  a series of small ones; open an issue first to agree on the approach.
- **Tests.** New behaviour comes with tests; bug fixes come with a test that fails without the fix.
- **Conventional Commits** style for commit subjects and the pull request title:
  `type(scope): summary`, where `type` is one of `feat`, `fix`, `docs`, `test`, `refactor`,
  `perf`, `build`, `ci`, `chore` or `revert`. Use the imperative mood and keep it under 72
  characters. Mark breaking changes with `!` (for example `feat(api)!: ...`).
- **Description.** Fill in the pull request template: what changes, why, and how it was tested.
- **History.** Branch protection requires a linear history; maintainers squash or rebase on merge.
  Rebase on `main` instead of merging `main` into your branch.
- **Review.** At least one maintainer approval and green CI are required to merge.

## Building and testing locally

You need Node.js 22.12 or newer (CI uses the `node:24` image) and Git; Docker for the image.

```sh
npm ci
npm run dev     # http://localhost:5173/ui/ on mock data
npm run check   # what the check job runs: typecheck, lint, tests, production build
```

One step at a time:

```sh
npm run typecheck
npm run lint
npm test
npx vite build
```

The image, as the `image` job builds and smoke-tests it:

```sh
docker build -t lajstrom-ui:dev .
docker run --rm -p 8081:8080 --read-only --tmpfs /tmp -e LAJSTROM_UI_MOCK=true lajstrom-ui:dev
```

Dependency licenses against the allowlist:

```sh
npx license-checker-rseidelsohn@5.0.1 --production --excludePrivatePackages \
  --onlyAllow 'Apache-2.0;MIT;BSD-2-Clause;BSD-3-Clause;ISC;MPL-2.0;Unlicense;CC0-1.0;0BSD'
```

The snippet scan needs Python 3 and the ScanOSS client (it sends file fingerprints, not source code,
to the public OSSKB service):

```sh
python3 -m pip install scanoss==1.54.3
scanoss-py scan --output /tmp/scanoss-results.json src
scanoss-py inspect undeclared --input /tmp/scanoss-results.json
```

## CI overview

| Job | What it checks |
| --- | --- |
| `check` | `npm run check`: typecheck, lint, tests, production build |
| `licenses` | licenses of everything shipped to the browser against the allowlist |
| `image` | the container image builds and serves the UI read-only, as on Kubernetes |
| `snippet-scan` | ScanOSS match against public open source code |
| `dco` | `Signed-off-by:` on every commit of the pull request |
| `codeql` | CodeQL static analysis of JavaScript and TypeScript (separate workflow) |
| `CLAAssistant` | CLA signature (separate workflow) |

## License

By contributing you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE) and under the terms of the [CLA](https://github.com/lajstrom/lajstrom/blob/main/CLA.md).
