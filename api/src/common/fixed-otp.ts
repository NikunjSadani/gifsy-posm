/**
 * Central gate for the FIXED_OTP dev/UAT bypass.
 *
 * FIXED_OTP lets every OTP be a known constant (skips MSG91) for fast local dev, the E2E
 * harness, and staging UAT. It is a universal-login backdoor, so honoring it is tightly gated:
 *
 *   - Allowed when NODE_ENV !== 'production' (local / dev / test), OR when the operator
 *     explicitly opts in with ALLOW_FIXED_OTP=true (the staging UAT environment, which runs
 *     NODE_ENV=production but is not the real production data plane).
 *   - HARD-REFUSED whenever DATABASE_URL points at the production database, regardless of
 *     any flag — so a leaked or mis-set ALLOW_FIXED_OTP can never turn FIXED_OTP into a
 *     backdoor on prod. Production never sets ALLOW_FIXED_OTP (primary guard); the DB-name
 *     check is defense-in-depth for the misconfiguration case.
 *
 * This only decides WHETHER FIXED_OTP may be honored; each call site still reads the actual
 * FIXED_OTP value (and treats an empty value as "off").
 */
export function isFixedOtpAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const dbUrl = env.DATABASE_URL ?? '';
  // Layer 1 — never on the production database, whatever the flags say.
  if (/\/posm_prod\b/.test(dbUrl)) return false;
  // Layer 2 — local / dev / test (non-production NODE_ENV): allowed regardless of DB name.
  if (env.NODE_ENV !== 'production') return true;
  // Layer 3 — production NODE_ENV (staging UAT): only the explicit opt-in AND only when the
  // DB is positively the staging database. Requiring posm_staging (not merely "not
  // posm_prod") means a future prod-like DB with a different name can't slip through, and a
  // fat-fingered ALLOW_FIXED_OTP on prod is refused by both layer 1 and this positive check.
  return env.ALLOW_FIXED_OTP === 'true' && /\/posm_staging\b/.test(dbUrl);
}
