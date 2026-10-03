# gifsy-posm — Deploy & Operations Runbook

**Status: SCAFFOLD (2026-10-01). Nothing is provisioned; every id below is a placeholder.** Follow this
during provisioning and operations. Topology and names: `ENVIRONMENTS.md` (authoritative);
env-var inventory: `DEPLOY-ENV-VARS.md`; infra-as-code: `terraform/README.md`; pipeline:
`.github/workflows/`.

> ⚠️ **AUTH SUPERSEDED (2026-10-01):** login is now **email + password** (admin-managed), NOT phone+OTP.
> Any step below mentioning `FIXED_OTP` / `ALLOW_FIXED_OTP` / "OTP `123456`" / a "real MSG91 OTP login"
> is obsolete — there is no login OTP in any environment and no `FIXED_OTP` to check for. MSG91 secrets
> are needed only for **email reports**. "Log in per role" means with a seeded email + password. See
> `ENVIRONMENTS.md §5` and `AUTH-EMAIL-PASSWORD-PLAN.md`. (The OTP lines will be scrubbed when this
> runbook is exercised at provisioning time.)

**Conventions.** Run commands in a shell where these are set (Git Bash / Cloud Shell):
```bash
export PROJECT_ID=<gcp-project-id>        # OWNER DECISION (dedicated vs shared Gifsy project)
export REGION=asia-south1
export SQL_INSTANCE=opshub-db             # DECIDED: shared instance (exists; upgrade to g1-small at go-live)
export SQL_INSTANCE_PROJECT=opshub-506704 # the OpsHub project that owns it (cross-project)
export ENV=staging                        # or prod — set deliberately before every env-specific command
```
**Approval rule:** every prod-affecting step (prod dispatch, prod migration, prod secret change, prod DB
restore, prod `terraform apply`) needs the owner's explicit go. One approval does not extend to the
next action. Windows note: secrets pasted from Windows shells can pick up a trailing `\r`/newline —
always use `printf %s` and byte-verify (see §6).

---

## 1. First-time bootstrap (owner tasks, in order)

Each step lists what unblocks the next. Do not skip ahead — later steps assume earlier ones.

1. **Decide the open items** (`DEPLOYMENT-PLAN.md` §5): prod DB placement, GCP project, domain/edge option,
   prod min-instances + DR posture, GitHub Actions billing/spending limit.
2. **GitHub.** Create the (private) repo; add the remote, push `develop` and `main`. Set an Actions
   **spending limit / confirm billing** first — a billing block silently stops every deploy.
   Protect `main` (PR required; no force-push; the owner is the only merger).
3. **GCP project + billing**, then enable APIs:
   ```bash
   gcloud config set project $PROJECT_ID
   gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
     artifactregistry.googleapis.com iam.googleapis.com iamcredentials.googleapis.com \
     cloudresourcemanager.googleapis.com storage.googleapis.com compute.googleapis.com \
     vpcaccess.googleapis.com servicenetworking.googleapis.com logging.googleapis.com monitoring.googleapis.com
   ```
   (Trim/extend to whatever `terraform/README.md` lists as required.)
4. **Terraform state bucket + `terraform init`** per `terraform/README.md`.
5. **Cloud SQL instance** — `$SQL_INSTANCE` (`opshub-db`) **already exists** in `$SQL_INSTANCE_PROJECT`
   (`opshub-506704`); do NOT create it. At go-live **upgrade it** `db-f1-micro`→`db-g1-small` (restart;
   shared blast radius with OpsHub — maintenance window). Ensure backups + PITR are on **before** any
   prod data lands (add `--project=$SQL_INSTANCE_PROJECT`):
   ```bash
   gcloud sql instances patch $SQL_INSTANCE --project=$SQL_INSTANCE_PROJECT --tier=db-g1-small --backup-start-time=21:00 --enable-point-in-time-recovery
   ```
   Grant the POSM api SA `roles/cloudsql.client` on `$SQL_INSTANCE_PROJECT` (Terraform does this when
   the principal has projectIamAdmin there; otherwise grant by hand).
