#!/bin/sh
# Builds the release bundle into dist/release (.github/workflows/release.yml runs it, and it runs
# the same on a laptop):
#
#   lajstrom-ui-<version>.tar.gz            the bundle, one directory lajstrom-ui-<version>/: index.html,
#                                           assets/, build.json and the rest of the build, without
#                                           a config.json
#   lajstrom-ui-<version>.tar.gz.sbom.json  an SPDX SBOM of the npm packages the bundle contains (the
#                                           dependencies of package.json, not the build tools)
#   checksums.txt                           SHA-256 of both
#
# <version> is LAJSTROM_UI_VERSION without its v: the tag in the release workflow, git describe
# otherwise. The bundle has relative asset paths, so it runs at the root of a static origin and
# below /ui/ (vite.config.ts). The archive is reproducible: the same commit gives the same bytes.
set -eu
cd "$(dirname "$0")/.."

version=${LAJSTROM_UI_VERSION:-$(git describe --tags --always --dirty 2>/dev/null || echo dev)}
commit=${LAJSTROM_UI_COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || true)}
# The commit's time, in the bundle and on every file of the archive.
epoch=$(git log -1 --format=%ct 2>/dev/null || echo 0)
date=${LAJSTROM_UI_DATE:-$(TZ=UTC git log -1 --date=format-local:%Y-%m-%dT%H:%M:%SZ --format=%cd 2>/dev/null || true)}

# GNU tar sorts names and drops owners; on macOS it is gtar (brew install gnu-tar).
if tar --version 2>/dev/null | grep -q 'GNU tar'; then
  tar=tar
elif command -v gtar >/dev/null 2>&1; then
  tar=gtar
else
  echo "build-release.sh: needs GNU tar (on macOS: brew install gnu-tar)" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$@"; }
else
  sha256() { shasum -a 256 "$@"; }
fi

LAJSTROM_UI_VERSION=$version LAJSTROM_UI_COMMIT=$commit LAJSTROM_UI_DATE=$date npx vite build
# public/config.json is the dev server's demo; a deployment writes its own next to the bundle.
rm -f dist/ui/config.json

name="lajstrom-ui-${version#v}"
out=dist/release
rm -rf "$out"
mkdir -p "$out/$name"
cp -R dist/ui/. "$out/$name/"
"$tar" --sort=name --mtime="@$epoch" --owner=0 --group=0 --numeric-owner --mode='u+rw,go+r,go-w' \
  --format=gnu -C "$out" -cf - "$name" | gzip -9n >"$out/$name.tar.gz"
rm -rf "${out:?}/$name"

npm sbom --omit dev --sbom-format spdx --sbom-type application --package-lock-only >"$out/$name.tar.gz.sbom.json"

(cd "$out" && sha256 "$name.tar.gz" "$name.tar.gz.sbom.json" >checksums.txt)
echo "build-release.sh: $out/$name.tar.gz ($commit, $date)"
cat "$out/checksums.txt"
