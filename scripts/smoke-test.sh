#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# smoke-test.sh — fast post-deploy sanity check for a POSM environment.
#
# Exercises the REAL user path (frontend → /api proxy → API → DB), so a green run
# proves the whole stack is wired: the frontend serves, the proxy forwards, the API
# is up, the DB is reachable, and an admin can actually log in and read data.
#
# Usage:
#   SMOKE_EMAIL=admin@kwality.in SMOKE_PASSWORD='<pw>' \
#     ./scripts/smoke-test.sh https://<frontend-url> [https://<api-url>]
#
#   $1  APP_URL  (required) the frontend base URL — the /api proxy lives here.
#   $2  API_URL  (optional) the API base URL — only used for /health liveness/readiness.
#   env CLIENT_ID (default "kwality") the tenant Client id (= NEXT_PUBLIC_CLIENT_ID).
#   env SMOKE_EMAIL / SMOKE_PASSWORD (required) an admin login for the environment.
#
# Exits non-zero if ANY check fails. Reads no secrets from disk.
# ──────────────────────────────────────────────────────────────────────────────
set -uo pipefail

APP_URL="${1:-}"
API_URL="${2:-}"
CLIENT_ID="${CLIENT_ID:-kwality}"
: "${APP_URL:?Pass the frontend URL as arg 1 (e.g. https://posm.gifsy.in)}"
: "${SMOKE_EMAIL:?Set SMOKE_EMAIL (an admin login for this environment)}"
: "${SMOKE_PASSWORD:?Set SMOKE_PASSWORD}"
APP_URL="${APP_URL%/}"; API_URL="${API_URL%/}"

fails=0
pass() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗ %s\033[0m\n' "$*"; fails=$((fails + 1)); }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }

echo "Smoke test → $APP_URL  (tenant: $CLIENT_ID)"

# 1. Frontend is serving. `/` 307-redirects to the login page when unauthenticated, so follow
#    redirects (-L) and expect the final page to be 200 — a 5xx / connection error is the real failure.
c=$(curl -sL -o /dev/null -w '%{http_code}' --max-time 20 "$APP_URL/")
[ "$c" = "200" ] && pass "frontend serving (→ login 200)" || fail "frontend root returned $c"

# 2. API liveness/readiness (only if an API URL was given — /health is not proxied).
if [ -n "$API_URL" ]; then
  c=$(code "$API_URL/health");       [ "$c" = "200" ] && pass "api /health 200"       || fail "api /health returned $c"
  c=$(code "$API_URL/health/ready"); [ "$c" = "200" ] && pass "api /health/ready 200" || fail "api /health/ready returned $c (DB unreachable?)"
fi

# 3. Login through the /api proxy (full path: proxy → api → DB). Pulls the access token from the body.
login_body=$(curl -s --max-time 20 -X POST "$APP_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"clientId\":\"$CLIENT_ID\",\"email\":\"$SMOKE_EMAIL\",\"password\":\"$SMOKE_PASSWORD\"}")
token=$(printf '%s' "$login_body" | grep -o '"accessToken":"[^"]*"' | head -1 | sed 's/.*:"//; s/"$//')
if [ -n "$token" ]; then
  pass "login 200 (proxy → api → DB, token issued)"
else
  fail "login did not return a token: $(printf '%s' "$login_body" | head -c 160)"
fi

# 4. Authed read through the proxy (the proxy injects the bearer from the `token` cookie).
if [ -n "$token" ]; then
  c=$(code -b "token=$token" "$APP_URL/api/posm-types")
  [ "$c" = "200" ] && pass "authed read /api/posm-types 200" || fail "authed read returned $c"
fi

echo
if [ "$fails" -eq 0 ]; then
  echo -e "\033[32mSMOKE PASSED\033[0m"; exit 0
else
  echo -e "\033[31mSMOKE FAILED — $fails check(s)\033[0m"; exit 1
fi
