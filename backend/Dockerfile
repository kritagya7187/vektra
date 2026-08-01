# syntax=docker/dockerfile:1

# VEKTRA Backend — production image (EDD Section 34: Docker Compose,
# single-node local/dev orchestration).
#
# Three stages:
#   deps    — installs the FULL dependency tree (incl. devDependencies:
#             typescript, tsx-adjacent tooling) — needed only to compile.
#   build   — compiles TypeScript (tsc -p tsconfig.json) to dist/. Nothing
#             from this stage except dist/ survives into the final image.
#   runtime — a fresh image with ONLY production dependencies
#             (npm ci --omit=dev) and the compiled dist/ output. This is
#             the stage that actually ships.
#
# Pinned to a specific Node major on Alpine (small base, current LTS) —
# not "latest", so a rebuild next month doesn't silently pick up a
# different Node major. Deliberately NOT pinned to a full image digest
# (node:22-alpine@sha256:...): that would also freeze out security
# patches published under the same tag until manually bumped — a real
# tradeoff, not an oversight; see this subsystem's review.
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# Only the manifest first — this layer only invalidates when dependencies
# actually change, not on every source edit (cache efficiency / layer
# ordering).
COPY package.json package-lock.json ./
RUN npm ci

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
# --omit=dev: production dependencies only in the runtime stage
# (typescript, eslint, vitest, testcontainers, etc. never enter this
# image at all).
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY healthcheck.js ./healthcheck.js

# Mount point for docker-compose.yml's raster_storage named volume
# (RASTER_STORAGE_DIR). Created and chowned here, before USER node,
# so that when Compose mounts an empty named volume over this path it
# inherits this ownership (Docker's documented behavior for populating
# a volume from the image directory it overlays) — without this, a
# fresh named volume defaults to root ownership and the non-root `node`
# user below could not write downloaded raster files to it.
RUN mkdir -p /app/raster-storage && chown node:node /app/raster-storage

# The official Node Alpine image already ships a non-root "node" user
# (uid/gid 1000) for exactly this purpose — creating a second one would
# be redundant, not more secure.
USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "healthcheck.js"]

# Exec form, not "npm start" — npm does not reliably forward SIGTERM to
# its child process, which would break the graceful-shutdown handling
# already built in src/server.ts (Server Bootstrap subsystem). Combined
# with docker-compose.yml's `init: true` (tini as PID 1) for correct
# signal forwarding and zombie reaping.
CMD ["node", "dist/server.js"]
