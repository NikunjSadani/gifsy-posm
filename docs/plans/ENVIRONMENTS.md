# gifsy-posm — Environments (authoritative topology)

**Status: SCAFFOLD (2026-10-01). Nothing is provisioned yet.** This is the single source of truth
for what each environment is, how code reaches it, and how to tell what is serving. Names come from
`DEPLOY-CONTRACT.md` (do not rename here without changing the contract). Everything
project/domain-specific is a placeholder: `$PROJECT_ID`, `$SQL_INSTANCE`, `<DOMAIN>`.
Operational procedures (bootstrap, rollback, rotation, restore) live in `DEPLOY-RUNBOOK.md`; the
full env-var inventory lives in `DEPLOY-ENV-VARS.md`; the rationale/plan is `DEPLOYMENT-PLAN.md`.

## 1. The three environments

| Concern | local | staging | production |
|---|---|---|---|
| Trigger | developer machine | **auto** on push to `develop` (`deploy-staging.yml`, `needs: test`) | **manual** `workflow_dispatch` on `main` (`deploy-prod.yml`, `needs: test`) |
| API | `nest start --watch` `:4000` | Cloud Run `posm-api-staging` | Cloud Run `posm-api-prod` |
| Frontend | `next dev` `:3000` | Cloud Run `posm-frontend-staging` | Cloud Run `posm-frontend-prod` |
| Migrate | `prisma migrate deploy` by hand | Cloud Run Job `posm-migrate-staging` (in-VPC) | Cloud Run Job `posm-migrate-prod` (in-VPC) |
| Region | — | `asia-south1` | `asia-south1` |
| URL (Cloud Run) | `http://localhost:3000` | `https://posm-frontend-staging-<hash>.asia-south1.run.app` (read it, see §4) | `https://posm-frontend-prod-<hash>.asia-south1.run.app` |
| URL (edge, optional) | — | `uat-posm.<DOMAIN>` | `posm.<DOMAIN>` (or client-facing domain) — **owner decision, §6** |
| DB | local PG `posm_dev` `:5433` | `posm_staging` on `$SQL_INSTANCE`, user `posm_app` | `posm_prod` on `$SQL_INSTANCE` (instance placement = open decision, `DEPLOYMENT-PLAN.md` §5.1), user `posm_app` |
| Media | local disk (`STORAGE_DRIVER=local`) | GCS `posm-staging-files` (`STORAGE_DRIVER=gcs`) | GCS `posm-prod-files` (`STORAGE_DRIVER=gcs`) |
| OTP / email | `FIXED_OTP=123456` | **`FIXED_OTP=123456`** (+ `ALLOW_FIXED_OTP=true`) | **real MSG91** — no `FIXED_OTP`, no `ALLOW_FIXED_OTP` |
| Secrets | `api/.env`, `platform/.env` (never committed) | Secret Manager `posm-staging-*` | Secret Manager `posm-prod-*` |
| Images | — | `…/posm/posm-api:<SHA>`, `…/posm/posm-frontend:<SHA>` (built for staging) | same repo/names, **built separately** for prod from `main` |
| Min instances | — | 0 | 0 (1 for a warm prod is an open decision) |
| Runtime SA | — | `posm-api-staging@$PROJECT_ID.iam.gserviceaccount.com` | `posm-api-prod@$PROJECT_ID.iam.gserviceaccount.com` |

Secrets per env (`<env>` = `staging` | `prod`): `posm-<env>-database-url`, `posm-<env>-jwt-secret`,
`posm-<env>-msg91-auth-key`, `posm-<env>-msg91-otp-template-id`, `posm-<env>-msg91-smtp-pass`,
`posm-<env>-msg91-smtp-user`.

Image registry: `asia-south1-docker.pkg.dev/$PROJECT_ID/posm/{posm-api,posm-frontend}:<GIT_SHA>`.

**`JWT_SECRET` must be identical on the API and the frontend of the SAME environment** (the Next
edge proxy `platform/src/proxy.ts` verifies the access-token cookie with it) and **different between
staging and prod**. Both services read the one `posm-<env>-jwt-secret` secret.

## 2. How a deploy flows

```
 feature branch ──PR──▶ develop ──push──▶ [test.yml gates] ──green──▶ deploy-staging.yml (AUTO)
                           │                                              │
                           │                                  build 2 images (tag = GIT_SHA)
                           │                                  → run Job posm-migrate-staging (wait)
                           │                                  → deploy posm-api-staging, posm-frontend-staging
                           │                                  → print serving revision + SHA
                           ▼
              owner-approved PR develop ──▶ main      (NEVER auto-merged)
                           │
                           └─ owner clicks Actions → deploy-prod.yml → Run workflow (ref: main)
                                    [test gate] → build SEPARATE prod images (tag = GIT_SHA)
                                    → run Job posm-migrate-prod (wait)
                                    → deploy posm-api-prod, posm-frontend-prod
                                    → print serving image SHA   ← verify (§4)
```

