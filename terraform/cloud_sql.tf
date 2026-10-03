# Cloud SQL — SHARED/PRE-EXISTING instance OR DEDICATED instance (var.create_sql_instance).
# Per environment this config creates: database `posm_<env>` and the ELEVATED MIGRATION user
# (local.db_migrate_user, e.g. posm_migrate_prod). The CONFINED RUNTIME role the app connects as
# (local.db_app_user, e.g. posm_app_prod) is created by terraform/sql/roles.sql — NOT here — see the
# google_sql_user note below. Both passwords are generated here and stored in Secret Manager
# (see secrets.tf). See README "Shared vs dedicated" + "Two-user confinement".

# App RUNTIME role password (the role itself is made by roles.sql, so TF only owns the password).
resource "random_password" "runtime" {
  length  = 32
  special = false # alphanumeric -> safe to embed un-encoded in DATABASE_URL
}

# ELEVATED migration user password.
resource "random_password" "migrate" {
  length  = 32
  special = false
}

# --- Option A: dedicated instance (create_sql_instance = true) ---
resource "google_sql_database_instance" "dedicated" {
  count = var.create_sql_instance ? 1 : 0

  project          = var.project_id
  name             = var.sql_instance
  region           = var.region
  database_version = var.sql_database_version

  deletion_protection = var.sql_deletion_protection

  settings {
    tier              = var.sql_tier
    availability_type = var.sql_availability_type
    disk_size         = var.sql_disk_size_gb
    disk_autoresize   = true
    disk_type         = "PD_SSD"

    deletion_protection_enabled = var.sql_deletion_protection

    backup_configuration {
      enabled                        = true
      start_time                     = "21:00" # UTC = 02:30 IST
      point_in_time_recovery_enabled = var.sql_point_in_time_recovery
      transaction_log_retention_days = var.sql_point_in_time_recovery ? 7 : null
      backup_retention_settings {
        retained_backups = 14
      }
    }

    ip_configuration {
      # Public IP is enabled ONLY so the Cloud SQL connector can reach it; NO authorized
      # networks are added, so nothing outside the connector/IAM path can connect.
      ipv4_enabled    = var.sql_private_network == null
      private_network = var.sql_private_network
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    maintenance_window {
      day          = 7 # Sunday
      hour         = 21
      update_track = "stable"
    }

    insights_config {
      query_insights_enabled = true
    }
  }

  depends_on = [google_project_service.apis]
}

# --- Option B: pre-existing instance (create_sql_instance = false) ---
# May live in another project (local.sql_project / var.sql_instance_project) — e.g. the shared
# opshub-db in opshub-506704 that POSM prod co-locates on.
data "google_sql_database_instance" "existing" {
  count = var.create_sql_instance ? 0 : 1

  project = local.sql_project
  name    = var.sql_instance
}

# --- Per-environment database + user (both options) ---
# Created in local.sql_project so they land on the instance's OWNING project (cross-project when the
# shared instance is in opshub-506704).
resource "google_sql_database" "posm" {
  project  = local.sql_project
  instance = var.sql_instance
  name     = local.db_name

  # One DB per product/env: never auto-drop client data if this resource is ever removed.
  deletion_policy = "ABANDON"

  depends_on = [google_sql_database_instance.dedicated]
}

# ELEVATED migration user. A Cloud SQL API-created user is a `cloudsqlsuperuser` member — which is
# exactly what lets `prisma migrate deploy` own and create tables in the (PG15+) locked-down public
# schema. It is used ONLY by the migrate job (its own SA + its own `migrate-database-url` secret).
#
# ⚠️ The app's RUNTIME role is deliberately NOT a google_sql_user: every API-created user is a
# cloudsqlsuperuser member, and API-created databases are OWNED by cloudsqlsuperuser, so such a role
# could connect to EVERY database on the shared instance (incl. opshub's financial DBs) regardless of
# any REVOKE. The confined runtime role (local.db_app_user) is instead created by
# terraform/sql/roles.sql as a plain LOGIN role (no cloudsqlsuperuser), granted CRUD on posm_<env>
# only. TF owns its PASSWORD (random_password.runtime → the database-url + db-password secrets); the
# ROLE is provisioned by running roles.sql once as this migrate user (see DEPLOY-RUNBOOK §Cloud SQL).
resource "google_sql_user" "migrate" {
  project  = local.sql_project
  instance = var.sql_instance
  name     = local.db_migrate_user
  password = random_password.migrate.result

  deletion_policy = "ABANDON"

  depends_on = [google_sql_database.posm]
}
