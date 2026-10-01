#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# gifsy-posm — database migration entrypoint (Cloud Run Job `posm-migrate-<env>`)
#
# EXECUTABLE: this file must carry the executable bit in git
#   (`git update-index --chmod=+x scripts/migrate-entrypoint.sh`); on Windows checkouts
#   run it as `bash scripts/migrate-entrypoint.sh`.
#
# What it does: applies all pending Prisma migrations (`prisma migrate deploy`) against
# $DATABASE_URL, then prints the migration status so the Job log shows what is applied.
# Prisma 7 CLI reads the datasource URL from api/prisma.config.ts → process.env.DATABASE_URL
# (the schema has no inline url). `migrate deploy` is forward-only and idempotent: with nothing
# pending it is a no-op, so re-running a Job is safe. It never resets or drops data.
#
# Inputs (Cloud Run Job env):
#   DATABASE_URL  [secret] posm-<env>-database-url (REQUIRED). The Job must run in-VPC / with the
#                 Cloud SQL connection so the URL is reachable. Never echoed by this script.
#   APP_DIR       [plain, optional] directory holding prisma/ + prisma.config.ts.
#                 Default: /app (the api image WORKDIR); falls back to ./api when run from repo root.
#
# Wiring note: the api image build context is `api/`, so this file is NOT inside the image
# unless the Dockerfile copies it. The Job can equivalently run the one-liner the Dockerfile
# documents:  node node_modules/prisma/build/index.js migrate deploy
# (this script uses that same binary when present, else falls back to `npx prisma`).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Fail loudly with context on any error (set -e alone gives no hint which step died).
trap 'echo "[migrate] FAILED (exit $?) at line ${LINENO} — migrations NOT fully applied" >&2' ERR

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[migrate] ERROR: DATABASE_URL is not set (expected from Secret Manager posm-<env>-database-url)" >&2
  exit 1
fi

# Locate the directory containing prisma.config.ts.
APP_DIR="${APP_DIR:-}"
if [ -z "$APP_DIR" ]; then
  if [ -f /app/prisma.config.ts ]; then APP_DIR=/app
  elif [ -f ./prisma.config.ts ]; then APP_DIR=.
  elif [ -f ./api/prisma.config.ts ]; then APP_DIR=./api
  else
    echo "[migrate] ERROR: cannot find prisma.config.ts (set APP_DIR)" >&2
    exit 1
  fi
fi
cd "$APP_DIR"
echo "[migrate] working dir: $(pwd)"

# Prefer the in-image Prisma CLI binary (no network, no npx resolution); fall back to npx.
if [ -f node_modules/prisma/build/index.js ]; then
  PRISMA=(node node_modules/prisma/build/index.js)
else
  PRISMA=(npx prisma)
fi

# Log the target WITHOUT credentials (strip user:pass@, keep host/db only).
SAFE_TARGET="$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-zA-Z]+://[^@/]*@#//***@#; s#\?.*$##')"
echo "[migrate] target: ${SAFE_TARGET}"

echo "[migrate] applying pending migrations (prisma migrate deploy)..."
"${PRISMA[@]}" migrate deploy

echo "[migrate] migration status after deploy:"
# `migrate status` exits non-zero if the DB is behind/drifted → with set -e this fails the Job.
"${PRISMA[@]}" migrate status

echo "[migrate] OK — database is up to date"
