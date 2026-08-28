import * as crypto from 'crypto';

/**
 * Generate a 6-digit numeric OTP (100000–999999) using a CSPRNG.
 *
 * `crypto.randomInt(min, max)` is uniformly distributed over [min, max) and
 * cryptographically unpredictable. `Math.random()` is a NON-cryptographic PRNG
 * whose internal state can be recovered from a handful of observed outputs —
 * unacceptable for an authentication OTP. The fixed-OTP dev/staging bypass is
 * gated separately (isFixedOtpAllowed) and is untouched.
 */
export function generateNumericOtp(): string {
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * SHA-256 hex of an OTP code — the ONLY form persisted (OtpCode.codeHash), so a DB read
 * cannot recover a live OTP. A 6-digit OTP is low-entropy, but it is single-purpose,
 * short-lived (10 min), attempt-capped (3) and send-capped, so a plain SHA-256 (no per-row
 * salt) is an acceptable at-rest control here — it defeats casual DB inspection without a
 * KDF's cost on the hot login path. Verify hashes the submitted code and compares to this.
 */
export function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}
