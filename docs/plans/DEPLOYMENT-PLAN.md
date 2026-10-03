# gifsy-posm — CI/CD + Staging + Production deployment plan

**Status: PLAN / for owner review (2026-10-01). Nothing provisioned yet.** This is a client
application (Kwality POSM), so it needs the full 3-environment + CI/CD treatment, mirroring the
proven main-Gifsy platform topology and governed by `~/.claude/PLATFORM-BLUEPRINT.md`.

## 0. Where we are today (verified)

- Repo is **local-only**: a single `develop` branch, **no git remote**, no CI, empty `terraform/`,
  no Dockerfiles, only local `.env` files.
- The **app is deploy-ready**: `start:prod` (`node dist/main`), `main.ts` fails fast on missing prod
  secrets, migrations are `migrate deploy`-safe (self-healing), media switches by env
  (`STORAGE_DRIVER`). Login is **email + password** (no OTP, 2026-10-01); MSG91 is email-only.
- Target architecture is already written in `POSM-BUILD-PLAN.md`: Cloud Run (min=0, `asia-south1`),
  GCS media, MSG91, Cloudflare Worker edge — i.e. the same shape your main Gifsy platform runs.

## 1. Target topology (3 environments)

Mirror the main-Gifsy pattern, adapted for this standalone product:

| Concern | local (exists) | staging | production |
|---|---|---|---|
| Trigger | — | auto-deploy on push to `develop` | manual `workflow_dispatch` on `main` |
| API | `nest start --watch` :4000 | Cloud Run `posm-api-staging` | Cloud Run `posm-api-prod` |
| Frontend | `next dev` :3000 | Cloud Run `posm-frontend-staging` | Cloud Run `posm-frontend-prod` |
| DB | local PG `posm_dev` :5433 | `posm_staging` on the shared Cloud SQL instance | `posm_prod` (see §5 decision) |
| Media | local disk (`STORAGE_DRIVER=local`) | GCS `posm-staging-files` | GCS `posm-prod-files` |
| Login | email + password | email + password | email + password (no OTP) |
| Secrets | `.env` | Secret Manager (staging) | Secret Manager (prod) |
| Edge/domain | localhost | `uat-posm.<domain>` (or `*.gifsy.in`) | `posm.<domain>` / client domain |
| Min instances | — | 0 | 0 (or 1 for warm prod — decision) |

Cross-cutting: Artifact Registry for images (one image per git SHA, built separately per env);
DB migrations run as an **in-VPC Cloud Run Job** (`migrate deploy`) before each service rollout
(exactly the gifsy pattern); GitHub↔GCP auth via **Workload Identity Federation** (no long-lived
keys); a red test suite must **block** every deploy (`needs: test`).

## 2. Workstreams → how I'll orchestrate it

