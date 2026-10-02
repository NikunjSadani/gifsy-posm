#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# bootstrap-gcp.sh — one-time, BY-HAND GCP prerequisites for the POSM deploy.
#
# Terraform (terraform/) manages almost everything (Cloud Run, Cloud SQL DB/user,
# GCS media buckets, Secret Manager, IAM, WIF, Artifact Registry). But three things
# cannot be Terraform-managed because they must exist BEFORE `terraform init/apply`:
#   1. the GCS bucket that holds Terraform's own remote state,
#   2. the core Google APIs Terraform needs to even create resources,
#   3. ADC auth for the human running the first apply.
# This script does exactly those, idempotently, then prints the next steps.
#
# It provisions NO application resources and creates NO secrets — it only unblocks
# `terraform apply`. Run it once per PROJECT (not per env). Safe to re-run.
#
# Prereqs: `gcloud` installed + logged in (`gcloud auth login`), and the project
# already created WITH BILLING ENABLED (owner action — see GO-LIVE-OWNER-CHECKLIST.md).
#
# Usage:
#   PROJECT_ID=my-proj STATE_BUCKET=my-proj-tfstate ./scripts/bootstrap-gcp.sh
# Optional:
#   REGION=asia-south1 (default)   SQL_INSTANCE=gifsy-shared (verify it exists if set)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REGION="${REGION:-asia-south1}"
: "${PROJECT_ID:?Set PROJECT_ID (the GCP project, billing already enabled)}"
: "${STATE_BUCKET:?Set STATE_BUCKET (globally-unique name for the Terraform state bucket)}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()  { printf '    \033[32m✓ %s\033[0m\n' "$*"; }
warn(){ printf '    \033[33m! %s\033[0m\n' "$*"; }

command -v gcloud >/dev/null 2>&1 || { echo "gcloud not found — install the Google Cloud SDK first."; exit 1; }
gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q . \
  || { echo "No active gcloud login — run: gcloud auth login"; exit 1; }

say "Project: $PROJECT_ID   Region: $REGION   State bucket: gs://$STATE_BUCKET"
gcloud config set project "$PROJECT_ID" >/dev/null

# ── 1. Billing must be enabled (Terraform silently fails to create paid resources otherwise) ──
say "Checking billing"
if gcloud beta billing projects describe "$PROJECT_ID" --format="value(billingEnabled)" 2>/dev/null | grep -qi true; then
  ok "billing enabled"
else
  warn "could not confirm billing is enabled — enable it in the console before continuing (owner action)."
fi

# ── 2. Enable the core APIs Terraform needs to run (shared.tf re-asserts these; enabling them up
#        front avoids a first-apply ordering race). Idempotent. ──
say "Enabling core APIs (idempotent; may take a minute)"
gcloud services enable \
  serviceusage.googleapis.com \
  cloudresourcemanager.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  run.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  artifactregistry.googleapis.com \
  --project "$PROJECT_ID"
ok "core APIs enabled"

# ── 3. Terraform state bucket (NOT TF-managed — would be a chicken/egg). Versioned + private. ──
say "Terraform state bucket"
if gcloud storage buckets describe "gs://$STATE_BUCKET" >/dev/null 2>&1; then
  ok "gs://$STATE_BUCKET already exists"
else
  gcloud storage buckets create "gs://$STATE_BUCKET" \
    --project "$PROJECT_ID" --location "$REGION" --uniform-bucket-level-access
  ok "created gs://$STATE_BUCKET"
fi
gcloud storage buckets update "gs://$STATE_BUCKET" --versioning >/dev/null
ok "versioning on (state holds generated secrets — keep this bucket's IAM owner/deployer only)"

# ── 4. Optional: if pointing at a pre-existing (shared) Cloud SQL instance, confirm it exists ──
if [[ -n "${SQL_INSTANCE:-}" ]]; then
  say "Checking shared Cloud SQL instance: $SQL_INSTANCE"
  if gcloud sql instances describe "$SQL_INSTANCE" --project "$PROJECT_ID" >/dev/null 2>&1; then
    ok "instance '$SQL_INSTANCE' exists"
  else
    warn "instance '$SQL_INSTANCE' NOT found. Create it, or use a dedicated instance (create_sql_instance=true)."
  fi
fi

cat <<EOF

$(say "Bootstrap done. Next (see terraform/README.md 'Bootstrap order'):")
  1. cd terraform && cp backend.tf.example backend.tf
       set  bucket = "$STATE_BUCKET"   prefix = "posm/staging"
  2. cp environments/staging.tfvars.example environments/staging.tfvars   # fill project_id, sql_instance, github_repo, domain…
  3. terraform init
  4. terraform apply -var-file=environments/staging.tfvars        # manage_shared_resources=true, placeholder images
  5. add owner secrets (MSG91 etc.) to Secret Manager (see GO-LIVE-OWNER-CHECKLIST.md)
  6. set GitHub repo variables from: terraform output workload_identity_provider / deployer_service_account_email
  7. push to develop → CI deploys staging. Then repeat 1–4 for prod (prefix posm/prod, its own tfvars).
EOF
