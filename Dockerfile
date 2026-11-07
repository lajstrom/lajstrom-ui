# syntax=docker/dockerfile:1
#
# The Lajstrom web UI: static files served by an unprivileged nginx, configured at start from
# environment variables (docker/40-lajstrom-ui.sh). Build from the repository root:
#
#   docker build -t ghcr.io/lajstrom/lajstrom-ui:dev .
#   docker run --rm -p 8081:8080 -e LAJSTROM_UI_MOCK=true ghcr.io/lajstrom/lajstrom-ui:dev
#
# Runs as uid 101 and writes only to /tmp, so it works with readOnlyRootFilesystem.

FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# The dev server's config.json is not shipped: the image writes its own at start.
RUN npm run build && rm dist/ui/config.json

FROM nginxinc/nginx-unprivileged:stable-alpine

LABEL org.opencontainers.image.title="lajstrom-ui" \
      org.opencontainers.image.description="Web UI for Lajstrom, an artifact registry on top of any OCI registry" \
      org.opencontainers.image.source="https://github.com/lajstrom/lajstrom-ui" \
      org.opencontainers.image.licenses="Apache-2.0"

# Runtime configuration, see README.md. Mock data is off unless asked for.
ENV LAJSTROM_UI_API_URL="" \
    LAJSTROM_UI_MOCK="false" \
    LAJSTROM_UI_TITLE="Lajstrom" \
    LAJSTROM_API_UPSTREAM=""

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --chmod=0755 docker/40-lajstrom-ui.sh /docker-entrypoint.d/40-lajstrom-ui.sh
COPY --from=build /src/dist/ui /usr/share/nginx/html/ui

EXPOSE 8080
