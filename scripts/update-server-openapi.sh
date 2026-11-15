#!/bin/sh
# Vendors the server's OpenAPI description, internal/api/openapi.yaml of lajstrom/lajstrom, at a
# branch, tag or commit (default: main) into openapi/server.yaml, and regenerates
# public/openapi.yaml and src/api/openapi.gen.ts from it (npm run gen:api). Typecheck afterwards:
# what no longer compiles is what the server changed.
set -eu

ref=${1:-main}
cd "$(dirname "$0")/.."

sha=$(curl -fsSL -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/lajstrom/lajstrom/commits/$ref")
case $sha in
  *[!0-9a-f]* | '') echo "update-server-openapi: no commit for $ref" >&2; exit 1 ;;
esac

# The server's version at that commit, a release tag or v0.0.1-959-gf0d887d: the bundle shows it
# and compares it with the version of the server it talks to (scripts/build-info.ts).
describe=$(node scripts/server-describe.ts "$sha")

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
curl -fsSL "https://raw.githubusercontent.com/lajstrom/lajstrom/$sha/internal/api/openapi.yaml" > "$tmp"
{
  echo "# Vendored from lajstrom/lajstrom@$sha${describe:+ ($describe)}, internal/api/openapi.yaml. Do not edit:"
  echo "# npm run update:openapi -- <ref> replaces it and regenerates public/openapi.yaml and src/api/openapi.gen.ts."
  cat "$tmp"
} > openapi/server.yaml

node scripts/gen-api-types.ts
echo "openapi/server.yaml: lajstrom/lajstrom@$sha${describe:+ ($describe)}"
