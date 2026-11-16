#!/usr/bin/env bash
# A Lajstrom server for the end-to-end test of the UI (e2e/screens.e2e.ts): builds it from a
# checkout of lajstrom/lajstrom, serves it with an SQLite index on a registry, makes the first
# admin with the bootstrap token, as an installation does, and publishes a package of every
# format through the format's own endpoint.
#
#   e2e/server.sh LAJSTROM_CHECKOUT WORKDIR
#
# Environment:
#   LAJSTROM_E2E_REGISTRY  host:port of an OCI registry that takes anonymous pushes
#                          (default localhost:5000, the Zot of the server's make dev-up)
#   LAJSTROM_E2E_PORT      the server's port on 127.0.0.1 (default 18080)
#   LAJSTROM_E2E_UI        the UI's URL, as playwright.config.ts takes it (default
#                          http://localhost:8080/ui/): its origin is server.externalURL, the
#                          URL the browser reaches the API at, which the UI's DPoP proofs name
#
# WORKDIR gets the configuration, the index, server.log, server.pid and env: the server's URL
# and the admin's name and password, for the test (LAJSTROM_E2E_SERVER, LAJSTROM_E2E_USER,
# LAJSTROM_E2E_PASSWORD). Stop the server with kill "$(cat WORKDIR/server.pid)".
#
# The rpm package is built with rpmbuild in a Rocky Linux container, so it needs Docker;
# without it the rpm repo stays empty. Everything else needs curl, jq, python3 and npm.
set -euo pipefail

[ $# = 2 ] || { echo "usage: e2e/server.sh LAJSTROM_CHECKOUT WORKDIR" >&2; exit 2; }
src="$(cd "$1" && pwd)"
mkdir -p "$2"
work="$(cd "$2" && pwd)"
here="$(cd "$(dirname "$0")" && pwd)"
registry="${LAJSTROM_E2E_REGISTRY:-localhost:5000}"
port="${LAJSTROM_E2E_PORT:-18080}"
base="http://127.0.0.1:$port"
ui="${LAJSTROM_E2E_UI:-http://localhost:8080/ui/}"
external="$(printf '%s' "$ui" | sed -E 's#^(https?://[^/]+).*#\1#')"

step() { printf 'ok   %s\n' "$*"; }

(cd "$src" && make --no-print-directory build) >"$work/build.log" 2>&1 || { cat "$work/build.log" >&2; exit 1; }
bin="$src/bin/lajstrom"
step "make build: $("$bin" version | head -1)"

cat >"$work/lajstrom.yaml" <<EOF
# Written by e2e/server.sh of lajstrom-ui.
server:
  listen: "127.0.0.1:$port"
  externalURL: "$external"
  insecureHTTP: true
  shutdownTimeout: 5s
  shutdownDelay: 0s
  metricsListen: ""
log:
  level: info
  format: text
database:
  driver: sqlite
  dsn: "file:$work/lajstrom.db"
registries:
  - name: local
    type: generic
    url: "http://$registry"
reconcile:
  interval: 0s
keys:
  masterKeyEnv: LAJSTROM_MASTER_KEY
auth:
  anonymousRead: false
  bootstrap:
    tokenFile: "$work/bootstrap-token"
repos:
  - {name: files, format: raw, registry: local}
  - {name: python, format: pypi, registry: local}
  - {name: ubuntu, format: apt, registry: local}
  - {name: releases, format: maven, registry: local}
  - {name: internal, format: npm, registry: local}
  - {name: all, format: npm, kind: group, group: {members: [internal]}}
  - {name: el9, format: rpm, registry: local}
EOF

unset LAJSTROM_SERVER_LISTEN LAJSTROM_SERVER_EXTERNAL_URL LAJSTROM_DATABASE_DSN LAJSTROM_BOOTSTRAP_TOKEN_FILE LAJSTROM_ADMIN_PASSWORD
LAJSTROM_MASTER_KEY="$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')"
export LAJSTROM_MASTER_KEY
rm -f "$work/lajstrom.db"
"$bin" migrate --config "$work/lajstrom.yaml" >"$work/migrate.log" 2>&1 || { cat "$work/migrate.log" >&2; exit 1; }
(umask 077 && od -An -tx1 -N32 /dev/urandom | tr -d ' \n' >"$work/bootstrap-token")
"$bin" serve --config "$work/lajstrom.yaml" >"$work/server.log" 2>&1 </dev/null &
echo $! >"$work/server.pid"
deadline=$((SECONDS + 30))
until curl -fsS -o /dev/null --max-time 2 "$base/-/readyz" 2>/dev/null; do
	if ! kill -0 "$(cat "$work/server.pid")" 2>/dev/null || [ "$SECONDS" -ge "$deadline" ]; then
		tail -n 50 "$work/server.log" >&2
		echo "e2e/server.sh: lajstrom serve did not get ready on $base" >&2
		exit 1
	fi
	sleep 0.5
done
step "lajstrom serve on $base, registry $registry"

user=e2e-admin
password="$(od -An -tx1 -N18 /dev/urandom | tr -d ' \n')"
printf '%s' "$password" | "$bin" admin bootstrap --server "$base" --name "$user" \
	--token-file "$work/bootstrap-token" --password-stdin >"$work/admin.log" 2>&1 || { cat "$work/admin.log" >&2; exit 1; }
(umask 077 && {
	printf 'LAJSTROM_E2E_SERVER=%s\nLAJSTROM_E2E_USER=%s\nLAJSTROM_E2E_PASSWORD=%s\n' "$base" "$user" "$password" >"$work/env"
	printf 'user = "%s:%s"\n' "$user" "$password" >"$work/curlrc"
})
step "lajstrom admin bootstrap --name $user"

# put WHAT URL CURL-ARGS...: one upload, which must answer 2xx.
put() {
	local what="$1" url="$2" code
	shift 2
	code="$(curl -sS -K "$work/curlrc" -o "$work/upload.out" -w '%{http_code}' "$@" "$url")"
	case "$code" in 2??) step "$what: $code" ;; *) echo "e2e/server.sh: $what: $code $(head -c 300 "$work/upload.out")" >&2; exit 1 ;; esac
}
sha256() { python3 -c 'import hashlib, sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' "$1"; }

