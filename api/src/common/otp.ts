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
