#!/bin/sh
# Writes the runtime configuration of the Lajstrom UI, before nginx starts (the nginx image runs
# /docker-entrypoint.d/*.sh). Everything goes to /tmp/lajstrom-ui:
#
#   config.json       read by the browser, "schema": 1 (README.md, Configuration): written from
#                     the variables below, or a link to a mounted file
#   headers           security headers, included in every location
#   api-proxy.conf    forwards /api/ and /-/ to LAJSTROM_API_UPSTREAM, or nothing
#
# A file at LAJSTROM_UI_CONFIG (default /etc/lajstrom-ui/config.json), such as a ConfigMap, is
# served as it is, and a change of it shows on the next page load; the LAJSTROM_UI_* variables of
# config.json are then not read. The browser checks the file and names what is wrong in it.
#
# Variables:
#   LAJSTROM_UI_API_URL        base URL of the Lajstrom API as the browser sees it; empty = same origin
#   LAJSTROM_UI_MOCK           true: the demo only, on generated data from a service worker, no API needed
#   LAJSTROM_UI_DEMO           false: do not offer the demo next to the API (default true)
#   LAJSTROM_UI_TITLE          instance name in the header and the page title
#   LAJSTROM_UI_LOGO           the header's logo: a path relative to /ui/, an http(s) URL or a data:image URL
#   LAJSTROM_UI_COLOR          the primary colour, #rgb or #rrggbb
#   LAJSTROM_UI_COLOR_DARK     the primary colour of the dark theme; default LAJSTROM_UI_COLOR
#   LAJSTROM_UI_SUPPORT_URL    where to get help, http(s) or mailto:, in the about dialog and on error pages
#   LAJSTROM_UI_CONFIG         a config.json to serve instead (default /etc/lajstrom-ui/config.json)
#   LAJSTROM_API_UPSTREAM      http://lajstrom:8080 to let this nginx proxy the API (no Ingress)
set -eu

out=/tmp/lajstrom-ui
mkdir -p "$out"

fail() {
  echo "40-lajstrom-ui.sh: $*" >&2
  exit 1
}

mounted="${LAJSTROM_UI_CONFIG:-/etc/lajstrom-ui/config.json}"
upstream="${LAJSTROM_API_UPSTREAM:-}"

case "$upstream" in
  "" | http://* | https://*) ;;
  *) fail "LAJSTROM_API_UPSTREAM must be empty or an http(s) URL, not '$upstream'" ;;
esac

# The origin of an http(s) URL, for the Content-Security-Policy; nothing for any other value.
origin() {
  printf '%s' "$1" | sed -En 's#^(https?://[^/"]+).*#\1#p'
}

# JSON string escaping for the free-text values, on one line.
json_escape() {
  printf '%s' "$1" | tr -d '\r\n' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

if [ -f "$mounted" ]; then
  ln -sf "$mounted" "$out/config.json"
  # The origins the browser may reach besides its own, as the file names them now: a change of
  # apiBaseUrl or of the logo's origin needs a restart for the Content-Security-Policy.
  api_origin=$(origin "$(sed -En 's#.*"apiBaseUrl"[[:space:]]*:[[:space:]]*"([^"]*)".*#\1#p' "$mounted" | head -n 1)")
  logo_origin=$(origin "$(sed -En 's#.*"logo"[[:space:]]*:[[:space:]]*"([^"]*)".*#\1#p' "$mounted" | head -n 1)")
  echo "40-lajstrom-ui.sh: config.json: $mounted, as it is"
else
  api_url="${LAJSTROM_UI_API_URL:-}"
  mock="${LAJSTROM_UI_MOCK:-false}"
  demo="${LAJSTROM_UI_DEMO:-true}"
  title="${LAJSTROM_UI_TITLE:-Lajstrom}"
  logo="${LAJSTROM_UI_LOGO:-}"
  color="${LAJSTROM_UI_COLOR:-}"
  color_dark="${LAJSTROM_UI_COLOR_DARK:-}"
  support="${LAJSTROM_UI_SUPPORT_URL:-}"

  case "$mock" in
    true | false) ;;
    *) fail "LAJSTROM_UI_MOCK must be true or false, not '$mock'" ;;
  esac
  case "$demo" in
    true | false) ;;
    *) fail "LAJSTROM_UI_DEMO must be true or false, not '$demo'" ;;
  esac
  case "$api_url" in
    "" | http://* | https://*) ;;
    *) fail "LAJSTROM_UI_API_URL must be empty or an http(s) URL, not '$api_url'" ;;
  esac
  case "$logo" in
    "" | http://* | https://* | data:image/*) ;;
    //* | *:*) fail "LAJSTROM_UI_LOGO must be a path relative to /ui/, an http(s) URL or a data:image URL, not '$logo'" ;;
  esac
  for c in "$color" "$color_dark"; do
    case "$c" in
      "" | \#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F] | \#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]) ;;
      *) fail "LAJSTROM_UI_COLOR and LAJSTROM_UI_COLOR_DARK must be #rgb or #rrggbb, not '$c'" ;;
    esac
  done
  case "$support" in
    "" | http://* | https://* | mailto:*) ;;
    *) fail "LAJSTROM_UI_SUPPORT_URL must be empty, an http(s) URL or a mailto: URL, not '$support'" ;;
  esac

  printf '{"schema":1,"apiBaseUrl":"%s","mock":%s,"demo":%s,"branding":{"title":"%s","logo":"%s","colors":{"primary":"%s","primaryDark":"%s"},"supportUrl":"%s"}}\n' \
    "$(json_escape "$api_url")" "$mock" "$demo" "$(json_escape "$title")" "$(json_escape "$logo")" \
    "$color" "$color_dark" "$(json_escape "$support")" >"$out/config.json"
  api_origin=$(origin "$api_url")
  logo_origin=$(origin "$logo")
  echo "40-lajstrom-ui.sh: config.json: $(cat "$out/config.json")"
fi

# The browser may talk to the API's origin when it is not the UI's own, and load the logo from
# its origin.
connect_src="'self'${api_origin:+ $api_origin}"
img_src="'self' data:${logo_origin:+ $logo_origin}"

cat >"$out/headers" <<EOF
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "same-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src $img_src; connect-src $connect_src; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
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
