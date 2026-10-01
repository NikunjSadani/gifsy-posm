# gifsy-posm — Environment variable inventory

Owner reference: every env var, which service needs it, where its value comes from, and why.
Names follow `docs/plans/DEPLOY-CONTRACT.md`. Templates: `api/.env.{staging,production}.example`,
`platform/.env.{staging,production}.example`. **No real values live in git.**

Legend — **Source**: `Secret Manager` (bound via `--set-secrets`, secret name `posm-<env>-…`) ·
`plain` (ordinary Cloud Run env var) · `build-arg` (passed to `docker build`, baked into the image) ·
`Cloud Run` (injected by the platform). **Env**: `both` = staging and prod, same or different value.

## API service (`posm-api-staging` / `posm-api-prod`)

| Name | Service | Env | Source | Purpose |
|---|---|---|---|---|
| `NODE_ENV` | api | both = `production` | plain | Production runtime mode. `main.ts` fail-fast-checks `DATABASE_URL`/`JWT_SECRET` when this is `production`. |
| `PORT` | api | both | Cloud Run | Listen port (8080). `main.ts` reads it; do not set by hand. |
| `DATABASE_URL` | api | both | Secret Manager `posm-<env>-database-url` | Postgres URL for DB `posm_staging` / `posm_prod`, user `posm_app`. |
| `JWT_SECRET` | api | both | Secret Manager `posm-<env>-jwt-secret` | Signs/verifies access tokens. Required at boot. **Must equal the same env's frontend `JWT_SECRET`.** Use different values per env. |
| `JWT_EXPIRES_IN` | api | both = `60m` | plain | Access-token lifetime (short so the rolling session slides). |
| _Login_ | — | — | — | **Email + password (no OTP, 2026-10-01).** Admins set bcrypt passwords; there is no login env var and no `FIXED_OTP`. |
| `MSG91_AUTH_KEY` | api | both | Secret Manager `posm-<env>-msg91-auth-key` | MSG91 API auth key (email reports; dormant SMS/WhatsApp). Not used for login. |
| `MSG91_WHATSAPP_NUMBER` | api | both (optional) | plain | MSG91 integrated WhatsApp number; WhatsApp sends are skipped if unset. Not in the contract list — present in code. |
| `MSG91_SMTP_USER` | api | both | Secret Manager `posm-<env>-msg91-smtp-user` | SMTP relay username (report emails). |
| `MSG91_SMTP_PASS` | api | both | Secret Manager `posm-<env>-msg91-smtp-pass` | SMTP relay password. |
| `MSG91_SMTP_HOST` | api | both = `smtp.mailer91.com` | plain | SMTP relay host. |
| `MSG91_SMTP_PORT` | api | both = `587` | plain | SMTP relay port. |
| `REPORTS_FROM_EMAIL` | api | both | plain | From-address for transactional/scheduled report email (must be an MSG91-verified sender). |
| `STORAGE_DRIVER` | api | both = `gcs` | plain | Media storage backend (`gcs` in cloud; `local` only for dev/compose). |
| `GCS_BUCKET` | api | staging `posm-staging-files` / prod `posm-prod-files` | plain | Bucket for recce/install photos and documents. |
| `GCP_PROJECT_ID` | api | both | plain | GCP project id (Terraform `project_id`). Auth to GCS is via the runtime SA (ADC); never set `GOOGLE_APPLICATION_CREDENTIALS` in cloud. |
| `CORS_ORIGINS` | api | both | plain | Comma-separated allowed browser origins = the frontend URL(s) of the same env. |
| `RBAC_ENFORCEMENT` | api | both = `false` | plain | Kept for contract parity; **currently not read by the code** (PermissionGuard always enforces) — a no-op. |
| `LOG_LEVEL` | api | both = `info` | plain | pino log level. |
| `LOCAL_STORAGE_DIR` | api | neither | — | Only for `STORAGE_DRIVER=local` (dev/compose). Not used in cloud. |

## Frontend service (`posm-frontend-staging` / `posm-frontend-prod`)

| Name | Service | Env | Source | Purpose |
|---|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | frontend | both (different URL) | build-arg | The same env's API service URL. `next.config.ts` rewrites `/api/*` → `${NEXT_PUBLIC_API_URL}/v1/*` at build time; change = rebuild. |
| `NEXT_PUBLIC_CLIENT_ID` | frontend | both = `kwality` | build-arg | Tenant (Client) id sent as `clientId` on the login request, inlined into the client bundle. ⚠️ **Must equal the seeded Kwality Client row `id`** (the backend looks users up by this id, not the slug). Local dev uses a cuid, so `=kwality` only works if staging/prod seed the Client with a STABLE `id: 'kwality'`. **Provisioning action: seed staging/prod with `id:'kwality'`** (or set this to the real cuid per env). Verified 2026-10-01 against `api/scripts/seed-verify.mjs` (slug=`kwality`, id=auto cuid) + `platform/src/lib/field/config.ts` (sends it as `clientId`). |
| `BUILD_ID` | frontend | both | build-arg (CI = git SHA) | Next build id + `NEXT_PUBLIC_BUILD_ID`; drives `/version` and stale-tab `UpdateNudge`. |
| `JWT_SECRET` | frontend | both | Secret Manager `posm-<env>-jwt-secret` | Runtime. The proxy (`src/proxy.ts`) verifies api-issued tokens. **Must equal the same env's api `JWT_SECRET`**; app throws at boot in production if unset. |
| `NODE_ENV` | frontend | both = `production` | plain | Production mode. |
| `PORT` | frontend | both | Cloud Run | Listen port (8080); do not set by hand. |
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_APP_NAME` | frontend | optional | build-arg | Exposed by `next.config.ts` to the client; not in the contract and not required. |

## Migrate Job (`posm-migrate-staging` / `posm-migrate-prod`)

| Name | Service | Env | Source | Purpose |
|---|---|---|---|---|
| `DATABASE_URL` | migrate | both | Secret Manager `posm-<env>-database-url` | Target DB for `prisma migrate deploy` (read by `api/prisma.config.ts`). Same secret as the api. Job must run in-VPC / with Cloud SQL access. |
| `APP_DIR` | migrate | optional | plain | Dir containing `prisma.config.ts` (default `/app`). Only needed if the image layout differs. |

The `posm-migrate-<env>` Cloud Run Job runs `npx prisma migrate deploy` against the api image
(set in `terraform/cloud_run.tf`; the api image bundles the Prisma CLI + `prisma.config.ts` +
`prisma/migrations`). `scripts/migrate-entrypoint.sh` is an equivalent **local/manual** helper
(it is NOT baked into the image, so the Job does not invoke it).
It needs no other variables.

## Secret Manager secrets to create (per env `<env>` ∈ `staging`, `prod`)

`posm-<env>-database-url` · `posm-<env>-jwt-secret` · `posm-<env>-msg91-auth-key` ·
`posm-<env>-msg91-otp-template-id` · `posm-<env>-msg91-smtp-user` · `posm-<env>-msg91-smtp-pass`

Rules: the api and frontend of one env share `posm-<env>-jwt-secret`; staging and prod must use different
secret values; the database URL secret is shared by the api service and the migrate Job of that env.
