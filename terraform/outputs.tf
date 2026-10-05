# Values the integrator / CI / owner need. Shared-resource outputs are null in the state that
# does not manage the shared resources (manage_shared_resources = false).

output "environment" {
  description = "Environment this state manages."
  value       = local.env
}

############################################
# Cloud Run
############################################

output "api_service_name" {
  description = "Cloud Run api service name (CI: gcloud run deploy <name> --image ...)."
  value       = google_cloud_run_v2_service.api.name
}

output "api_url" {
  description = "Default run.app URL of the api. Use as the frontend BUILD arg NEXT_PUBLIC_API_URL (the edge/custom domain may replace this later)."
  value       = google_cloud_run_v2_service.api.uri
}

output "frontend_service_name" {
  description = "Cloud Run frontend service name."
  value       = google_cloud_run_v2_service.frontend.name
}

output "frontend_url" {
  description = "Default run.app URL of the frontend (point the edge/Worker origin at this)."
  value       = google_cloud_run_v2_service.frontend.uri
}

output "frontend_e2e_url" {
  description = "Default run.app URL of the staging-only posm-frontend-e2e service used by the E2E smoke gate; null when enable_e2e_frontend is false."
  value       = try(google_cloud_run_v2_service.frontend_e2e[0].uri, null)
}

output "migrate_job_name" {
  description = "Cloud Run job that runs `prisma migrate deploy` (CI: gcloud run jobs update/execute --wait)."
  value       = google_cloud_run_v2_job.migrate.name
}

############################################
# Images (what CI must push/deploy)
############################################

output "artifact_registry_repo" {
  description = "Docker repo path prefix. api image = <this>/posm-api:<GIT_SHA>; frontend image = <this>/posm-frontend:<GIT_SHA>."
  value       = local.image_registry_prefix
}

output "api_image_repository" {
  description = "Full api image name without tag."
  value       = "${local.image_registry_prefix}/posm-api"
}

output "frontend_image_repository" {
  description = "Full frontend image name without tag."
  value       = "${local.image_registry_prefix}/posm-frontend"
}

############################################
# Service accounts / WIF (GitHub Actions config)
############################################

output "deployer_service_account_email" {
  description = "CI deployer SA email -> GitHub Actions `service_account` for google-github-actions/auth."
  value       = local.deployer_email
}

output "api_service_account_email" {
  description = "api runtime SA (also runs the migrate job)."
  value       = google_service_account.api.email
}

output "frontend_service_account_email" {
  description = "frontend runtime SA."
  value       = google_service_account.frontend.email
}

output "workload_identity_provider" {
  description = "Full provider resource name -> GitHub Actions `workload_identity_provider` for google-github-actions/auth. null unless this state manages the shared resources."
  value       = var.manage_shared_resources ? google_iam_workload_identity_pool_provider.github[0].name : null
}

############################################
# Data plane
############################################

output "sql_instance" {
  description = "Cloud SQL instance name used by this environment."
  value       = var.sql_instance
}

output "sql_connection_name" {
  description = "Cloud SQL connection name (<project>:<region>:<instance>)."
  value       = local.sql_connection_name
}

output "database_name" {
  description = "Database for this environment (posm_staging | posm_prod)."
  value       = google_sql_database.posm.name
}

output "bucket_name" {
  description = "Media bucket (api GCS_BUCKET)."
  value       = google_storage_bucket.files.name
}

output "secret_ids" {
  description = "Secret Manager secret ids for this environment. The msg91-* ones need real values added out-of-band (placeholders for now)."
  value       = { for k, s in google_secret_manager_secret.posm : k => s.secret_id }
}

output "owner_supplied_secrets" {
  description = "Secrets that still hold a PLACEHOLDER and must receive a real new version from the owner before the app is usable."
  value       = [for k in sort(tolist(local.secret_placeholder_names)) : "posm-${local.env}-${k}"]
}