The scaffolding (all code/config) parallelises cleanly across disjoint files. I'll pin a contract,
fan out sub-agents, then **I** integrate, run the gates, and own the result (WoW #3). Provisioning
and E2E verification are inherently sequential (cloud steps depend on each other) — that part is me
+ you, not agent-parallel.

**Wave A — scaffolding build (parallel sub-agents, ~5):**
- **Agent 1 · Containers** — multi-stage `Dockerfile` for `api/` (prod deps + `prisma generate` +
  `dist`) and `platform/` (Next standalone output), `.dockerignore`, image hardening (non-root,
  pinned base), local `docker-compose` for parity.
- **Agent 2 · CI/CD** — GitHub Actions: `test.yml` (the 4 gates), `deploy-staging.yml` (on `develop`:
  build → push → migrate Job → deploy both services), `deploy-prod.yml` (`workflow_dispatch` on
  `main`), image-per-SHA, concurrency guards, deploy summary.
- **Agent 3 · Terraform** — Cloud Run services (both envs), Cloud SQL DB + app users, GCS buckets
  + lifecycle, Secret Manager entries, Artifact Registry, service accounts + IAM least-privilege,
  WIF pool/provider, (optionally) the migrate Job. Written + `plan`-clean; **applied by/with you**.
- **Agent 4 · App env-readiness** — `.env.staging` / `.env.production` templates, boot-time config
  validation (fail fast on a missing prod secret), `/healthz` + `/readyz` endpoints (readiness gates
  Cloud Run traffic), structured prod logging, the migrate-Job entrypoint, Next `output: 'standalone'`.
- **Agent 5 · Edge + docs** — Cloudflare Worker / domain routing (reuse the `*.gifsy.in` worker
  pattern or a client domain), `ENVIRONMENTS.md`, a **runbook** (deploy, rollback, hotfix, secret
  rotation, DB restore).

**Wave B — provisioning (sequential; me preparing exact commands, you running the privileged ones):**
bootstrap GCP project/APIs → WIF + repo secrets → Cloud SQL instance + `posm_staging` DB → Artifact
Registry → `terraform apply` (staging) → first staging deploy → migrate → smoke.

**Wave C — staging verification (me):** real-login-per-role E2E on the staging URL (reuse the
`platform/e2e` harness, env-parameterised), role/tenant isolation, media upload→view, the login path,
the new report + HO flow + bulk upload, honest unhappy paths. Evidence, not claims (WoW #4).

**Wave D — production (your go):** `terraform apply` (prod) → DNS/Cloudflare → `main` cutover via
`workflow_dispatch` → migrate → verify serving image SHA + boot smoke → a real email+password login check.

**Wave E — hardening + sign-off:** Cloud Monitoring dashboards + uptime/error-rate/latency alerts,
Cloud SQL automated backups + PITR, a rollback drill, and a **DUAL adversarial audit** of the
deploy + prod-auth path (money/identity-adjacent → WoW #5), then the go-live runbook sign-off.

## 3. Dependencies on you (the blockers — I can't do these)

I write every file and hand you the exact commands; these need your access/decisions:

1. **GitHub** — create the (private) remote repo; I set the remote + push. You add repo secrets and
   approve the WIF binding.
2. **GCP** — a project + **billing enabled** + required APIs (Run, SQL, Secret Manager, Artifact
   Registry, IAM). Decision: dedicated `kwality-posm` project vs the shared Gifsy project (§5).
3. **Cloud SQL** — the **`gifsy-shared` instance does not exist yet** (blueprint "to build"); it must
   be created (or decide POSM gets its own instance — §5).
4. **Secrets** — prod **MSG91** SMTP credentials (email reports); any client-specific keys. (JWT/DB secrets I
   generate.)
5. **Domain** — the client-facing hostname + Cloudflare access (or your DNS).
6. **Privileged runs** — either you run `terraform apply` / `gcloud` (I supply exact commands), or
   you authorise me to run them in an authenticated shell. I will **not** apply cloud infra, touch a
   shared/prod DB, or cut over to prod without your explicit go each time (WoW #8).
7. **Go/no-go gates** — staging → prod promotion is yours to approve.

## 4. Agents & timeline (honest)

- **Agents:** ~**5** parallel sub-agents for Wave A only, spawned **only on your go**. Waves B–E are
  mostly sequential (me + you), so they're not agent-heavy — a couple of focused agents at most
  (e.g. the E2E harness lane, the audit lane). Call it **5–7 agent-runs total** across the project.
- **My active engineering time** (writing + integrating + gating + verifying), assuming infra access
  is unblocked when each wave starts:
  - Wave A scaffolding: ~**0.5–1 day**
  - Wave B provisioning (my side; excludes your turnaround): ~**0.5 day**
  - Wave C staging verification: ~**0.5 day**
  - Wave D production cutover: ~**0.5 day**
  - Wave E hardening + dual audit: ~**0.5–1 day**
  - **≈ 2.5–3.5 days of active work.**
- **Calendar time is dominated by YOUR turnaround**, not my work: GCP project + billing approval,
  creating the Cloud SQL instance, and DNS propagation are the long poles. With access ready up
  front this is roughly a **3–5 working-day** calendar; if GCP/billing/domain take days to sort, the
  calendar stretches by exactly that. I can't give a wall-clock number for the parts I don't control.

## 5. Decisions to confirm before Wave A (genuine forks)

1. **Where does POSM production live? — ✅ DECIDED 2026-10-03.** POSM prod = a dedicated `posm_prod`
   database on the **shared `opshub-db` instance** (project `opshub-506704`), one-DB-per-product. At
   go-live that instance is **upgraded from `db-f1-micro` to `db-g1-small` (ZONAL, 1.7 GB, matching
   loyaltybase `gifsy-db`)**. POSM's Cloud Run runs in **its own GCP project**, connecting cross-project
   to `opshub-db` (POSM SA needs `cloudsql.client` on `opshub-506704`). DB users are locked down: the
   POSM runtime user is confined to `posm_prod` (no access to opshub's financial DBs); migrations use an
   elevated user. **No infra change during the build** — local dev stays as-is; the tier bump +
   `posm_prod` DB + locked users happen at go-live.
   - *Rationale (grounded in live gcloud + 7-day Cloud Monitoring, 2026-10-03):* on both instances CPU
     (~13%) and connections (3) are non-issues; **memory is the only constraint**. opshub's f1-micro
     memory is pegged; g1-small is ~2.8× its RAM and should hold opshub+POSM together at launch.
     g1-small (1.7 GB) → `db-custom-1-3840` (3.75 GB) is the next rung — **no interim RAM exists** between
     the shared-core ceiling (1.7 GB) and the dedicated-core floor (3.75 GB).
   - ⚠️ *Shared blast radius:* an OOM spike from **either** product OOM-stops the whole instance (brief
     restart, joint opshub+POSM outage). Cloud SQL does **not** auto-scale RAM — only storage — so the
     only fix is a manual tier bump (which itself needs a restart). Hence the fast-follow ↓.
   - ▶ **Fast-follow (post-go-live):** monitor the shared instance's memory under **real report load**
     (both products' reporting + any bulk-upload/migration overlap). If `components.cache + components.free`
     trends below ~10%, or `components.usage` approaches 90%, **bump to `db-custom-1-3840` (1 vCPU /
     3.75 GB)**. See GO-LIVE-OWNER-CHECKLIST → "Post-go-live fast-follow".
2. **Dedicated GCP project vs shared Gifsy project** (billing, blast radius, IAM separation).
3. **Domain/branding** for the client (e.g. `posm.gifsy.in` vs a Kwality-facing domain) + whether to
   reuse the existing `*.gifsy.in` Cloudflare worker or stand up a separate edge.
4. **Prod warmth** (min=0 cold-start vs min=1 cost) and **DR posture** (backups only vs PITR vs a
   standby) — the blueprint notes single-zone today.
5. **Repo privacy & Actions billing** — your other repos hit GitHub Actions spending-limit blocks;
   confirm billing/limits before CI relies on it.

## 6. What I can start right now with ZERO cloud access

Wave A in full (Dockerfiles, GitHub Actions, Terraform-as-code, env templates, health endpoints,
runbook, ENVIRONMENTS.md) — all written, gated, and committed to `develop`, ready to apply the
moment the §3 blockers clear. Say the word and I'll kick off Wave A.

## Status log
- 2026-10-01: plan written for owner review. Awaiting §5 decisions + §3 access before any build.
- 2026-10-01: **Wave A COMPLETE** (scaffolding only — nothing applied). Built by 5 parallel
  sub-agents against DEPLOY-CONTRACT.md, then integrated + gated. Delivered: api/platform
  Dockerfiles + docker-compose; GitHub Actions test/deploy-staging/deploy-prod (WIF, needs:test,
  migrate-job-before-rollout, serving-SHA verify, traffic self-heal); Terraform (Cloud Run ×2 env,
  Cloud SQL shared-or-dedicated, GCS, Secret Manager, IAM/WIF, Artifact Registry) — `terraform
  validate` passes; `.env.{staging,production}.example` (api+platform); migrate helper; prod-secret
  startup guard in main.ts; ENVIRONMENTS.md + DEPLOY-RUNBOOK.md + Cloudflare worker; .gitignore for
  state/secrets. **Gates:** api tsc 0 + jest 388, FE tsc 0 + vitest 281, terraform validate OK, all
  YAML valid. Commits on `develop` (`…` Wave A). NOTE: the full DUAL adversarial audit of the deploy
  + prod-auth path is Wave E (pre-go-live), not done yet.
  ▶ **Still blocking Wave B (owner):** §5.1 production-DB decision; §3 access (GitHub remote, GCP
  project + billing, the `gifsy-shared` Cloud SQL instance, prod MSG91 secrets, domain). Plus two
  provisioning actions surfaced during integration: (a) seed staging/prod Client with a stable
  `id:'kwality'` so `NEXT_PUBLIC_CLIENT_ID` works; (b) first `terraform apply` uses a bootstrap
  image + `enable_health_probes=false` (services need an image to exist before CI's first deploy).
- 2026-10-02: **more features shipped on `develop` (still local-only; nothing deployed)** — grouped
  admin left-sidebar nav; Execution-report frozen/grouped table + **streamed xlsx export (no 20k cap)**;
  ASM pending-recce reminder emails (now with a **unique-ledger** against multi-instance duplicates);
  **nodemailer 6→10** (clears its HIGH advisories); **POSM-type reference photo + field catalogue**;
  `scripts/start-db.mjs` (local dev DB auto-start). Gates now: **api tsc 0 + jest 389, FE tsc 0 +
  vitest 295**. Owner-independent pre-deploy de-risking done this day: fresh-DB `migrate deploy` from
  empty applies all 10 migrations cleanly; `terraform validate` + `fmt` clean; prod-mode (`NODE_ENV=
  production`) boots and the missing-secret fail-fast fires; all 5 roles authenticate. Added
  `scripts/bootstrap-gcp.sh` + `GO-LIVE-OWNER-CHECKLIST.md`. ⚠️ No automated E2E/Playwright harness
  existed in THIS repo (the `[e2e-harness]` memory is the other Gifsy platform) — POSM verification was
  manual/browser. **(Addressed 2026-10-03 — see below.)** Owner blockers unchanged (§3 access + §5.1 DB decision).
  - 2026-10-02 (cont.): closed the last owner-independent gaps. Added `api/scripts/seed-prod.mjs` — the
    prod bootstrap seed (Client with stable id `kwality` + one CLIENT_ADMIN from env; idempotent,
    prod-safe, no test data) — resolving the Wave-B "seed staging/prod Client" dependency; verified on a
    throwaway DB (client+admin created, password verifies, idempotent re-run, inputs validated, demo DB
    untouched). Added `scripts/smoke-test.sh` (frontend→proxy→api→DB one-command check; PASSED on the
    local stack). Static-reviewed the deploy pipeline (3 workflows + both Dockerfiles + migrate
    entrypoint): **no defects** — Dockerfile build-args match the workflows, api image does `prisma
    generate` + carries migrations, migrate-before-deploy + drift-check correct, prod is manual-only with
    separate images, expand/contract + rollback already documented in DEPLOY-RUNBOOK §4. Checklist updated
    (Steps 4b seed + 6b smoke).
  - 2026-10-03: **Playwright E2E regression harness added** (`platform/e2e/`, `npm run e2e`) — the gap
    noted above is closed. 24 tests, all green locally: auth per role, cross-role route-gating, admin
    masters + POSM CRUD, field catalogue, per-role consoles, execution-report grouped table + .xlsx
    download. Runs against a running stack (local or deployed via `E2E_BASE_URL`); uses system Chrome
    (`channel: 'chrome'`). Full capture pipeline (camera + geo-fence) is a documented follow-on.
