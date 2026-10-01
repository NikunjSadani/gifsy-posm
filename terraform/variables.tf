# All inputs. Variables WITHOUT a default are mandatory — there are intentionally no real ids
# baked in. Per-environment values live in environments/<env>.tfvars (copy from the .example).

############################################
# Identity / placement
############################################

variable "project_id" {
  description = "GCP project id that hosts this environment (e.g. a dedicated kwality-posm project, or the shared Gifsy project — see DEPLOYMENT-PLAN section 5)."
  type        = string
}

variable "region" {
  description = "GCP region for Cloud Run, Artifact Registry, Cloud SQL (if created) and the GCS buckets."
  type        = string
  default     = "asia-south1"
}

variable "environment" {
  description = "Which environment THIS apply manages: `staging` or `prod`. One Terraform state per environment."
  type        = string

  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment must be \"staging\" or \"prod\"."
  }
}

variable "domain" {
  description = "Public hostname the frontend is served on through the edge (e.g. uat-posm.example.com / posm.example.com). Used ONLY to build the api's CORS_ORIGINS (https://<domain>); DNS/Worker routing is outside this config."
  type        = string
}

variable "manage_shared_resources" {
  description = "Create the resources shared by BOTH environments (APIs, Artifact Registry repo `posm`, deployer SA `posm-deployer`, WIF pool/provider). Set true in exactly ONE state — the one applied first (normally staging) — and false in the other, otherwise the two applies collide on the same resource names."
  type        = bool
  default     = false
}

variable "enable_apis" {
  description = "Enable the required Google APIs via google_project_service. Only evaluated when manage_shared_resources = true. Set false if the project's APIs are managed elsewhere."
  type        = bool
  default     = true
}

variable "github_repo" {
  description = "GitHub repository allowed to impersonate the deployer SA through Workload Identity Federation, as `owner/name`. Required when manage_shared_resources = true; ignored otherwise."
  type        = string
  default     = ""

  validation {
    condition     = var.github_repo == "" || can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repo))
    error_message = "github_repo must look like owner/name."
  }
}

############################################
# Cloud SQL — shared/pre-existing OR dedicated (see README "Shared vs dedicated")
############################################

variable "sql_instance" {
  description = "Cloud SQL instance NAME (not the connection name). If create_sql_instance = false it must already exist in project_id/region (e.g. the shared `gifsy-shared`); if true it is the name of the dedicated instance Terraform creates."
  type        = string
}

variable "create_sql_instance" {
  description = "true = create a DEDICATED Postgres instance named sql_instance (e.g. a `posm-prod` instance for the paying client). false = use the PRE-EXISTING instance sql_instance (e.g. the shared `gifsy-shared`); only the database + user are created on it."
  type        = bool
  default     = false
}

variable "sql_database_version" {
  description = "Postgres version for a dedicated instance (create_sql_instance = true). Ignored otherwise."
  type        = string
  default     = "POSTGRES_16"
}

variable "sql_tier" {
  description = "Machine tier for a dedicated instance. db-f1-micro/g1-small are shared-core and NOT suitable for prod."
  type        = string
  default     = "db-custom-1-3840"
}

variable "sql_disk_size_gb" {
  description = "Initial disk size (GB) for a dedicated instance. Disk autoresize is on."
  type        = number
  default     = 10
}

variable "sql_availability_type" {
  description = "ZONAL or REGIONAL (HA) for a dedicated instance. REGIONAL doubles the instance cost; decide per DEPLOYMENT-PLAN section 5.4."
  type        = string
  default     = "ZONAL"

  validation {
    condition     = contains(["ZONAL", "REGIONAL"], var.sql_availability_type)
    error_message = "sql_availability_type must be ZONAL or REGIONAL."
  }
}

variable "sql_point_in_time_recovery" {
  description = "Enable automated backups + PITR (WAL archiving) on a dedicated instance."
  type        = bool
  default     = true
}

variable "sql_deletion_protection" {
  description = "Protect a dedicated instance from `terraform destroy` / accidental replacement (also sets the GCP-side deletion protection)."
  type        = bool
  default     = true
}

variable "sql_private_network" {
  description = "Optional VPC network self_link/id for a PRIVATE-IP dedicated instance (requires Private Services Access already configured). null = public IP, reachable only through the Cloud SQL connector (Cloud Run /cloudsql socket); no authorized networks are ever added."
  type        = string
  default     = null
}

