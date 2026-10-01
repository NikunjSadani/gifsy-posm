# gifsy-posm — Terraform (GCP)

Infrastructure-as-code for the POSM app on GCP (`asia-south1`). **Scaffolding only — nothing here has
been applied.** Canonical names come from `docs/plans/DEPLOY-CONTRACT.md`; topology/decisions from
`docs/plans/DEPLOYMENT-PLAN.md`.

## What it creates

One apply manages ONE environment (`staging` or `prod`) in its own state.

| Always (per env) | File |
|---|---|
| Cloud Run services `posm-api-<env>`, `posm-frontend-<env>` (min instances 0) | `cloud_run.tf` |
| Cloud Run job `posm-migrate-<env>` (`npx prisma migrate deploy`, in the api image) | `cloud_run.tf` |
| Database `posm_<env>` + user `posm_app` (random password) on the chosen instance; optional dedicated instance | `cloud_sql.tf` |
| GCS bucket `posm-<env>-files` (uniform access, public access prevented) | `storage.tf` |
| Secret Manager `posm-<env>-{database-url,db-password,jwt-secret,msg91-auth-key,msg91-otp-template-id,msg91-smtp-pass,msg91-smtp-user}` | `secrets.tf` |
| Runtime SAs `posm-api-<env>`, `posm-frontend-<env>` + least-privilege IAM | `iam.tf` |

| Only when `manage_shared_resources = true` (do this in ONE state, staging first) | File |
|---|---|
| Required Google APIs | `shared.tf` |
| Artifact Registry Docker repo `posm` (cleanup policies, dry-run by default) | `shared.tf` |
| Deployer SA `posm-deployer` (`run.developer`, AR writer on the repo) | `shared.tf` |
| WIF pool `github-pool` + provider `github`, locked to `var.github_repo` | `shared.tf` |

## Shared vs dedicated Cloud SQL (decision — DEPLOYMENT-PLAN section 5.1)

Controlled by two variables: `sql_instance` (name) and `create_sql_instance` (bool).

* **Shared / pre-existing** (`create_sql_instance = false`): `sql_instance` must already exist in
  `project_id`/`region` (e.g. `gifsy-shared`, which per the blueprint is "to build" — it does NOT
  exist yet, so create it first or choose dedicated). Terraform reads it with a data source and only
  creates the database `posm_<env>` and the user on it. Cheapest; blast radius is shared with the other
  tenants of that instance (staging, opshub…). Per the 2026-08-25 blueprint, POSM *prod* would land
  here — but Kwality is a paying client, so re-confirm that failure-domain call.
* **Dedicated** (`create_sql_instance = true`): Terraform creates a Postgres instance named
  `sql_instance` (backups + PITR on, deletion protection on, public IP reachable ONLY through the
  Cloud SQL connector — no authorized networks; optional private IP via `sql_private_network` +
  `vpc_network`/`vpc_subnetwork`). Recommended for prod if you want its own failure domain
  (also governed by `sql_tier`, `sql_availability_type`, `sql_point_in_time_recovery`).

Either way the app connects through the Cloud Run Cloud SQL connector (unix socket
`/cloudsql/<project>:<region>:<instance>`); `DATABASE_URL` is generated and stored in
`posm-<env>-database-url` (`postgresql://posm_app:<pw>@localhost/posm_<env>?host=/cloudsql/<conn>` —
`@localhost/` is intentional, an empty host breaks pg/Prisma).

Gotchas
* A DB **user is instance-wide**. If staging and prod databases are on the SAME instance and both
  states create the user, give prod a different name (`db_user = "posm_app_prod"`, as in
  `prod.tfvars.example`); otherwise the two states fight over one user/password.
* Terraform-created users are `cloudsqlsuperuser` members (needed for `prisma migrate` on PG15+), so on
  a shared instance DB-level isolation between `posm_*` and other products' databases is by
  convention, not enforced by Postgres. `roles/cloudsql.client` is project-level, so the api SA could
  reach any instance in the project. A *dedicated project* or *dedicated instance* removes this.
* If ONE dedicated instance should host both envs: create it in one state (`create_sql_instance = true`)
  and point the other state at the same name with `create_sql_instance = false`; apply the creating state first.
* Database/user have `deletion_policy = "ABANDON"`: `terraform destroy` never drops client data.

## Prerequisites

1. A GCP project with **billing enabled**; you (or the identity running Terraform) need Owner, or at
   least: Project IAM Admin, Service Usage Admin, Cloud Run Admin, Cloud SQL Admin, Secret Manager
   Admin, Storage Admin, Artifact Registry Admin, Workload Identity Pool Admin, Service Account Admin.
2. `terraform >= 1.5`, and `gcloud auth application-default login` (ADC) for the apply. 
3. A GCS bucket for Terraform state (see `backend.tf.example`).
4. If using the shared instance: it exists (`gcloud sql instances describe <name>`).
5. The GitHub repo (`owner/name`) that will run CI (needed for WIF).
6. MSG91 values (see "Owner must supply").

## Bootstrap order

