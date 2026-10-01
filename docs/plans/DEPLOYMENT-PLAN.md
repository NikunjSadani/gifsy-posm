# gifsy-posm — CI/CD + Staging + Production deployment plan

**Status: PLAN / for owner review (2026-10-01). Nothing provisioned yet.** This is a client
application (Kwality POSM), so it needs the full 3-environment + CI/CD treatment, mirroring the
proven main-Gifsy platform topology and governed by `~/.claude/PLATFORM-BLUEPRINT.md`.

## 0. Where we are today (verified)

- Repo is **local-only**: a single `develop` branch, **no git remote**, no CI, empty `terraform/`,
  no Dockerfiles, only local `.env` files.
- The **app is deploy-ready**: `start:prod` (`node dist/main`), fixed-OTP backdoor **fails closed**
  on prod/unknown `NODE_ENV` (honored only on dev / `posm_staging`), migrations are
  `migrate deploy`-safe (self-healing), media + OTP switch by env (`STORAGE_DRIVER`, MSG91).
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
| OTP/email | `FIXED_OTP=123456` | `FIXED_OTP=123456` | **real MSG91** |
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
`platform/e2e` harness, env-parameterised), role/tenant isolation, media upload→view, OTP path,
the new report + HO flow + bulk upload, honest unhappy paths. Evidence, not claims (WoW #4).

**Wave D — production (your go):** `terraform apply` (prod) → DNS/Cloudflare → `main` cutover via
`workflow_dispatch` → migrate → verify serving image SHA + boot smoke → real MSG91 OTP check.

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
4. **Secrets** — prod **MSG91** SMTP + OTP credentials; any client-specific keys. (JWT/DB secrets I
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

1. **Where does POSM production live?** The blueprint (owner-agreed 2026-08-25) tiers DBs by trust:
   `gifsy-db` = loyalty **live-client-prod only**; `gifsy-shared` = **staging + opshub + kwality_posm**.
   By that rule POSM prod goes on `gifsy-shared` (its own `posm_prod` DB, one-DB-per-product). ⚠️ But
   Kwality is a **paying client** — putting its *production* on an instance shared with staging/opshub
   is a failure-domain call worth re-confirming now (options: keep on `gifsy-shared` per blueprint /
   dedicated `posm-prod` instance / dedicated project). **This is the #1 decision.**
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