variable "db_user" {
  description = "Application DB user. Contract name is `posm_app`. If the staging and prod databases live on the SAME instance and both states create the user, give the second env a different name (e.g. posm_app_prod) — a DB user is instance-wide and each state generates its own password."
  type        = string
  default     = "posm_app"
}

############################################
# Cloud Run
############################################

variable "api_image" {
  description = "Initial api container image (full ref, e.g. asia-south1-docker.pkg.dev/<project>/posm/posm-api:<GIT_SHA>). The default is Google's public hello image so the very FIRST apply works before any image is pushed (set enable_health_probes=false for that bootstrap apply). After CI starts deploying, Terraform IGNORES image drift (lifecycle.ignore_changes), so CI owns the running image."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "frontend_image" {
  description = "Initial frontend container image (full ref, e.g. .../posm/posm-frontend:<GIT_SHA>). Same bootstrap/ignore_changes semantics as api_image."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "enable_health_probes" {
  description = "Attach the api startup probe (GET /health/ready — checks the DB) and liveness probe (GET /health). Set false ONLY for the bootstrap apply that still uses the placeholder hello image (it has no /health route and would fail the revision)."
  type        = bool
  default     = true
}

variable "api_min_instances" {
  description = "Minimum api instances. 0 = scale to zero (cold starts). Contract default 0; prod may choose 1 (DEPLOYMENT-PLAN section 5.4)."
  type        = number
  default     = 0
}

variable "api_max_instances" {
  description = "Maximum api instances. Keep (max_instances x pg pool size) below the Postgres max_connections of the instance."
  type        = number
  default     = 5
}

variable "frontend_min_instances" {
  description = "Minimum frontend instances (contract default 0)."
  type        = number
  default     = 0
}

variable "frontend_max_instances" {
  description = "Maximum frontend instances."
  type        = number
  default     = 5
}

variable "api_cpu" {
  description = "api container CPU limit."
  type        = string
  default     = "1"
}

variable "api_memory" {
  description = "api container memory limit."
  type        = string
  default     = "512Mi"
}

variable "frontend_cpu" {
  description = "frontend container CPU limit."
  type        = string
  default     = "1"
}

variable "frontend_memory" {
  description = "frontend container memory limit."
  type        = string
  default     = "512Mi"
}

variable "allow_public_invoker" {
  description = "Grant allUsers roles/run.invoker on both services. The app does its own JWT auth and the browser/edge must reach it, so true is the normal setting. Set false if an org policy (domain-restricted sharing) forbids allUsers — then you must front the services some other way and add your own invoker bindings."
  type        = bool
  default     = true
}

variable "vpc_network" {
  description = "Optional VPC network for Cloud Run Direct VPC egress (needed only if the Cloud SQL instance is private-IP-only). null = no VPC egress."
  type        = string
  default     = null
}

variable "vpc_subnetwork" {
  description = "Optional subnetwork for Direct VPC egress. Required when vpc_network is set."
  type        = string
  default     = null
}

variable "msg91_smtp_host" {
  description = "MSG91 SMTP host -> api env MSG91_SMTP_HOST (non-secret). Take the exact value from the MSG91 dashboard (Domain Settings -> SMTP Integration)."
  type        = string
}

variable "msg91_smtp_port" {
  description = "MSG91 SMTP port -> api env MSG91_SMTP_PORT."
  type        = string
  default     = "587"
}

variable "reports_from_email" {
  description = "From address for emailed reports -> api env REPORTS_FROM_EMAIL (must be a sender verified in MSG91)."
  type        = string
}

variable "log_level" {
  description = "api env LOG_LEVEL."
  type        = string
  default     = "info"
}

variable "api_extra_env" {
  description = "Extra plain (non-secret) env vars for the api service. Must not collide with contract variables. NEVER put secrets here — they would appear in the Cloud Run config."
  type        = map(string)
  default     = {}
}

############################################
# Storage / registry
############################################

variable "bucket_force_destroy" {
  description = "Allow `terraform destroy` to delete a NON-EMPTY media bucket. Keep false for prod (client photos)."
  type        = bool
  default     = false
}

variable "bucket_noncurrent_retention_days" {
  description = "Delete NONCURRENT object versions after this many days (bucket versioning is enabled in prod only)."
  type        = number
  default     = 30
}

variable "ar_cleanup_dry_run" {
  description = "Artifact Registry cleanup policies only LOG (dry run) when true. Leave true until you have confirmed the keep rules never drop an image a live revision/rollback still needs."
  type        = bool
  default     = true
}

variable "ar_keep_recent_versions" {
  description = "Cleanup policy: always KEEP the N most recent versions of each image."
  type        = number
  default     = 30
}