1. **State bucket** (once, by hand) and `cp backend.tf.example backend.tf`; set bucket and
   `prefix = "posm/staging"`.
2. **Staging apply first** (creates the shared pieces). `manage_shared_resources = true`.
   Placeholder images + `enable_health_probes = false` (nothing is in Artifact Registry yet).
3. **Add the owner-supplied secrets** (below).
4. **GitHub**: set repo variables from the outputs — `workload_identity_provider` and
   `deployer_service_account_email` (plus project id/region). No JSON keys anywhere.
5. **First CI deploy to staging** pushes `posm-api` / `posm-frontend` images, runs
   `posm-migrate-staging` and rolls the services (`--image` only).
6. Set `enable_health_probes = true` (and optionally the real image vars) and **re-apply staging**
   so the `/health/ready` startup probe and `/health` liveness probe are attached. (Image changes are
   ignored by Terraform from then on.)
7. **Prod**: new state (`prefix = "posm/prod"` — re-run `terraform init -reconfigure`), `prod.tfvars`,
   `manage_shared_resources = false`; repeat 3, 5, 6 against prod. Make the shared-vs-dedicated SQL
   decision before this step. Prod cutover itself is a manual `workflow_dispatch`.

## Commands

```bash
cd terraform
cp backend.tf.example backend.tf                         # edit bucket + prefix (posm/staging)
cp environments/staging.tfvars.example environments/staging.tfvars   # fill in
terraform init
terraform plan  -var-file=environments/staging.tfvars -out staging.plan
terraform apply staging.plan

# switch to prod: edit backend.tf prefix -> posm/prod
terraform init -reconfigure
terraform plan  -var-file=environments/prod.tfvars -out prod.plan
terraform apply prod.plan
```

Never commit `backend.tf`, `*.tfvars`, `*.plan`, `.terraform/` or any `*.tfstate` (the state holds the
generated DB password and JWT secret).

## Owner must supply

| What | Where |
|---|---|
| `project_id`, `environment`, `domain`, `sql_instance` (+ `create_sql_instance`), `msg91_smtp_host`, `reports_from_email` | tfvars (no defaults) |
| `github_repo` (`owner/name`) | tfvars, in the state with `manage_shared_resources = true` |
| MSG91 secret values: `posm-<env>-msg91-auth-key`, `-msg91-otp-template-id`, `-msg91-smtp-user`, `-msg91-smtp-pass` | out-of-band, **never in tfvars/git** |

```bash
# repeat per secret & env; printf (not echo) and no trailing CR/newline
printf '%s' "$VALUE" | gcloud secrets versions add posm-staging-msg91-auth-key --data-file=- --project "$PROJECT_ID"
```

`terraform output owner_supplied_secrets` lists the ones still holding a placeholder. Cloud Run reads
`latest`; after adding a version, a new revision (any CI deploy) picks it up. **Prod must not be
served while any `msg91-*` secret is still `REPLACE_ME_OUT_OF_BAND`.**
`JWT_SECRET`, the DB password and `DATABASE_URL` are generated by Terraform.

## Interfaces for CI and the other workstreams

* Images: `<region>-docker.pkg.dev/<project>/posm/posm-api:<GIT_SHA>`, `.../posm-frontend:<GIT_SHA>`
  (outputs `api_image_repository`, `frontend_image_repository`).
* Terraform ignores each service's / the job's image after creation, so CI deploys with
  `gcloud run deploy <svc> --image ...` / `gcloud run jobs update posm-migrate-<env> --image <api image>`
  then `gcloud run jobs execute posm-migrate-<env> --wait`. Do **not** pass `--set-env-vars` /
  `--update-secrets` from CI (that would drift from this config).
* Frontend `NEXT_PUBLIC_API_URL` build arg = output `api_url` (or the edge URL for the api).
* The api image must contain the Prisma CLI, `prisma.config.ts` and `prisma/migrations` (the job runs
  `npx prisma migrate deploy` in it) and must listen on `process.env.PORT` (Cloud Run injects 8080).
* Staging gets `FIXED_OTP=123456` + `ALLOW_FIXED_OTP=true`; prod gets neither, and a Terraform
  precondition rejects them in `api_extra_env` for prod.
* GCS V4 signed URLs on Cloud Run need no key: the api SA is granted `serviceAccountTokenCreator` on
  itself (IAM `signBlob`). Bucket CORS is not configured (media is served via signed URLs / the api).

## Known limits / things to decide

* Bucket names are globally unique; if `posm-<env>-files` is taken, the contract changes, not just this repo.
* Cloud Run has no readiness probe: `/health/ready` is the startup probe, `/health` the liveness probe
  (api only; Next has no health route so the frontend uses the default TCP probe).
* `allow_public_invoker = true` grants `allUsers` invoker (the app does its own JWT auth). If an org
  policy forbids it, see the note at the bottom of `iam.tf`.
* No monitoring/alerting, VPC connector or Cloudflare routing here (Wave E / edge workstream).
* Nothing in this directory has been `terraform validate`d or applied; run `terraform init -backend=false &&
  terraform validate` and `terraform fmt -check` first when you have the CLI/network available.