Rules that hold in every step:
- **A red suite blocks the deploy.** Deploy jobs `needs: test`; a red `test` silently *skips* them, so
  "pushed" ≠ "deployed" — always confirm the serving image SHA (§4).
- **Gates** (also what `test.yml` runs): `cd api && npx prisma generate && npx tsc --noEmit && npx jest --no-coverage && npx nest build`;
  `cd platform && npx tsc --noEmit && npx vitest run`.
- **Staging and prod build separate images per SHA** (the frontend bakes `NEXT_PUBLIC_API_URL`, which
  differs per env, so an image is never promoted between envs).
- **Migrations run BEFORE the services roll out**, so the new schema must be backward-compatible with
  the *currently serving* API for the few seconds/minutes between (see runbook "DB migration rollback").
- Concurrency: one deploy per env at a time (`cancel-in-progress: false`).
- **Prod is never automatic.** Each prod action (dispatch, migration, secret change, DB restore)
  needs the owner's explicit go; one approval does not extend to the next action.

## 3. How migrations run

- Command: `npx prisma migrate deploy` (Prisma 7 CLI reads `api/prisma.config.ts`; the connection
  comes from `DATABASE_URL`). Forward-only — `migrate deploy` never creates or reverses anything.
- Where: the Cloud Run **Job** `posm-migrate-<env>`, running the **same API image** as the services
  (so the migration set always matches the code being deployed), inside the VPC so it reaches Cloud
  SQL the same way the API does. The deploy workflow updates the Job to the new image, executes it
  and **waits**; a non-zero exit aborts the rollout before any service changes.
- Run by hand (e.g. re-run after a fix; see runbook for the full procedure):
  ```bash
  gcloud run jobs execute posm-migrate-<env> --region asia-south1 --project $PROJECT_ID --wait
  ```
- Local: `cd api && npx prisma migrate deploy` (and `npx prisma generate` first after any schema change).

## 4. How to find what is actually serving

Never trust a branch HEAD or a green workflow — ask Cloud Run.

```bash
# Serving image (the tag IS the git SHA) + latest ready revision
gcloud run services describe posm-api-<env> --region asia-south1 --project $PROJECT_ID \
  --format='value(status.latestReadyRevisionName, spec.template.spec.containers[0].image)'
gcloud run services describe posm-frontend-<env> --region asia-south1 --project $PROJECT_ID \
  --format='value(status.latestReadyRevisionName, spec.template.spec.containers[0].image)'

# Which revision(s) actually receive traffic (a rollback pins traffic — latestReady may NOT be serving)
gcloud run services describe posm-api-<env> --region asia-south1 --project $PROJECT_ID \
  --format='yaml(status.traffic)'

# Service URL (what to put in NEXT_PUBLIC_API_URL / smoke tests)
gcloud run services describe posm-frontend-<env> --region asia-south1 --project $PROJECT_ID \
  --format='value(status.url)'
```

Cross-checks from the outside:
- API liveness/readiness: `GET <api-url>/health` and `GET <api-url>/health/ready` (readiness checks
  the DB). Unversioned (not under `/v1`).
- Frontend build id: `GET <frontend-or-edge-url>/version` (public, opaque) — the frontend is built with
  `BUILD_ID=<GIT_SHA>`, so this should equal the SHA in the image tag.

## 5. Login / OTP facts

- Login is **phone + OTP**. The fixed-OTP bypass is a universal-login backdoor, so it is gated in
  `api/src/common/fixed-otp.ts` (fail-closed). It is honored ONLY when:
  1. `NODE_ENV` is explicitly `development` or `test` (local), **or**
  2. (staging box, which runs `NODE_ENV=production`) `ALLOW_FIXED_OTP=true` **and** `DATABASE_URL`
     matches `/posm_staging`.
  And it is **hard-refused** whenever `DATABASE_URL` matches `/posm_prod` (defense-in-depth).
- **local** and **staging**: OTP is `123456` (`FIXED_OTP=123456`; staging also needs `ALLOW_FIXED_OTP=true`).
  No SMS/email is sent.
- **prod**: real MSG91 (`MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`; email via the SMTP secrets). Prod must
  set **neither** `FIXED_OTP` nor `ALLOW_FIXED_OTP`. Never weaken or "temporarily" bypass this guard to
  debug prod login.
- Naming caveat: the staging positive-match and the prod refusal key off the DB **names**
  `posm_staging` / `posm_prod`. Do not create restore/scratch databases whose names start with those
  strings expecting different behavior (see runbook, DB restore).
