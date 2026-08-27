/**
 * Auth enforcement constants — the SINGLE SOURCE OF TRUTH for the platform-global
 * security parameters auth.service.ts enforces at runtime. Deployment-global (NOT
 * per-tenant), changed by editing this file / the deployment, never at runtime.
 */

/**
 * SHORT access-token lifetime — the JWT access-token `expiresIn`. Deliberately short
 * (60 minutes) so ordinary activity triggers a refresh roughly hourly; each refresh
 * slides the 7-day session row (SESSION_TTL_DAYS) and re-mints the access token, which
 * is what makes the rolling session non-inert. Env JWT_EXPIRES_IN may override.
 */
export const ACCESS_TTL = '60m';

/** Numeric minutes form of ACCESS_TTL. */
export const ACCESS_TTL_MINUTES = 60;

/** Minutes an issued login OTP remains valid before it expires. */
export const OTP_EXPIRY_MINUTES = 10;

/** Wrong-code attempts allowed against a single OTP before it is locked. */
export const OTP_MAX_ATTEMPTS = 3;

/** Rolling window (hours) over which per-phone OTP sends are counted for the anti-abuse cap. */
export const OTP_RESEND_WINDOW_HOURS = 1;

/** Max OTP sends permitted to a single phone within OTP_RESEND_WINDOW_HOURS. */
export const OTP_MAX_RESENDS_PER_WINDOW = 5;

/**
 * Sliding-session idle window (days). A session/refresh token stays valid for this many
 * days of INACTIVITY: every valid access (jwt.strategy guard) and every refresh
 * (auth.service.generateTokens) re-mints `UserSession.expiresAt = now + SESSION_TTL_DAYS`,
 * so an actively-used session never expires while an idle one lapses after 7 days.
 */
export const SESSION_TTL_DAYS = 7;

/** Lifetime (days) of a refresh token / session — points at the sliding-session window. */
export const REFRESH_TTL_DAYS = SESSION_TTL_DAYS;
