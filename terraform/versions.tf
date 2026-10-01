# Provider + Terraform version pins. The stable `google` provider is sufficient for everything
# here (Cloud Run v2, Workload Identity Federation, Cloud SQL, Secret Manager, GCS, AR) —
# `google-beta` is deliberately NOT used.
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0" # google_cloud_run_v2_* `deletion_protection` requires 6.x
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state: copy backend.tf.example -> backend.tf (kept out of git) and set the bucket,
  # or pass -backend-config at `terraform init`. See README.md.
}

provider "google" {
  project = var.project_id
  region  = var.region
}
