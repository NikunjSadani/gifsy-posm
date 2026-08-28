/**
 * Central gate for the FIXED_OTP dev/UAT bypass.
 *
 * FIXED_OTP lets every OTP be a known constant (skips MSG91) for fast local dev, the E2E
 * harness, and staging UAT. It is a universal-login backdoor, so honoring it is tightly gated:
 *
 *   - PRIMARY guard is NODE_ENV, not the DB name: a real production runtime
 *     (NODE_ENV === 'production') REFUSES FIXED_OTP by default — name-independent, so prod is
 *     protected even if its DATABASE_URL is named something other than `posm_prod`. The staging
 *     UAT box also runs NODE_ENV=production but is NOT the real data plane, so it re-enables the
 *     bypass only with a deliberate, explicit opt-in (ALLOW_FIXED_OTP=true) AND a positive
 *     staging-DB name match (so a prod DB under an unexpected name + a fat-fingered opt-in is
 *     still refused).
 *   - The DATABASE_URL === prod-DB check is kept as DEFENSE-IN-DEPTH (layer 1): it hard-refuses
 *     the known prod DB whatever NODE_ENV / flags say — no longer the sole line of defense.
 *
 * ⚠️ The real prod/staging DATABASE_URL database names still need confirming — `posm_prod` /
 * `posm_staging` below are the placeholder names. The NODE_ENV primary guard means a wrong
 * guess here does NOT expose prod, but confirm them so the staging positive-match keeps working.
 *
 * This only decides WHETHER FIXED_OTP may be honored; each call site still reads the actual
 * FIXED_OTP value (and treats an empty value as "off").
 */
export function isFixedOtpAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const dbUrl = env.DATABASE_URL ?? '';
  // Layer 1 (defense-in-depth) — never on the known production database, whatever else says.
  if (/\/posm_prod\b/.test(dbUrl)) return false;
  // Layer 2 (PRIMARY, name-independent) — a production runtime refuses the FIXED_OTP backdoor
  // outright. The staging UAT box (NODE_ENV=production, not the real data plane) re-enables it
  // ONLY with the explicit opt-in AND a positive staging-DB name match.
  if (env.NODE_ENV === 'production') {
    return env.ALLOW_FIXED_OTP === 'true' && /\/posm_staging\b/.test(dbUrl);
  }
  // Layer 3 — local / dev / test (non-production NODE_ENV): allowed.
  return true;
}