6. **`terraform plan`, then `apply` for staging** (owner runs, or explicitly authorises a run), using
   `terraform/environments/staging.tfvars.example` copied to `staging.tfvars` and filled in. This creates
   Artifact Registry `posm`, DB `posm_staging` + user `posm_app`, bucket `posm-staging-files`,
   Secret Manager entries, runtime SA `posm-api-staging`, deployer SA `posm-deployer`, WIF
   `github-pool`/`github`, the Cloud Run services and Job. Exact flags: `terraform/README.md`.
   ⚠️ Cloud Run services need an image to exist; follow whatever bootstrap-image approach
   `terraform/README.md` documents (placeholder image + ignore-changes, or apply after the first push).
7. **Populate secret VALUES** (Terraform creates the empty secrets; values are never in git):
   see §6 for the command pattern. Staging: JWT secret (generate), DB URL (from the `posm_app`
   password), and any MSG91 values staging needs (staging uses `FIXED_OTP`, so MSG91 can be dummy
   for OTP but the SMTP secrets are needed if staging sends reports).
8. **GitHub ↔ GCP wiring.** Add the repo variables/secrets the workflows read (WIF provider resource
   name, deployer SA email, project id, region — the exact names are in the header of
   `.github/workflows/deploy-staging.yml`). No long-lived JSON keys.
9. **First staging deploy:** push to `develop` (or re-run `deploy-staging.yml`). Expect: gates → images →
   `posm-migrate-staging` Job → both services. Then verify (§3).
10. **Staging verification** (Wave C): real login per role (OTP `123456`), role/tenant isolation, media
    upload → view, report, HO flow, bulk upload, an honest unhappy path. Evidence, not a claim.
11. **Edge / domain** (only if a domain is chosen — `ENVIRONMENTS.md` §6): Cloudflare worker
    (`cloudflare/`) *or* Cloud Run domain mapping; verify the §6 staging checks (login redirect stays on
    the public host, `/version`, upload).
12. **Prod resources:** fill `prod.tfvars`, `terraform plan`, **owner-approved `apply`** for prod. Create
    `posm-prod-*` secret values, **including real MSG91** (`msg91-auth-key`, `msg91-otp-template-id`,
    SMTP user/pass). Confirm prod has **no** `FIXED_OTP`/`ALLOW_FIXED_OTP` (§3 check).
13. **First prod cutover:** PR `develop → main` (owner merges) → run `deploy-prod.yml` (§2) → verify
    (§3) → real-MSG91 OTP login by an actual phone → create the first real admin deliberately.
14. **Hardening (Wave E):** uptime check on `/health/ready`, error-rate + latency alerts, backups/PITR
    confirmed, a **rollback drill on staging** (§4), then sign-off.

---

## 2. Routine deploy

