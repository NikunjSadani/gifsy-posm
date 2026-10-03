# Cloud Run: posm-api-<env>, posm-frontend-<env> (services) and posm-migrate-<env> (job).
#
# CI owns the running image. Terraform sets the image only on first create (var.api_image /
# var.frontend_image) and then IGNORES image drift, so a later `terraform apply` never rolls
# back what CI deployed. Env vars / secrets / scaling / SA remain Terraform-managed.
# CI MUST therefore deploy with `--image` only (do not pass --set-env-vars / --update-secrets,
# which would drift from this config).
#
# Cloud Run notes:
#  * PORT is injected by Cloud Run (we only declare container_port = 8080). It is a RESERVED
#    env name — never set it in env. The api reads process.env.PORT (main.ts).
#  * Cloud Run has no separate "readiness" probe. The api's DB-checking /health/ready is used
#    as the STARTUP probe (a revision only receives traffic once the DB answers); /health is the
#    LIVENESS probe.
#  * Frontend: Next.js has no /health route, so it relies on Cloud Run's default TCP startup
#    probe on the container port.

############################################
# API
############################################

resource "google_cloud_run_v2_service" "api" {
  project  = var.project_id
  location = var.region
  name     = local.api_service
  ingress  = "INGRESS_TRAFFIC_ALL"

  deletion_protection = local.is_prod

  labels = {
    app = "gifsy-posm"
    env = local.env
  }

  template {
    service_account = google_service_account.api.email

    scaling {
      min_instance_count = var.api_min_instances
      max_instance_count = var.api_max_instances
    }

    # Cloud SQL via the built-in connector: socket at /cloudsql/<connection_name>.
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [local.sql_connection_name]
      }
    }

    dynamic "vpc_access" {
      for_each = var.vpc_network == null ? [] : [1]
      content {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = var.vpc_network
          subnetwork = var.vpc_subnetwork
        }
      }
    }

    containers {
      image = var.api_image

      ports {
        container_port = local.container_port
      }

      resources {
        limits = {
          cpu    = var.api_cpu
          memory = var.api_memory
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      dynamic "env" {
        for_each = local.api_plain_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.api_secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.posm[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "startup_probe" {
        for_each = var.enable_health_probes ? [1] : []
        content {
          http_get {
            path = "/health/ready"
          }
          initial_delay_seconds = 0
          period_seconds        = 5
          timeout_seconds       = 3
          failure_threshold     = 24 # up to ~2 min for cold start + DB connect
        }
      }

      dynamic "liveness_probe" {
        for_each = var.enable_health_probes ? [1] : []
        content {
          http_get {
            path = "/health"
          }
          period_seconds    = 30
          timeout_seconds   = 3
          failure_threshold = 3
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      client,
      client_version,
      template[0].containers[0].image, # CI owns the image
    ]

    precondition {
      condition = !(local.is_prod && (
        contains(keys(var.api_extra_env), "FIXED_OTP") ||
        contains(keys(var.api_extra_env), "ALLOW_FIXED_OTP")
      ))
      error_message = "FIXED_OTP / ALLOW_FIXED_OTP must never be set on prod (real MSG91 only)."
    }

    precondition {
      condition     = var.vpc_network == null || var.vpc_subnetwork != null
      error_message = "vpc_subnetwork is required when vpc_network is set."
    }
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_version.managed,
    google_secret_manager_secret_version.placeholder,
    google_secret_manager_secret_iam_member.readers,
    google_project_iam_member.api_cloudsql_client,
    # The runtime ROLE (local.db_app_user) is created by roles.sql, not TF — depend on the database.
    google_sql_database.posm,
  ]
}

############################################
# FRONTEND
############################################

resource "google_cloud_run_v2_service" "frontend" {
  project  = var.project_id
  location = var.region
  name     = local.frontend_service
  ingress  = "INGRESS_TRAFFIC_ALL"

  deletion_protection = local.is_prod

  labels = {
    app = "gifsy-posm"
    env = local.env
  }

  template {
    service_account = google_service_account.frontend.email

    scaling {
      min_instance_count = var.frontend_min_instances
      max_instance_count = var.frontend_max_instances
    }

    containers {
      image = var.frontend_image

      ports {
        container_port = local.container_port
      }

      resources {
        limits = {
          cpu    = var.frontend_cpu
          memory = var.frontend_memory
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      # NEXT_PUBLIC_API_URL / BUILD_ID / NEXT_PUBLIC_CLIENT_ID are BUILD args baked into the
      # image by CI — they are not runtime env.

      dynamic "env" {
        for_each = local.frontend_secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.posm[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      client,
      client_version,
      template[0].containers[0].image, # CI owns the image
    ]
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_version.managed,
    google_secret_manager_secret_iam_member.readers,
  ]
}

############################################
# Public invoker (the app authenticates with its own JWT)
############################################

resource "google_cloud_run_v2_service_iam_member" "api_public" {
  count = var.allow_public_invoker ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  count = var.allow_public_invoker ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.frontend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

############################################
# MIGRATE JOB — `npx prisma migrate deploy` with the api image
############################################
# Runs as its OWN migrate SA (cloudsql.client + the ELEVATED migrate-database-url secret — NOT the
# api SA, so the internet-facing api service can neither hold nor read the elevated DB user). CI
# executes it and waits (`gcloud run jobs execute posm-migrate-<env> --wait`) BEFORE rolling the
# services; it updates the job's image to the new SHA first (`gcloud run jobs update --image`).
# The api image must therefore contain the Prisma CLI, prisma.config.ts and prisma/migrations.

resource "google_cloud_run_v2_job" "migrate" {
  project  = var.project_id
  location = var.region
  name     = local.migrate_job

  deletion_protection = local.is_prod

  labels = {
    app = "gifsy-posm"
    env = local.env
  }

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account = google_service_account.migrate.email
      max_retries     = 0 # a failed migration must be investigated, not blindly retried
      timeout         = "900s"

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [local.sql_connection_name]
        }
      }

      dynamic "vpc_access" {
        for_each = var.vpc_network == null ? [] : [1]
        content {
          egress = "PRIVATE_RANGES_ONLY"
          network_interfaces {
            network    = var.vpc_network
            subnetwork = var.vpc_subnetwork
          }
        }
      }

      containers {
        image   = var.api_image
        command = ["npx"]
        args    = ["prisma", "migrate", "deploy"]

        resources {
          limits = {
            cpu    = "1"
            memory = "1Gi"
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }

        env {
          name  = "NODE_ENV"
          value = "production"
        }

        dynamic "env" {
          for_each = local.migrate_secret_env
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.posm[env.value].secret_id
                version = "latest"
              }
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      client,
      client_version,
      template[0].template[0].containers[0].image, # CI owns the image
    ]
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_version.managed,
    google_secret_manager_secret_iam_member.readers,
    google_project_iam_member.migrate_cloudsql_client,
    google_sql_user.migrate,
  ]
}
