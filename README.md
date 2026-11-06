# lajstrom-ui

Web UI for [Lajstrom](https://github.com/lajstrom/lajstrom), the artifact registry on top of any
OCI registry. Read-only at first: repositories, packages, versions, files, referrers and the
audit log (lajstrom/lajstrom#70). The server embeds the built bundle and serves it under `/ui/`.

Status: not started. The server's MVP (milestones M0–M3, until 2026-12-04) comes first; this
repository holds the scaffold so that the name, the license and the contribution rules are
settled.

## Contributing

The same rules as the server: Apache-2.0; the
[CLA](https://github.com/lajstrom/lajstrom/blob/main/CLA.md), signed once through the bot on
your first pull request; every commit signed off (`git commit -s`, DCO); AI assistance disclosed
with an `Assisted-by:` trailer. See
[CONTRIBUTING.md](https://github.com/lajstrom/lajstrom/blob/main/CONTRIBUTING.md) in the server
repository; the process and the roadmap live in its `docs/`.

Site: https://lajstrom.dev
