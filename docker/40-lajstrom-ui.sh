#!/bin/sh
# Writes the runtime configuration of the Lajstrom UI from environment variables, before nginx
# starts (the nginx image runs /docker-entrypoint.d/*.sh). Everything goes to /tmp/lajstrom-ui:
#
#   config.json       read by the browser: API base URL, demo and mock modes, title
#   headers           security headers, included in every location
#   api-proxy.conf    forwards /api/ and /-/ to LAJSTROM_API_UPSTREAM, or nothing
#
# Variables:
#   LAJSTROM_UI_API_URL     base URL of the Lajstrom API as the browser sees it; empty = same origin
#   LAJSTROM_UI_MOCK        true: the demo only, on generated data from a service worker, no API needed
#   LAJSTROM_UI_DEMO        false: do not offer the demo next to the API (default true)
#   LAJSTROM_UI_TITLE       instance name in the header and the page title
#   LAJSTROM_API_UPSTREAM   http://lajstrom:8080 to let this nginx proxy the API (no Ingress)
set -eu

out=/tmp/lajstrom-ui
mkdir -p "$out"

api_url="${LAJSTROM_UI_API_URL:-}"
mock="${LAJSTROM_UI_MOCK:-false}"
demo="${LAJSTROM_UI_DEMO:-true}"
title="${LAJSTROM_UI_TITLE:-Lajstrom}"
upstream="${LAJSTROM_API_UPSTREAM:-}"

case "$mock" in
  true | false) ;;
  *)
    echo "40-lajstrom-ui.sh: LAJSTROM_UI_MOCK must be true or false, not '$mock'" >&2
    exit 1
    ;;
esac

case "$demo" in
  true | false) ;;
  *)
    echo "40-lajstrom-ui.sh: LAJSTROM_UI_DEMO must be true or false, not '$demo'" >&2
    exit 1
    ;;
esac

case "$api_url" in
  "" | http://* | https://*) ;;
  *)
    echo "40-lajstrom-ui.sh: LAJSTROM_UI_API_URL must be empty or an http(s) URL, not '$api_url'" >&2
    exit 1
    ;;
esac

case "$upstream" in
  "" | http://* | https://*) ;;
  *)
    echo "40-lajstrom-ui.sh: LAJSTROM_API_UPSTREAM must be empty or an http(s) URL, not '$upstream'" >&2
    exit 1
    ;;
esac

# JSON string escaping for the two free-text values.
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

printf '{"apiBaseUrl":"%s","mock":%s,"demo":%s,"title":"%s"}\n' \
  "$(json_escape "$api_url")" "$mock" "$demo" "$(json_escape "$title")" >"$out/config.json"

# The browser may talk to the API's origin when it is not the UI's own.
connect_src="'self'"
if [ -n "$api_url" ]; then
  origin=$(printf '%s' "$api_url" | sed -E 's#^(https?://[^/]+).*#\1#')
  connect_src="'self' $origin"
fi

cat >"$out/headers" <<EOF
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "same-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src $connect_src; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
EOF

if [ -n "$upstream" ]; then
  upstream="${upstream%/}"
  # No URI part after the upstream: nginx passes the request URI as the client sent it, so
  # percent-encoded package names (raw paths, %2F) reach Lajstrom unchanged.
  cat >"$out/api-proxy.conf" <<EOF
location /api/ {
  proxy_pass $upstream;
  proxy_set_header Host \$host;
  proxy_set_header X-Forwarded-Proto \$scheme;
  proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  proxy_set_header X-Request-Id \$request_id;
}
location /-/ {
  proxy_pass $upstream;
  proxy_set_header Host \$host;
}
EOF
  echo "40-lajstrom-ui.sh: proxying /api/ and /-/ to $upstream"
else
  : >"$out/api-proxy.conf"
fi

echo "40-lajstrom-ui.sh: config.json: $(cat "$out/config.json")"
