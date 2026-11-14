#!/bin/sh
# Vendors the server's OpenAPI description, internal/api/openapi.yaml of lajstrom/lajstrom, at a
# branch, tag or commit (default: main) into openapi/server.yaml, and regenerates
# src/api/server.gen.ts from it. Typecheck afterwards: what no longer compiles is what the
# server changed.
set -eu

ref=${1:-main}
cd "$(dirname "$0")/.."

sha=$(curl -fsSL -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/lajstrom/lajstrom/commits/$ref")
case $sha in
  *[!0-9a-f]* | '') echo "update-server-openapi: no commit for $ref" >&2; exit 1 ;;
esac

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
curl -fsSL "https://raw.githubusercontent.com/lajstrom/lajstrom/$sha/internal/api/openapi.yaml" > "$tmp"
{
  echo "# Vendored from lajstrom/lajstrom@$sha, internal/api/openapi.yaml. Do not edit:"
  echo "# npm run update:openapi -- <ref> replaces it and regenerates src/api/server.gen.ts."
  cat "$tmp"
} > openapi/server.yaml

node scripts/gen-api-types.ts
echo "openapi/server.yaml: lajstrom/lajstrom@$sha"
