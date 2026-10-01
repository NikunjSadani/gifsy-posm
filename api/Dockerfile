# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# gifsy-posm API (NestJS 11 + Prisma 7) — Cloud Run image: posm-api:<GIT_SHA>
#
# Build context = the `api/` directory:   docker build -t posm-api:dev api/
# The SAME image is used for the service AND the migration job (`posm-migrate-<env>`);
# the job overrides the command to:  node node_modules/prisma/build/index.js migrate deploy
#
# Stages:  deps-prod → prod node_modules + generated Prisma client
#          build     → full deps, generate, `nest build` → dist/
#          runtime   → slim, non-root, copies only what is needed to run
# ─────────────────────────────────────────────────────────────────────────────

# Debian-slim (glibc), NOT alpine: Prisma's native pieces (schema engine used by
# `migrate deploy`, and any engine library) are built against glibc + OpenSSL, and musl
# needs extra compat libs. -slim keeps the image small without that risk.
# Pinned to an exact Node 22 patch for reproducible builds — bump deliberately (and
# consider pinning by @sha256 digest in CI once the base is chosen).
ARG NODE_IMAGE=node:22.12.0-bookworm-slim

# ── Stage 1: production dependencies + generated Prisma client ───────────────
FROM ${NODE_IMAGE} AS deps-prod
WORKDIR /app
# Prisma needs OpenSSL at install/generate time (engine detection); slim does not ship it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# Lockfile-only copy first → this layer is cached until dependencies actually change.
COPY package.json package-lock.json ./
# `prisma` and `@prisma/client` are in `dependencies`, so --omit=dev keeps the CLI that the
# migration job needs at runtime. (xlsx comes from a tarball URL in the lockfile — needs network.)
RUN npm ci --omit=dev && npm cache clean --force
# `prisma generate` needs the schema + prisma.config.ts (the Prisma 7 CLI reads the config).
# It does NOT need a DATABASE_URL. Output lands in node_modules/.prisma/client, which is why
# the runtime stage copies THIS node_modules (it contains the generated client for prod).
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

# ── Stage 2: build (dev deps: @nestjs/cli, typescript, …) ────────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
COPY prisma.config.ts ./
# The generated client is imported by src/ — `nest build` (tsc) fails on missing types without it.
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npx nest build

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    # Prisma CLI (migration job): no telemetry / update checks / network chatter in Cloud Run.
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
WORKDIR /app
# OpenSSL is required by Prisma's native engine/schema-engine at runtime; ca-certificates for
# TLS to MSG91 / GCS / Cloud SQL.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Prod node_modules, INCLUDING the generated Prisma client (node_modules/.prisma/client),
# @prisma/client, @prisma/adapter-pg, and the `prisma` CLI + engines used by `migrate deploy`.
COPY --from=deps-prod --chown=node:node /app/node_modules ./node_modules
# Compiled app (dist/main.js is the entrypoint).
COPY --from=build --chown=node:node /app/dist ./dist
# Needed at runtime ONLY by the migration job (`prisma migrate deploy`): the schema, the
# migration SQL history, and prisma.config.ts (Prisma 7 CLI reads datasource URL from it).
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node prisma.config.ts ./
# package.json: so `node`/tooling resolves the package metadata (name/version) at runtime.
COPY --chown=node:node package.json ./

# Writable dir for STORAGE_DRIVER=local (docker-compose parity only). In Cloud Run the driver is
# `gcs` and this is unused; creating it owned by `node` lets a named volume inherit ownership.
RUN mkdir -p /app/.localstorage && chown node:node /app/.localstorage

# Non-root (the `node` user, uid 1000, ships with the official image).
USER node

# Cloud Run injects PORT (8080) and the app reads config.get('PORT'); this is documentation only.
ENV PORT=8080
EXPOSE 8080

# Exec form → node is PID 1 and receives SIGTERM directly on Cloud Run scale-down.
CMD ["node", "dist/main"]
