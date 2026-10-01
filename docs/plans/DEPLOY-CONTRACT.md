# gifsy-posm — Deploy scaffolding CONTRACT (Wave A)

**Every Wave-A workstream MUST use these exact names so the pieces integrate.** Placeholders
(`$PROJECT_ID`, instance name, domain) are Terraform variables / build args — never hardcode a real
value. Nothing here is applied to the cloud; this is scaffolding for a later `apply`.

## Platform facts (already true — do not rebuild)
- `api/` = NestJS 11 + Prisma 7. Scripts: `build`=`nest build`, `start:prod`=`node dist/main`.
  Prisma client needs `npx prisma generate` before build. Migrations apply with
  `npx prisma migrate deploy` (Prisma 7 CLI reads `prisma.config.ts`; URL via `DATABASE_URL`).
- `platform/` = Next.js 16. `next.config.ts` ALREADY sets `output:"standalone"`, `generateBuildId`
  from `BUILD_ID`, and proxies `/api/*`→`${NEXT_PUBLIC_API_URL}/v1/*`.
- API already exposes `GET /health` (liveness) and `GET /health/ready` (readiness, checks DB) —
  VERSION_NEUTRAL (unversioned). Use these for Cloud Run probes. Do NOT add new ones.
- Gates (a red suite BLOCKS deploy): `cd api && npx prisma generate && npx tsc --noEmit && npx jest --no-coverage && npx nest build`;
  `cd platform && npx tsc --noEmit && npx vitest run`.

## Names (canonical)
- Region: `asia-south1`. GCP project: TF var `project_id` (no default).
- Artifact Registry (Docker) repo: `posm` →
  - api image: `asia-south1-docker.pkg.dev/$PROJECT_ID/posm/posm-api:<GIT_SHA>`
  - frontend image: `asia-south1-docker.pkg.dev/$PROJECT_ID/posm/posm-frontend:<GIT_SHA>`
- Cloud Run services: `posm-api-staging`, `posm-frontend-staging`, `posm-api-prod`, `posm-frontend-prod` (min instances 0).
- Cloud Run Jobs (migrations, in-VPC): `posm-migrate-staging`, `posm-migrate-prod` (run `prisma migrate deploy`).
- Cloud SQL: instance = TF var `sql_instance` (e.g. `gifsy-shared`, may be pre-existing); databases `posm_staging`, `posm_prod`; db user `posm_app` (password in Secret Manager).
- GCS media buckets: `posm-staging-files`, `posm-prod-files` (STORAGE_DRIVER=gcs).
- Secret Manager (per env `<env>`∈{staging,prod}): `posm-<env>-database-url`, `posm-<env>-jwt-secret`,
  `posm-<env>-msg91-auth-key`, `posm-<env>-msg91-otp-template-id`, `posm-<env>-msg91-smtp-pass`,
  `posm-<env>-msg91-smtp-user`.
- WIF: pool `github-pool`, provider `github`, deployer SA `posm-deployer@$PROJECT_ID.iam.gserviceaccount.com`;
  runtime SAs `posm-api-<env>@…` (roles/cloudsql.client, secretmanager.secretAccessor, storage.objectAdmin on its bucket).

## Runtime env contract
**api (Cloud Run service env):** `NODE_ENV=production`, `PORT=8080` (Cloud Run injects PORT — read it),
`DATABASE_URL` (secret), `JWT_SECRET` (secret), `JWT_EXPIRES_IN=60m`, `STORAGE_DRIVER=gcs`,
`GCS_BUCKET=posm-<env>-files`, `GCP_PROJECT_ID=$PROJECT_ID`, `CORS_ORIGINS=<frontend URL(s)>`,
`MSG91_AUTH_KEY`/`MSG91_SMTP_PASS`/`MSG91_SMTP_USER`/`MSG91_SMTP_HOST`/`MSG91_SMTP_PORT`/`REPORTS_FROM_EMAIL`,
`RBAC_ENFORCEMENT=false`, `LOG_LEVEL=info`. **Login is email + password (no OTP, 2026-10-01)** — no
`FIXED_OTP`/`ALLOW_FIXED_OTP` in any env; MSG91 is kept for email reports only.
⚠️ Cloud Run sets `PORT` (default 8080) — the api must listen on `process.env.PORT`. Confirm `main.ts`
uses it; if it hardcodes 4000, that's an app-readiness fix (flag it, don't silently rewrite scope).
**frontend (Cloud Run service env + build args):** build arg `NEXT_PUBLIC_API_URL=<api service URL>`,
build arg `BUILD_ID=<GIT_SHA>`, build arg `NEXT_PUBLIC_CLIENT_ID=kwality`; runtime `JWT_SECRET` (secret,
MUST match the api's — the proxy verifies tokens), `PORT` (Cloud Run), `NODE_ENV=production`.

## CI/CD contract (GitHub Actions)
- `test.yml`: on PR + push to `develop`/`main` — run BOTH gate suites (needs a Postgres service for jest? jest is mocked/unit → no DB needed; do NOT add one unless a test requires it).
- `deploy-staging.yml`: on push to `develop`, `needs: test` → auth via WIF → build+push both images (tag=GIT_SHA) → deploy `posm-migrate-staging` job and wait → deploy both staging services at the new image → post serving revision + SHA.
- `deploy-prod.yml`: `workflow_dispatch` only, branch `main`, `needs: test` → same pipeline against prod names → print the serving image SHA to verify. NO auto-merge, NO auto prod.
- Build images PER SHA; staging and prod build separate images. Concurrency group per env (cancel-in-progress false for deploys).

## File ownership (NO overlap between agents)
- **A/containers:** `api/Dockerfile`, `api/.dockerignore`, `platform/Dockerfile`, `platform/.dockerignore`, `docker-compose.yml`.
- **B/ci-cd:** `.github/workflows/test.yml`, `.github/workflows/deploy-staging.yml`, `.github/workflows/deploy-prod.yml`.
- **C/terraform:** `terraform/*.tf`, `terraform/environments/staging.tfvars.example`, `terraform/environments/prod.tfvars.example`, `terraform/README.md`.
- **D/env+migrate:** `api/.env.staging.example`, `api/.env.production.example`, `platform/.env.staging.example`, `platform/.env.production.example`, `scripts/migrate-entrypoint.sh` (or documented command), `docs/plans/DEPLOY-ENV-VARS.md` (the full inventory). MAY add a boot-time required-secret check in `api/src/main.ts` ONLY if it does not exist (flag if risky).
- **E/edge+docs:** `cloudflare/` (worker + `wrangler.toml`, if mirroring the `*.gifsy.in` pattern — else a routing note), `docs/plans/ENVIRONMENTS.md`, `docs/plans/DEPLOY-RUNBOOK.md`.
- **Integrator (me, not an agent):** `.gitignore` edits (terraform state, `.env.*` real files), final gates, wiring review.

## Guardrails for every agent
- Do not run `gcloud`/`terraform apply`/any cloud call — scaffolding only, placeholders for real ids.
- Do not weaken auth (password hashing, lockout) or commit real secrets. `.env.*.example` files hold
  placeholders only.
- Keep changes within your file set above. If you find a cross-cutting need, NOTE it in your final
  report for the integrator — do not edit another agent's files.
- Match existing code style; add honest comments.
