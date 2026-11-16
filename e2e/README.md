# End-to-end test against a real server

The UI image, with `LAJSTROM_API_UPSTREAM`, in front of a Lajstrom built from source. Playwright
signs in through the form and opens every screen: the repository list, each repo with its first
package and that package's newest version, tokens, the audit log, access, the registries,
search and the API page. A test fails on an uncaught error, a page that stays empty,
or an answer of the API that the UI does not expect. A `404` for a path the server does not know
is expected only for an operation the UI proposes (`x-lajstrom-status: proposed` in
`public/openapi.yaml`). Anything else means the UI calls what the server does not have.

CI runs it in `.github/workflows/e2e.yml`. A pull request runs against the commit named in
`openapi/server.yaml`. Every night it runs against the server's main and opens an issue when that
fails.

## Locally

You need Docker, Go, `curl`, `jq`, `python3` and npm. Use a registry that takes anonymous pushes,
such as the Zot of `make dev-up` in lajstrom/lajstrom, or one of its own. On macOS, port 5000 is
AirPlay's.

```sh
docker run -d --name e2e-zot -p 127.0.0.1:5055:5000 ghcr.io/project-zot/zot-minimal:v2.1.23
git clone https://github.com/lajstrom/lajstrom ../lajstrom   # at the commit of openapi/server.yaml
LAJSTROM_E2E_REGISTRY=127.0.0.1:5055 e2e/server.sh ../lajstrom /tmp/lajstrom-e2e

docker build -t lajstrom-ui:e2e .
docker run -d --name e2e-ui -p 127.0.0.1:8080:8080 -e LAJSTROM_UI_PROFILE=test \
  -e LAJSTROM_API_UPSTREAM=http://host.docker.internal:18080 lajstrom-ui:e2e

set -a; . /tmp/lajstrom-e2e/env; set +a
LAJSTROM_E2E_CHANNEL=chrome npm run e2e   # the installed Chrome; or npx playwright install chromium
kill "$(cat /tmp/lajstrom-e2e/server.pid)"
```

- `e2e/server.sh` builds the server, serves it on `127.0.0.1:18080` (`LAJSTROM_E2E_PORT`) with an
  SQLite index, and makes the first admin with the bootstrap token.
- It publishes one package to each repo through the format's own endpoint: raw, pypi, apt,
  maven, npm and rpm. An npm group repo stays without packages of its own. `e2e/fixtures.py`
  builds the files with Python's standard library. The rpm is built with `rpmbuild` in a Rocky
  Linux container.
- The admin's name and password end up in `/tmp/lajstrom-e2e/env`.
- `LAJSTROM_E2E_UI` changes the UI's URL: it defaults to `http://localhost:8080/ui/`, and
  `npm run dev` with `LAJSTROM_UI_MOCK=false` serves `http://localhost:5173/ui/`.
