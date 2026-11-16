# syntax=docker/dockerfile:1
#
# The Lajstrom web UI: static files served by an unprivileged nginx, configured at start from
# environment variables (docker/40-lajstrom-ui.sh). One image for every environment: dev, test
# and prod are profiles of it, LAJSTROM_UI_PROFILE, chosen at start
# (docs/adr/0004-one-image-profile-at-start.md). Build from the repository root:
#
#   docker build -t ghcr.io/lajstrom/lajstrom-ui:dev .
#   docker run --rm -p 8081:8080 -e LAJSTROM_UI_MOCK=true ghcr.io/lajstrom/lajstrom-ui:dev
#   docker run --rm -p 8081:8080 -e LAJSTROM_UI_PROFILE=dev \
#     -e LAJSTROM_API_UPSTREAM=http://host.docker.internal:8080 ghcr.io/lajstrom/lajstrom-ui:dev
#
# A release builds the image from its tar.gz instead, so that the image serves the very files of
# the bundle (.github/workflows/release.yml): the unpacked bundle replaces the stage `bundle`,
#
#   docker buildx build --build-context bundle=<unpacked tar.gz> .
#
# Runs as uid 101 and writes only to /tmp, so it works with readOnlyRootFilesystem.

# The bundle is the same on every platform: it is built on the builder's own.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
# What the build is (scripts/build-info.ts); a release passes its tag, commit and commit time.
ARG LAJSTROM_UI_VERSION=dev
ARG LAJSTROM_UI_COMMIT=
ARG LAJSTROM_UI_DATE=
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# The dev server's config.json is not shipped: the image writes its own at start.
RUN npm run build && rm dist/ui/config.json

FROM scratch AS bundle
COPY --from=build /src/dist/ui /

FROM nginxinc/nginx-unprivileged:stable-alpine

LABEL org.opencontainers.image.title="lajstrom-ui" \
      org.opencontainers.image.description="Web UI for Lajstrom, an artifact registry on top of any OCI registry" \
      org.opencontainers.image.source="https://github.com/lajstrom/lajstrom-ui" \
      org.opencontainers.image.licenses="Apache-2.0"

# Runtime configuration, see README.md. The profile is prod unless another is chosen: no demo, no
# mock, no source maps. LAJSTROM_UI_DEMO and LAJSTROM_UI_MOCK are not set here, so that their
# defaults are the profile's; one that is set wins over it.
ENV LAJSTROM_UI_PROFILE="prod" \
    LAJSTROM_UI_API_URL="" \
    LAJSTROM_UI_TITLE="Lajstrom" \
    LAJSTROM_API_UPSTREAM=""

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --chmod=0755 docker/40-lajstrom-ui.sh /docker-entrypoint.d/40-lajstrom-ui.sh
COPY --from=bundle / /usr/share/nginx/html/ui

EXPOSE 8080
