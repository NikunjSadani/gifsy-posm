# Secret Manager: posm-<env>-{database-url,migrate-database-url,db-password,jwt-secret,msg91-auth-key,
# msg91-otp-template-id,msg91-smtp-pass,msg91-smtp-user}.
#
# Terraform-GENERATED values: database-url (confined runtime role), migrate-database-url (elevated
# migrate user), db-password (runtime role pw), jwt-secret.
# OWNER-SUPPLIED values (never in git or tfvars): the four msg91-* secrets. They are created
# with a placeholder version so Cloud Run can reference `latest`; the owner then adds the real
# value as a NEW version out-of-band:
#
#   printf '%s' "<value>" | gcloud secrets versions add posm-<env>-msg91-auth-key --data-file=- --project <PROJECT_ID>
#
# (Use printf, not echo, and strip any trailing CR/newline — a stray \r from Windows shells
# silently breaks auth.) Terraform never overwrites a later version: secret_data is ignored.
#
# SECURITY NOTE: the generated values also exist in the Terraform STATE — lock down the state
# bucket (see backend.tf.example).

resource "google_secret_manager_secret" "posm" {
  for_each = local.secret_names

  project   = var.project_id
  secret_id = "posm-${local.env}-${each.value}"

  replication {
    auto {}
  }

  labels = {
    app = "gifsy-posm"
    env = local.env
  }

  depends_on = [google_project_service.apis]
}

resource "random_password" "jwt" {
  length  = 64
  special = false
}

# Generated values (DATABASE_URL, db password, JWT secret).
resource "google_secret_manager_secret_version" "managed" {
  for_each = local.secret_managed_names

  secret      = google_secret_manager_secret.posm[each.key].id
  secret_data = local.secret_managed_values[each.key]
}

# Placeholders for the owner-supplied secrets.
resource "google_secret_manager_secret_version" "placeholder" {
  for_each = local.secret_placeholder_names

  secret      = google_secret_manager_secret.posm[each.key].id
  secret_data = local.secret_placeholder_value

  lifecycle {
    ignore_changes = [secret_data, enabled]
  }
}