### Staging (automatic)
1. Run the gates locally first (a red suite silently skips the deploy):
   ```bash
   (cd api && npx prisma generate && npx tsc --noEmit && npx jest --no-coverage && npx nest build)
   (cd platform && npx tsc --noEmit && npx vitest run)
   ```
   Run each gate directly, not piped through `tail`/`head` (the pipe's exit code hides a failure).
2. Merge/push to `develop`. `deploy-staging.yml` runs automatically.
3. Verify (§3). "Pushed" ≠ "deployed".

### Production (manual, owner-gated)
1. Confirm staging is healthy on the SHA you intend to ship (§3, staging).
2. **Back up first if the release contains a migration** (cheap; do it for every prod release):
   ```bash
   gcloud sql backups create --instance $SQL_INSTANCE --description "pre-deploy <SHA>"
   ```
3. Owner-approved PR `develop → main`; merge (never auto-merged).
4. Run the prod workflow: GitHub → Actions → **deploy-prod.yml** → *Run workflow* (branch `main`), or
   ```bash
   gh workflow run deploy-prod.yml --ref main
   gh run watch
   ```
5. Verify (§3, prod). Record the serving SHA in the status log of `ENVIRONMENTS.md`.

---

## 3. Verify a deploy

```bash
export ENV=<staging|prod>

# 1. Serving image + revision (the tag is the git SHA) — must equal the SHA you shipped
for S in posm-api-$ENV posm-frontend-$ENV; do
  echo "== $S"
  gcloud run services describe $S --region $REGION --project $PROJECT_ID \
    --format='value(status.latestReadyRevisionName, spec.template.spec.containers[0].image)'
  gcloud run services describe $S --region $REGION --project $PROJECT_ID --format='yaml(status.traffic)'
done
#    traffic must be 100% on the expected revision (a rollback leaves it pinned elsewhere — §4)

# 2. Migration job's last execution succeeded
gcloud run jobs executions list --job posm-migrate-$ENV --region $REGION --project $PROJECT_ID --limit 3

# 3. Health (api) + build id (frontend)
API_URL=$(gcloud run services describe posm-api-$ENV --region $REGION --project $PROJECT_ID --format='value(status.url)')
FE_URL=$(gcloud run services describe posm-frontend-$ENV --region $REGION --project $PROJECT_ID --format='value(status.url)')
curl -fsS $API_URL/health ; echo
curl -fsS $API_URL/health/ready ; echo          # checks the DB
curl -fsS $FE_URL/version ; echo                # should equal the git SHA
#    API not publicly invokable? use:  gcloud run services proxy posm-api-$ENV --region $REGION --port 8081
#    then curl http://localhost:8081/health

# 4. Config sanity — prod must NOT have the OTP bypass
gcloud run services describe posm-api-$ENV --region $REGION --project $PROJECT_ID \
  --format='yaml(spec.template.spec.containers[0].env)' | grep -E 'FIXED_OTP|ALLOW_FIXED_OTP|STORAGE_DRIVER|GCS_BUCKET|NODE_ENV'
#    prod: expect NO FIXED_OTP / ALLOW_FIXED_OTP lines, STORAGE_DRIVER=gcs, GCS_BUCKET=posm-prod-files
#    staging: FIXED_OTP=123456 and ALLOW_FIXED_OTP=true, GCS_BUCKET=posm-staging-files

# 5. Recent errors
gcloud run services logs read posm-api-$ENV --region $REGION --project $PROJECT_ID --limit 50
```
Then a **boot smoke through the real UI**: log in (staging OTP `123456`; prod real OTP), load an admin
page, view a photo (media via `/api/media/view`), and for a release with new behaviour exercise it.

---

## 4. Rollback (code)

Cloud Run keeps old revisions, so a bad release is reverted by moving traffic — no rebuild.
**Roll back first, diagnose afterwards.** Prod rollback still needs the owner's go (unless it is an
active incident and the owner is unreachable — then do it and report immediately).

```bash
export ENV=prod
# 1. List revisions (newest first) and pick the last known-good one
gcloud run revisions list --service posm-api-$ENV --region $REGION --project $PROJECT_ID \
  --format='table(metadata.name, metadata.creationTimestamp, spec.containers[0].image)' --limit 10
gcloud run revisions list --service posm-frontend-$ENV --region $REGION --project $PROJECT_ID \
  --format='table(metadata.name, metadata.creationTimestamp, spec.containers[0].image)' --limit 10

# 2. Pin 100% traffic to the prior revision (frontend AND api if the release touched both)
gcloud run services update-traffic posm-api-$ENV      --region $REGION --project $PROJECT_ID --to-revisions=<PRIOR_API_REVISION>=100
gcloud run services update-traffic posm-frontend-$ENV --region $REGION --project $PROJECT_ID --to-revisions=<PRIOR_FE_REVISION>=100

# 3. Verify (§3) — traffic block shows the prior revision; /version shows the prior SHA
```

Caveats — read before using:
- **Roll back api + frontend together** if the release changed the API contract; the frontend image has
  `NEXT_PUBLIC_API_URL`/`BUILD_ID` baked in per SHA.
