# Runtime service accounts (per environment) + least-privilege bindings.
#
#   posm-api-<env>       api service + migrate job. cloudsql.client, per-secret accessor,
#                        objectAdmin on ITS bucket only, tokenCreator on itself (V4 signed URLs).
#   posm-frontend-<env>  frontend service. Reads ONLY posm-<env>-jwt-secret. No DB, no bucket.
#                        (Added beyond the contract's api SA: avoids running the internet-facing
#                        Next server with the api's DB + storage rights.)
#
# The deployer SA (shared.tf) gets iam.serviceAccountUser on both so `gcloud run deploy` can
# attach them. Its email is a derived string, so this works even when the deployer lives in
# the OTHER env's state — but that state must have been applied first.

resource "google_service_account" "api" {
  project      = var.project_id
  account_id   = local.api_sa_id
  display_name = "gifsy-posm api runtime (${local.env})"

  depends_on = [google_project_service.apis]
}

resource "google_service_account" "frontend" {
  project      = var.project_id
  account_id   = local.frontend_sa_id
  display_name = "gifsy-posm frontend runtime (${local.env})"

  depends_on = [google_project_service.apis]
}

# --- Cloud SQL connector (needed for the /cloudsql socket) ---
# Project-level because roles/cloudsql.client cannot be granted on an individual instance via IAM
# policy. It is granted in the INSTANCE's project (local.sql_project) — which is project_id for a
# dedicated instance, or the shared instance's project (e.g. opshub-506704) cross-project. The api
# SA can therefore connect-through to any instance in THAT project; DB-level isolation is the per-env
# database + confined posm_app user. (Documented in README.)
# ⚠️ Cross-project: the Terraform principal must have projectIamAdmin on local.sql_project to set this.
resource "google_project_iam_member" "api_cloudsql_client" {
  project = local.sql_project
  role    = "roles/cloudsql.client"
  member  = local.api_sa_member
}

# --- Media bucket: objectAdmin on its OWN bucket only ---
resource "google_storage_bucket_iam_member" "api_bucket_admin" {
  bucket = google_storage_bucket.files.name
  role   = "roles/storage.objectAdmin"
  member = local.api_sa_member
}

# --- V4 signed URLs: on Cloud Run there is no private key, the client library signs through
#     the IAM signBlob API, which needs tokenCreator on the SA itself (self-binding only). ---
resource "google_service_account_iam_member" "api_self_token_creator" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = local.api_sa_member
}

# --- Secrets: per-secret accessor (api: its 6, frontend: jwt only) ---
resource "google_secret_manager_secret_iam_member" "readers" {
  for_each = local.secret_readers

  project   = var.project_id
  secret_id = google_secret_manager_secret.posm[each.value.secret].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = each.value.member
}

# --- CI deployer may attach (actAs) the runtime SAs when deploying services / the job ---
resource "google_service_account_iam_member" "deployer_acts_as_api" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountUser"
  member             = local.deployer_member
}

resource "google_service_account_iam_member" "deployer_acts_as_frontend" {
  service_account_id = google_service_account.frontend.name
  role               = "roles/iam.serviceAccountUser"
  member             = local.deployer_member
}

# Note on frontend -> api: the api service is public (allow_public_invoker, JWT-authenticated at
# the app layer) and the Next server proxies /api/* to it over the public URL, so NO
# run.invoker binding between the two SAs is required. If you set allow_public_invoker=false,
# add `roles/run.invoker` for posm-frontend-<env> on the api service AND teach the proxy to send
# an ID token (not implemented in the app).
