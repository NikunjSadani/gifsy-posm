# Resources shared by BOTH environments. Created only when manage_shared_resources = true,
# i.e. in exactly one of the two states (normally staging, applied first). The other env's
# state only needs the deployer's *email* (a derived string, see locals.tf) so it never reads
# these resources.

############################################
# APIs
############################################

locals {
  required_apis = [
    "artifactregistry.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "compute.googleapis.com", # Direct VPC egress / private-IP Cloud SQL
    "iam.googleapis.com",
    "iamcredentials.googleapis.com", # WIF token exchange + GCS V4 signed URLs (signBlob)
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "servicenetworking.googleapis.com", # private-IP Cloud SQL (only used if sql_private_network is set)
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
    "sts.googleapis.com", # WIF
  ]
}

resource "google_project_service" "apis" {
  for_each = var.manage_shared_resources && var.enable_apis ? toset(local.required_apis) : toset([])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false # never switch an API off for other workloads in the project
}

############################################
# Artifact Registry (Docker) — repo `posm`
############################################
# Images: <region>-docker.pkg.dev/<project>/posm/posm-api:<GIT_SHA> and .../posm-frontend:<GIT_SHA>

resource "google_artifact_registry_repository" "posm" {
  count = var.manage_shared_resources ? 1 : 0

  project       = var.project_id
  location      = var.region
  repository_id = local.ar_repo_id
  format        = "DOCKER"
  description   = "gifsy-posm container images (one image per git SHA; staging and prod build separately)."

  # Cleanup: KEEP the N most recent versions of every image; DELETE anything older than 90 days
  # that is not covered by the keep rule. Starts in DRY RUN so nothing is deleted until the
  # owner has checked the policy against the revisions that must stay rollback-able.
  cleanup_policy_dry_run = var.ar_cleanup_dry_run

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = var.ar_keep_recent_versions
    }
  }

  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "7776000s" # 90 days
    }
  }

  depends_on = [google_project_service.apis]
}

############################################
# Deployer service account (CI) — posm-deployer
############################################

resource "google_service_account" "deployer" {
  count = var.manage_shared_resources ? 1 : 0

  project      = var.project_id
  account_id   = local.deployer_sa_id
  display_name = "gifsy-posm CI deployer (GitHub Actions via WIF)"

  depends_on = [google_project_service.apis]
}

# Deploy/execute Cloud Run services + jobs. run.developer = create/update services and jobs and
# run executions; it can NOT change IAM policies (those stay in Terraform).
resource "google_project_iam_member" "deployer_run_developer" {
  count = var.manage_shared_resources ? 1 : 0

  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.deployer[0].email}"
}

# Push images — scoped to the one repo, not project-wide.
resource "google_artifact_registry_repository_iam_member" "deployer_ar_writer" {
  count = var.manage_shared_resources ? 1 : 0

  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.posm[0].repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer[0].email}"
}

############################################
# Workload Identity Federation: GitHub Actions -> posm-deployer (no long-lived keys)
############################################

resource "google_iam_workload_identity_pool" "github" {
  count = var.manage_shared_resources ? 1 : 0

  project                   = var.project_id
  workload_identity_pool_id = local.wif_pool_id
  display_name              = "GitHub Actions"
  description               = "OIDC trust for GitHub Actions workflows."

  lifecycle {
    precondition {
      condition     = var.github_repo != ""
      error_message = "github_repo (owner/name) must be set when manage_shared_resources = true."
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  count = var.manage_shared_resources ? 1 : 0

  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github[0].workload_identity_pool_id
  workload_identity_pool_provider_id = local.wif_provider_id
  display_name                       = "GitHub"

  attribute_mapping = {
    "google.subject"             = "assertion.sub"
    "attribute.repository"       = "assertion.repository"
    "attribute.repository_owner" = "assertion.repository_owner"
    "attribute.ref"              = "assertion.ref"
  }

  # Hard gate: ONLY tokens minted for this repo are accepted by the provider at all.
  attribute_condition = "assertion.repository == \"${var.github_repo}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# Let identities from that repo impersonate the deployer SA.
# (Branch/environment restriction — e.g. prod only from `main` — is enforced by the workflow's
# `workflow_dispatch` + branch protection; tighten here with attribute.ref if desired.)
resource "google_service_account_iam_member" "deployer_wif" {
  count = var.manage_shared_resources ? 1 : 0

  service_account_id = google_service_account.deployer[0].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/projects/${data.google_project.this.number}/locations/global/workloadIdentityPools/${local.wif_pool_id}/attribute.repository/${var.github_repo}"
}