- **The database is NOT rolled back** (migrations are forward-only, §5). The previous revision must run
  against the *already-migrated* schema. Releases should therefore be expand/contract: add columns/tables
  in release N, drop/rename only in a later release once N-1 is retired. If a migration was destructive or
  breaking, a code rollback alone will not fix it — go to §5/§7.
- **Pinned traffic stays pinned.** After `--to-revisions`, a later deploy creates a new revision but may
  NOT receive traffic. To return to "latest revision serves": 
  `gcloud run services update-traffic posm-api-$ENV --region $REGION --project $PROJECT_ID --to-latest`
  (same for the frontend). ⚠️ Integrator: confirm the deploy workflows pass `--to-latest` / handle a
  pinned service, otherwise a post-rollback deploy will "succeed" without serving.
- To re-ship the rollback target as a proper release, redeploy that SHA through the pipeline later.

## 4a. Hotfix flow (prod broken, fix is small)

1. Branch from **`main`** (what prod serves): `git switch main && git pull && git switch -c hotfix/<name>`.
2. Fix + a regression test; run the full gates (§2.1).
3. PR `hotfix/<name> → main` (the `test.yml` gate runs on the PR); owner merges.
4. Back up the DB if a migration is involved (§2 prod step 2), then dispatch `deploy-prod.yml` on `main`.
5. Verify (§3).
6. **Back-merge** `main` into `develop` (or cherry-pick the fix) the same day, so staging/next release
   keeps the fix and the branches don't diverge. A hotfix that skips staging is a deliberate, owner-approved
   exception — follow up by confirming it on staging after the back-merge deploys.
If the problem is just a bad release, prefer **rollback (§4)** and fix forward on `develop` normally.

---

## 5. Database migrations — forward-only; recovery

`prisma migrate deploy` only ever applies pending migrations forward. There is no automatic down-migration.

**Before any prod migration:** on-demand backup (`gcloud sql backups create …`, §2), and confirm the
migration is backward-compatible with the currently serving API (expand/contract).

**If the migrate Job fails** the rollout stops before any service changes (the old revision keeps serving).
```bash
gcloud run jobs executions list --job posm-migrate-$ENV --region $REGION --project $PROJECT_ID --limit 5
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="posm-migrate-'$ENV'"' \
  --project $PROJECT_ID --limit 50 --format='value(textPayload)' --freshness=1d
```
- *Failed before changing anything* (e.g. connection/permission/syntax error): fix the cause (secret,
  grant, or a corrected migration on `develop`) and re-run the Job (`ENVIRONMENTS.md` §3) or re-dispatch.
- *Failed midway* (Prisma records the migration as failed in `_prisma_migrations`; later runs refuse with
  "failed migration"): inspect the DB state, repair by hand to a consistent state, then tell Prisma:
  `npx prisma migrate resolve --rolled-back <migration_name>` (undone it by hand) or
  `--applied <migration_name>` (completed it by hand), then re-run `migrate deploy`. These commands need
  DB access: run them from a one-off in-VPC execution of the migrate Job with overridden args (depends on
  the entrypoint in `scripts/migrate-entrypoint.sh` — confirm it passes args through), or via Cloud SQL
  Auth Proxy from an owner workstation with temporary access. **Show the exact commands/SQL to the owner
  and wait for a go before touching prod.**
- *A migration shipped and is wrong:* fix **forward** — write a NEW migration that corrects/reverts it,
  gate it, deploy. Never edit or delete an already-applied migration file.
- *Data corrupted/lost:* restore (§5a).

### 5a. DB restore from backup

⚠️ **`$SQL_INSTANCE` IS shared** — `opshub-db` holds POSM staging + prod **and OpsHub's own
databases**. A `gcloud sql backups restore` onto the live instance **overwrites the ENTIRE instance —
every database on it, including OpsHub prod** (backups/PITR are instance-level; there is no per-database
restore). Do NOT do that for a POSM-only problem. Default procedure restores into a **new
scratch instance**, then moves just the `posm_<env>` database.

