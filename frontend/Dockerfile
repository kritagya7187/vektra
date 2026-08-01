# syntax=docker/dockerfile:1

# VEKTRA Frontend — production image (Phase 2H Docker & Deployment
# engineering review, items 7/11/12/13).
#
# Two stages, not three (contrast backend/Dockerfile's deps/build/runtime
# split): the frontend has no application dependencies that survive into
# the runtime image at all — the shipped artifact is a static dist/
# directory plus one small, unrelated static-file-server package, never
# frontend/package.json's own node_modules (which includes `cesium`, a
# large package needed only to produce the build, never to serve it).
# Re-running `npm ci` against frontend/package.json in the runtime stage
# would pull `cesium` back in for no reason and defeat the point of a
# separate stage.
#
#   build   — full dependency tree (incl. devDependencies: vite,
#             typescript, vite-plugin-cesium), compiles the app to
#             dist/. Nothing from this stage except dist/ survives.
#   runtime — a fresh image with ONLY `serve` (a minimal, dependency-free
#             static file server — the "lightweight web server" the EDD
#             itself left as an open implementation choice, Section 34)
#             and the compiled dist/ output. No Nginx/reverse proxy: the
#             design review found nothing in this repository (no
#             server-side routing, no SSR, single backend already
#             reachable directly) that justifies one.
#
# Pinned to the same Node major as backend/Dockerfile (node:22-alpine),
# for the same reason: a rebuild next month shouldn't silently pick up a
# different Node major.
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
# Only the manifest first — this layer only invalidates when dependencies
# actually change, not on every source edit (cache efficiency / layer
# ordering, matching backend/Dockerfile's own convention).
COPY package.json package-lock.json ./
RUN npm ci

# tsconfig.test.json is deliberately not copied — `npm run build` only
# runs `tsc -p tsconfig.json` (production sources), never the test
# project; it exists purely for `npm run typecheck:test`, a dev-only
# concern this image never invokes.
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

# VITE_* values are compiled INTO the static JS bundle by `vite build`
# itself (Vite's own define-time replacement of import.meta.env.VITE_*) —
# this is a build-time concern, not a container-runtime one, unlike every
# environment variable the backend image consumes. They must therefore
# arrive as Docker build args, supplied by docker-compose.yml's
# `build.args` (sourced from the operator's own .env, never committed —
# see repository-root .env.example). frontend/src/config.ts's
# requireEnv() already fails the build loudly (via vite build's own
# import.meta.env resolution) if either is missing, so no additional
# validation is added here.
ARG VITE_API_BASE_URL
ARG VITE_CESIUM_ION_TOKEN
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_CESIUM_ION_TOKEN=${VITE_CESIUM_ION_TOKEN}

RUN npm run build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

# A single, small, purpose-built static-file server — not a new
# framework or plugin ecosystem, and not Nginx (Phase 2H design review,
# item 12: nothing in this repository's frontend requires SSR or a
# reverse proxy). Installed standalone, deliberately NOT via `npm ci`
# against frontend/package.json, so frontend/package.json's own
# dependencies (`cesium`, needed only to produce dist/, never to serve
# it) never enter this stage. Pinned to a specific major version, not
# "latest", for the same reproducibility reason as ARG NODE_IMAGE above.
RUN npm install --global serve@14

COPY --from=build /app/dist ./dist
COPY healthcheck.js ./healthcheck.js

# The official Node Alpine image already ships a non-root "node" user
# (uid/gid 1000) — reused here for the same reason backend/Dockerfile
# reuses it rather than creating a second one.
USER node

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "healthcheck.js"]

# Shell form with an explicit `exec` (not exec-form CMD): the listen port
# is a runtime value (FRONTEND_PORT, set by docker-compose.yml, distinct
# from the VITE_* build-time values above) that must be substituted by a
# shell, but `exec` still replaces the shell process with `serve` itself
# so it becomes PID 1 and receives SIGTERM directly — the same signal-
# forwarding correctness backend/Dockerfile achieves with an exec-form
# CMD, combined with docker-compose.yml's `init: true` (tini) on this
# service too.
CMD ["sh", "-c", "exec serve -s dist -l ${FRONTEND_PORT:-8080}"]
