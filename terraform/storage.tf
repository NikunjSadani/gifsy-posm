# Media bucket: posm-staging-files / posm-prod-files (api STORAGE_DRIVER=gcs, GCS_BUCKET).
# Private by default: the api serves objects through V4 signed URLs / auth-gated endpoints.
#
# NOTE: bucket names are GLOBALLY unique across GCP. The contract fixes these names; if the
# create fails with "name already taken", the contract + env templates + this local must change
# together (do not just edit one).

resource "google_storage_bucket" "files" {
  project  = var.project_id
  name     = local.bucket_name
  location = var.region

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  storage_class               = "STANDARD"
  force_destroy               = var.bucket_force_destroy

  # Prod: keep noncurrent versions so an accidental overwrite/delete of a client photo is
  # recoverable; staging does not need that.
  versioning {
    enabled = local.is_prod
  }

  # Lifecycle: ONLY noncurrent versions expire. Live media objects are never auto-deleted —
  # retention of the photos themselves is a client/legal decision (add an age-based rule here
  # when one is made).
  dynamic "lifecycle_rule" {
    for_each = local.is_prod ? [1] : []
    content {
      condition {
        days_since_noncurrent_time = var.bucket_noncurrent_retention_days
        with_state                 = "ARCHIVED"
      }
      action {
        type = "Delete"
      }
    }
  }

  # Abort stale resumable uploads.
  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "AbortIncompleteMultipartUpload"
    }
  }

  depends_on = [google_project_service.apis]
}