fx="$work/fixtures"
rm -rf "$fx"
python3 "$here/fixtures.py" "$fx" >/dev/null

printf 'Notes of the UI end-to-end test.\n' >"$fx/README.txt"
put "raw: PUT docs/README.txt" "$base/raw/files/docs/README.txt" -T "$fx/README.txt" -H 'Content-Type: text/plain'

whl="$fx/lajstrom_e2e_demo-1.0.0-py3-none-any.whl"
put "pypi: upload of $(basename "$whl")" "$base/pypi/python/" \
	-F ':action=file_upload' -F protocol_version=1 -F metadata_version=2.1 -F name=lajstrom-e2e-demo -F version=1.0.0 \
	-F filetype=bdist_wheel -F pyversion=py3 -F "sha256_digest=$(sha256 "$whl")" -F "content=@$whl"

put "apt: upload of hello-e2e_1.0.0-1_all.deb to jammy/main" "$base/apt/ubuntu/upload?suite=jammy&component=main" \
	-T "$fx/hello-e2e_1.0.0-1_all.deb"

m="$base/maven/releases/com/example/e2e/demo"
put "maven: PUT demo-1.0.0.jar" "$m/1.0.0/demo-1.0.0.jar" -T "$fx/maven/demo-1.0.0.jar"
put "maven: PUT demo-1.0.0.pom" "$m/1.0.0/demo-1.0.0.pom" -T "$fx/maven/demo-1.0.0.pom"
put "maven: PUT maven-metadata.xml, the commit" "$m/maven-metadata.xml" -T "$fx/maven/maven-metadata.xml"

# npm publishes with a bearer token, as after npm login.
token="$(curl -fsS -K "$work/curlrc" -H 'Content-Type: application/json' -d '{"name": "e2e npm publish", "expiresIn": "1d"}' \
	"$base/api/v1/users/$user/tokens" | jq -r .secret)"
(umask 077 && printf 'registry=%s/npm/internal/\n//127.0.0.1:%s/npm/internal/:_authToken=%s\n' "$base" "$port" "$token" >"$fx/npm/.npmrc")
(cd "$fx/npm" && npm publish --userconfig "$fx/npm/.npmrc" >"$work/npm.log" 2>&1) || { cat "$work/npm.log" >&2; exit 1; }
step "npm: publish of @e2e/widgets@1.0.0"

if command -v docker >/dev/null 2>&1; then
	mkdir -p "$fx/rpmbuild/SPECS"
	cat >"$fx/rpmbuild/SPECS/hello-e2e.spec" <<'EOF'
Name: hello-e2e
Version: 1.0
Release: 1.el9
Summary: A package the UI's end-to-end test publishes
License: Apache-2.0
BuildArch: noarch
%description
It holds one file, its README.
%install
mkdir -p %{buildroot}/usr/share/doc/hello-e2e
echo 'hello-e2e' > %{buildroot}/usr/share/doc/hello-e2e/README
%files
/usr/share/doc/hello-e2e/README
EOF
	docker run --rm --platform linux/amd64 -v "$fx/rpmbuild:/w/rpmbuild" -w /w quay.io/rockylinux/rockylinux:9.7 bash -ec "
		dnf -q -y install rpm-build >/dev/null
		rpmbuild -bb --define '_topdir /w/rpmbuild' --define '_binary_payload w9.gzdio' rpmbuild/SPECS/hello-e2e.spec
		chown -R $(id -u):$(id -g) rpmbuild" >"$work/rpm.log" 2>&1 || { cat "$work/rpm.log" >&2; exit 1; }
	put "rpm: upload of hello-e2e-1.0-1.el9.noarch.rpm" "$base/rpm/el9/upload" -T "$fx/rpmbuild/RPMS/noarch/hello-e2e-1.0-1.el9.noarch.rpm"
else
	step "rpm: no docker, so no rpmbuild: the repo el9 stays empty"
fi
rm -f "$fx/npm/.npmrc"
