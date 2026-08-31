/**
 * Central gate for the FIXED_OTP dev/UAT bypass.
 *
 * FIXED_OTP lets every OTP be a known constant (skips MSG91) for fast local dev, the E2E
 * harness, and staging UAT. It is a universal-login backdoor, so honoring it is tightly gated:
 *
 *   - POSITIVE non-prod assertion (fail-CLOSED): the bypass is honored ONLY when the runtime can
 *     PROVE it is non-production — either NODE_ENV is explicitly `development`/`test`, OR (for the
 *     staging UAT box, which runs NODE_ENV=production) a deliberate opt-in `ALLOW_FIXED_OTP=true`
 *     PLUS a positive `posm_staging` DB-name match. Anything the code cannot positively classify
 *     as non-prod — NODE_ENV unset, a typo, an unexpected value, a prod box that simply forgot to
 *     set NODE_ENV — falls through to DENY. So a production misconfiguration can NEVER silently
 *     enable the 123456 universal-login backdoor (or the rate-limit skip that keys off this).
 *   - The DATABASE_URL === prod-DB check is kept as DEFENSE-IN-DEPTH (layer 1): it hard-refuses
 *     the known prod DB whatever else says.
 *
 * ⚠️ The prod/staging DATABASE_URL names (`posm_prod` / `posm_staging`) are still placeholders to
 * confirm — but they are no longer load-bearing for prod safety: the fail-closed positive guard
 * means an unconfirmed/unexpected prod DB name can never expose the backdoor. Confirm
 * `posm_staging` only so the staging positive-match keeps letting staging UAT in.
 *
 * This only decides WHETHER FIXED_OTP may be honored; each call site still reads the actual
 * FIXED_OTP value (and treats an empty value as "off").
 */
export function isFixedOtpAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const dbUrl = env.DATABASE_URL ?? '';
  // Layer 1 (defense-in-depth) — never on the known production database, whatever else says.
  if (/\/posm_prod\b/.test(dbUrl)) return false;
  // Layer 2 — the staging UAT box runs NODE_ENV=production but is NOT the real data plane; it
  // re-enables the bypass ONLY with the explicit opt-in AND a positive staging-DB name match.
  if (env.ALLOW_FIXED_OTP === 'true' && /\/posm_staging\b/.test(dbUrl)) return true;
  // Layer 3 (PRIMARY, POSITIVE + fail-closed) — allowed ONLY when NODE_ENV explicitly proves a
  // local/dev/test runtime. Unset / 'production' / any unrecognized value ⇒ DENY. A prod box that
  // forgot to set NODE_ENV therefore refuses the backdoor instead of falling through to "allowed".
  return env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
}