- Sessions: httpOnly `token` cookie (~60 min, `JWT_EXPIRES_IN=60m`) + 7-day rolling `refresh_token`
  cookie, set `Secure` whenever the frontend runs with `NODE_ENV=production` (staging and prod) — so
  staging/prod must be reached over **https** (Cloud Run URLs and the edge both are).
- Seeded users/phones and roles (GIFSY_ADMIN, CLIENT_ADMIN, ASM, AUDITOR, VENDOR_HO, VENDOR_FIELD): see
  the API seed; the first prod admin is created deliberately by the owner, not by a seed with known
  credentials.

## 6. Edge / domain — OWNER DECISION (do not assume a domain)

The **only public entry point is the frontend**. The browser calls same-origin `/api/*`; Next rewrites
that to `${NEXT_PUBLIC_API_URL}/v1/*` on the server side and injects the Bearer token from the httpOnly
cookie (`platform/next.config.ts`, `platform/src/proxy.ts`). So the edge only has to put a hostname in
front of `posm-frontend-<env>`; the API can stay on its `*.run.app` URL (no CORS needed for the app
itself; `CORS_ORIGINS` should still list the public frontend origin(s)).

Three ways to give the frontend a hostname. **Which one — and which domain — is for the owner to
choose.** Nothing in the app requires a specific domain (the proxy only derives a best-effort
`x-tenant-slug` from the first host label, which is cosmetic today).

| Option | What | Pros | Cons |
|---|---|---|---|
| **A. Cloudflare Worker** (template: `cloudflare/`) | Host-based proxy `posm.<DOMAIN>` → `posm-frontend-prod` URL; `uat-posm.<DOMAIN>` → staging. Same pattern as the main-Gifsy `*.gifsy.in` worker. | Consistent with the existing platform; WAF/caching/DDoS in front; staging can be locked with Cloudflare Access; no Cloud Run feature-availability dependency; no certificate handling. | Needs the zone on Cloudflare; one extra hop; the worker must keep redirects on the public host (it does — see `cloudflare/worker.js`); Cloud Run sees `*.run.app` as Host. |
| **B. Cloud Run domain mapping** | `gcloud beta run domain-mappings create --service posm-frontend-prod --domain posm.<DOMAIN> --region asia-south1`, then add the DNS records it prints. | No extra component; Cloud Run host = public host (no redirect/Host subtleties). | Domain mappings are a preview/limited-availability feature with regional restrictions and weaker latency characteristics — **verify `asia-south1` support in the current docs/console before choosing it**; no WAF. |
| **C. Global external HTTPS LB + serverless NEG** | Google-managed cert + Cloud Armor. | Production-grade, region-proof. | Most expensive/complex of the three; overkill for this app. |

**Recommendation:** if the chosen domain's DNS is on Cloudflare (as `gifsy.in` is), use **A** — it
matches how the rest of the platform is fronted and avoids depending on domain-mapping regional
availability; otherwise use **B** (after verifying region support). **Until a domain is chosen, use
the raw `*.run.app` frontend URLs — the app works fully on them.** The Worker is an *optional template*,
not a requirement; deploying it is a Wave-D step gated on the domain decision.

Things to verify on **staging** whichever option is chosen (they are the failure modes of any
reverse proxy in front of this app's cookie + redirect logic):
1. Login on the public host sets the cookie on the public host and the post-login redirect stays on
   the public host (not `*.run.app`). `proxy.ts` builds redirects from `request.url`; behind option A
   the worker forwards `X-Forwarded-Host`/`X-Forwarded-Proto` and also rewrites any `Location` that
   points at the upstream back to the public host as a safety net.
2. `GET /version` on the public host returns the expected SHA.
3. Photo upload (recce/install) succeeds end-to-end. Note Cloud Run enforces a request-size ceiling
   (32 MiB for HTTP/1) and Cloudflare has its own plan-dependent limit; phone photos are well under both.
4. If the API is made non-public (IAM-only ingress), the frontend service identity needs
   `roles/run.invoker` on it — otherwise the `/api/*` rewrite fails with 403. (Terraform's call;
   flagged here because it is an edge-visible symptom.)

## 7. Open decisions that affect this document

From `DEPLOYMENT-PLAN.md` §5 — fill in as the owner decides, then update the table in §1:
1. POSM prod DB placement (`gifsy-shared` per blueprint vs dedicated instance vs dedicated project).
2. Dedicated GCP project vs shared Gifsy project (`$PROJECT_ID`).
3. **Domain/branding + edge option (§6).**
4. Prod min-instances (0 vs 1) and DR posture (backups only vs PITR vs standby).
5. Repo privacy + GitHub Actions billing/spending limit (a billing block stops every deploy).

## Status log
- 2026-10-01: scaffold written (workstream E). No cloud resources exist; all URLs/domains above are placeholders.