```bash
# 0. Identify the recovery point
gcloud sql backups list --instance $SQL_INSTANCE --project $PROJECT_ID
#    Point-in-time (if PITR enabled): pick a timestamp just BEFORE the bad event (UTC, RFC3339)

# 1. Clone the instance at that point into a scratch instance (does not touch the live one)
gcloud sql instances clone $SQL_INSTANCE posm-restore-$(date +%Y%m%d) \
  --point-in-time '2026-xx-xxTxx:xx:xx.000Z' --project $PROJECT_ID
#    (from a named backup instead: gcloud sql backups restore <BACKUP_ID> --restore-instance=<NEW_INSTANCE> --backup-instance=$SQL_INSTANCE
#     — only onto a NEW/scratch instance)

# 2. Export just the POSM database from the scratch instance
gcloud sql export sql posm-restore-<date> gs://<SCRATCH_BUCKET>/posm_${ENV}_restore.sql.gz \
  --database=posm_$ENV --project $PROJECT_ID
#    (the instance's service account needs write access to that bucket)

# 3. Import into a NEW database on the live instance and VALIDATE it first
gcloud sql databases create posm_${ENV}_r1 --instance $SQL_INSTANCE --project $PROJECT_ID
gcloud sql import sql $SQL_INSTANCE gs://<SCRATCH_BUCKET>/posm_${ENV}_restore.sql.gz \
  --database=posm_${ENV}_r1 --project $PROJECT_ID
#    inspect row counts / latest records / `_prisma_migrations` (via Auth Proxy or a one-off job)

# 4. Cut over (owner-approved maintenance window) — see options
```
Cut-over options (choose with the owner):
- **Rename swap (keeps the name `posm_prod`):** scale/pause traffic (set the services to deny ingress or
  route to a maintenance revision), terminate connections, `ALTER DATABASE posm_prod RENAME TO posm_prod_old_<date>;
  ALTER DATABASE posm_prod_r1 RENAME TO posm_prod;`, resume, verify (§3). Keep `posm_prod_old_<date>`
  until you are satisfied, then drop it (owner's call — that is a permanent delete).
- **Repoint:** add a new `posm-prod-database-url` version pointing at `posm_prod_r1`, redeploy api (+ the
  migrate Job picks it up on next run). ⚠️ The fixed-OTP guard's layer-1 refusal matches `/posm_prod\b`,
  which does **not** match `posm_prod_r1` (`_` is a word character). Layer-3 still denies the bypass on
  prod (`NODE_ENV=production`, no `ALLOW_FIXED_OTP`), so this is safe **only while prod never sets
  `ALLOW_FIXED_OTP`** — prefer the rename swap to keep the canonical name.
- After either option: delete the scratch instance and bucket object when finished (cost + PII hygiene).
- Media (GCS) is not covered by the SQL restore. Enable bucket object versioning (Terraform) if media
  recovery matters, and restore objects separately.
- A whole-instance restore is a last resort (instance-wide corruption) and needs every tenant owner's
  agreement because it rewinds all databases on the instance.

---

## 6. Secret rotation

Secrets live in Secret Manager as `posm-<env>-<name>` (`ENVIRONMENTS.md` §1). Cloud Run resolves a
secret version when an instance **starts**, so after adding a version you must create a new revision
(redeploy). Terraform creates the secret *objects*; values are managed only here (never in git/tfvars).

```bash
# Add a new version — printf %s (no trailing newline); generate random values without a newline too
openssl rand -base64 48 | tr -d '\n' | gcloud secrets versions add posm-$ENV-jwt-secret --data-file=- --project $PROJECT_ID
printf %s "$VALUE"                   | gcloud secrets versions add posm-$ENV-<name>      --data-file=- --project $PROJECT_ID

# Byte-verify (a Windows shell can add a trailing \r — check the last bytes and the length)
gcloud secrets versions access latest --secret posm-$ENV-<name> --project $PROJECT_ID | xxd | tail -2

# Roll it out: force a new revision on every service that reads the secret
gcloud run services update posm-api-$ENV      --region $REGION --project $PROJECT_ID --update-env-vars ROTATED_AT=$(date +%s)
gcloud run services update posm-frontend-$ENV --region $REGION --project $PROJECT_ID --update-env-vars ROTATED_AT=$(date +%s)
#   (assumes the secret is bound at version "latest"; if bound to a pinned version, update the binding instead,
#    or re-run the deploy pipeline. Terraform should `ignore_changes` the rotated env var.)

# After verifying (§3), disable the old version (reversible), later destroy it
gcloud secrets versions list posm-$ENV-<name> --project $PROJECT_ID
gcloud secrets versions disable <OLD_VERSION> --secret posm-$ENV-<name> --project $PROJECT_ID
```
Per-secret specifics:
- **`jwt-secret`** — read by BOTH api and frontend; update **both back-to-back** or logins/`/api` calls
  fail on the mismatch window. **Rotating invalidates every session** (users re-login via OTP). Do it off-peak.
  Also the response to a suspected token/secret leak.
- **`database-url` / `posm_app` password** — change the password first
  (`gcloud sql users set-password posm_app --instance $SQL_INSTANCE --prompt-for-password --project $PROJECT_ID`),
  immediately add the matching `database-url` version, then redeploy **api** (the migrate Job reads it at
  next execution). Expect a brief error window between the two steps — do it in a quiet period.
- **`msg91-*`** — add version, redeploy **api**; then test a real OTP login on prod (§3 boot smoke).
- Rotate staging first when practising; prod rotation needs the owner's go.

---

## 7. Incident checklist

**Declare + stabilise (first 10 minutes)**
- [ ] State the symptom and start time; note who is on it. Don't change several things at once.
- [ ] Was there a deploy/migration/secret change in the last hours? → §3 (serving SHA, traffic, last
      migrate execution). If yes and the cause is plausible: **roll back (§4)** now, diagnose after.
- [ ] Is it the platform? `gcloud run services describe …` (Ready?), Cloud SQL instance status
      (`gcloud sql instances describe $SQL_INSTANCE --format='value(state)'`), GCP status page.
- [ ] Health: `/health` (process up) vs `/health/ready` (DB reachable). Ready failing ⇒ DB/connection/
      secret problem; liveness failing ⇒ crash loop → logs.
- [ ] Logs: `gcloud run services logs read posm-api-$ENV --region $REGION --limit 100` (and frontend).
      Look for: boot errors (missing/blank secret, `\r` in a secret), DB auth/connection errors, 5xx bursts.
- [ ] Login failing on prod? Check MSG91 (balance/template/DLT, credentials) and that the OTP secrets
      weren't just rotated wrongly. **Do not** enable `FIXED_OTP` on prod to "get people in".
- [ ] Cold-start/latency only? min-instances=0 first request is slow; consider min=1 (owner decision).

**Security-specific**
- [ ] If the fixed-OTP bypass is ever found active on prod (`FIXED_OTP`/`ALLOW_FIXED_OTP` in the env
      listing, §3 check 4): remove the vars and redeploy immediately, **rotate `jwt-secret`** (kills all
      sessions), and review API logs for logins during the exposure window.
- [ ] Suspected secret leak ⇒ rotate that secret (§6) and disable the old version.

**Data**
- [ ] Bad migration / data loss ⇒ stop further writes if needed, §5 / §5a; show exact commands to the
      owner before touching prod data.

**Close out**
- [ ] Confirm recovery with real-UI smoke (§3), not just a green health check.
- [ ] Write the timeline + root cause + the *general* rule learned (not just the one fix); update
      `ENVIRONMENTS.md` status log and this runbook if a step was wrong or missing.
- [ ] Add a regression test / alert so it is caught earlier next time.
