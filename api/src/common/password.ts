import * as bcrypt from 'bcryptjs';

/**
 * Password hashing for email+password login (replaced phone+OTP, 2026-10-01).
 * bcryptjs is pure-JS (no native build) so it works unchanged in the slim Docker image.
 */
const BCRYPT_COST = 10;

/** Minimum password length accepted when an admin sets one. */
export const MIN_PASSWORD_LENGTH = 8;

/** Hash a plaintext password for storage (never store plaintext). */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/** Constant-time compare of a plaintext against a stored bcrypt hash. */
export function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Canonical email form for storage + lookup (so case/whitespace can't fork one identity). */
export function normalizeEmail(raw: string): string {
  return (raw ?? '').trim().toLowerCase();
}

// ── Brute-force lockout policy ────────────────────────────────────────────────
/** Consecutive failed logins before the account is temporarily locked. */
export const MAX_LOGIN_ATTEMPTS = 5;
/** How long the account stays locked after hitting the cap. */
export const LOGIN_LOCKOUT_MINUTES = 15;
