-- roles.sql — confine the POSM runtime DB role to its OWN database on the SHARED Cloud SQL instance.
--
-- WHY: Cloud SQL makes every API-created user a `cloudsqlsuperuser` member, and API-created
-- databases are OWNED by `cloudsqlsuperuser`. A role that is a cloudsqlsuperuser member can therefore
-- connect to EVERY database on the instance — including OpsHub's financial databases — no matter what
-- you REVOKE. So the app's runtime role must NOT be a cloudsqlsuperuser member. The only way to make
-- such a role is plain SQL (this file), run as the elevated migrate user — not a google_sql_user.
--
-- WHEN: run ONCE per environment, as the ELEVATED migrate user, BEFORE the first
-- `prisma migrate deploy` (so the ALTER DEFAULT PRIVILEGES below apply to the tables migrations then
-- create). Idempotent and safe to re-run (e.g. after a password rotation or to re-assert grants).
--
-- HOW (see DEPLOY-RUNBOOK §Cloud SQL):
--   APP_PW="$(gcloud secrets versions access latest --secret=posm-<env>-db-password --project <PROJ>)"
--   psql "$(gcloud secrets versions access latest --secret=posm-<env>-migrate-database-url --project <PROJ>)" \
--     -v ON_ERROR_STOP=1 \
--     -v app_user="posm_app_<env>" \
--     -v app_pw="$APP_PW" \
--     -v db="posm_<env>" \
--     -f roles.sql
--
-- psql var conventions used below: :'x' = quoted string literal, :"x" = quoted identifier.

\set ON_ERROR_STOP on

-- 1) Create (or re-sync the password of) the CONFINED runtime LOGIN role.
--    Deliberately plain: no SUPERUSER, no CREATEDB, no CREATEROLE, and NOT granted cloudsqlsuperuser.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') THEN
    EXECUTE format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'app_user', :'app_pw');
  ELSE
    EXECUTE format('CREATE ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'app_user', :'app_pw');
  END IF;
END
$$;

-- 2) Database scope: strip PUBLIC's CONNECT so ordinary roles can't connect to posm_<env>; grant it
--    back to the runtime role. NOTE: this stops non-privileged roles only — cloudsqlsuperuser-member
--    users (every Cloud SQL API-created user, incl. OpsHub's) inherit owner rights on this
--    API-owned DB and can still connect regardless. That cross-reach is a shared-instance property,
--    contained operationally, not by this REVOKE (see terraform/README.md "Two-user confinement").
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO :"app_user";

-- 3) Schema + object privileges: CRUD only — NO DDL (migrations run as the elevated migrate user).
GRANT USAGE ON SCHEMA public TO :"app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_user";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO :"app_user";

-- 4) Future objects the migrate user creates auto-grant the same CRUD to the runtime role, so no
--    re-run is needed after each migration. (CURRENT_USER here is the elevated migrate user.)
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"app_user";

-- The runtime role can now read/write posm_<env> and NOTHING else on the instance.
