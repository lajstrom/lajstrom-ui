#!/bin/sh
# Builds the demo as a static site for GitHub Pages, or any static hosting: the demo only, on
# data generated in the browser, below LAJSTROM_UI_BASE (default /lajstrom-ui/, the path of the
# project site https://<owner>.github.io/lajstrom-ui/). The output is dist/pages.
set -eu

base="${LAJSTROM_UI_BASE:-/lajstrom-ui/}"
case "$base" in
  /*/ | /) ;;
  *)
    echo "build-pages.sh: LAJSTROM_UI_BASE must start and end with /, not '$base'" >&2
    exit 1
    ;;
esac
out=dist/pages

npx vite build --base "$base" --outDir "$out" --emptyOutDir

# The demo only: there is no server behind the site.
printf '{"apiBaseUrl":"","mock":true,"demo":true,"title":"Lajstrom"}\n' >"$out/config.json"
# Pages answers a path it has no file for with 404.html: the app itself, so that a link into it
# (/lajstrom-ui/apt/ubuntu-internal) opens the page it names.
cp "$out/index.html" "$out/404.html"
# The files as they are, without Jekyll.
touch "$out/.nojekyll"

echo "build-pages.sh: the demo in $out, below $base"
