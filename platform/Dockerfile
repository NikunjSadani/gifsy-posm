# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# gifsy-posm frontend (Next.js 16, standalone) — Cloud Run image: posm-frontend:<GIT_SHA>
#
# Build context = the `platform/` directory:
#   docker build -t posm-frontend:dev \
#     --build-arg NEXT_PUBLIC_API_URL=https://<api-service-url> \
#     --build-arg NEXT_PUBLIC_CLIENT_ID=kwality \
#     --build-arg BUILD_ID=<GIT_SHA> platform/
#
# ⚠️ The three build args are BAKED at `next build` time:
#   - NEXT_PUBLIC_API_URL  → the `/api/:path*` → `${URL}/v1/:path*` rewrite lives in the routes
#                            manifest, so it CANNOT be changed by a runtime env var. A different
#                            API URL (staging vs prod) therefore needs a SEPARATE image build.
#   - NEXT_PUBLIC_CLIENT_ID → inlined into the client bundle.
#   - BUILD_ID             → Next's asset build id + NEXT_PUBLIC_BUILD_ID (UpdateNudge / `/version`).
# Runtime-only env: JWT_SECRET (proxy verifies tokens; must equal the api's), PORT, NODE_ENV.
# ─────────────────────────────────────────────────────────────────────────────

# Debian-slim (glibc): Next's SWC binary and `sharp` (image optimizer) ship glibc builds, and
# this avoids musl/alpine compatibility surprises. Pinned to an exact Node 22 patch.
ARG NODE_IMAGE=node:22.12.0-bookworm-slim

# ── Stage 1: install ALL deps (Tailwind/PostCSS/TypeScript are needed to build) ─
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

# ── Stage 2: build ───────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Baked into the bundle / routes manifest — must be set BEFORE `next build`.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_CLIENT_ID
# Empty → next.config.ts falls back to a timestamp id (fine for local builds; CI passes the SHA).
ARG BUILD_ID=""
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_CLIENT_ID=${NEXT_PUBLIC_CLIENT_ID} \
    BUILD_ID=${BUILD_ID}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── Stage 3: runtime (standalone server) ─────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    # Standalone server.js binds to $HOSTNAME; Cloud Run sets HOSTNAME to the container id,
    # which would bind only that interface. Force all-interfaces so the platform can reach us.
    HOSTNAME=0.0.0.0

# Self-contained server: server.js + a traced, minimal node_modules (no full install needed).
COPY --from=build --chown=node:node /app/.next/standalone ./
# Static assets are NOT included in standalone output — served from .next/static by server.js.
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# public/ (icons, manifest.webmanifest, logos) is likewise not traced into standalone.
COPY --from=build --chown=node:node /app/public ./public

# Non-root (`node`, uid 1000, ships with the official image).
USER node

EXPOSE 8080
# Exec form → node is PID 1 and receives SIGTERM directly. Reads PORT/HOSTNAME from env.
CMD ["node", "server.js"]
