/**
 * reports.config.ts — pure reader / merger for the per-tenant email-digest config that lives
 * on `Client.settings.emailReports` (settings-backed, mirroring the POSM capture-config pattern
 * in capture-integrity/posm-config.helper.ts). NO NestJS / Prisma imports — it parses a raw
 * JSON blob and produces a plain object, so it is trivially unit-testable and reused by both the
 * controller (GET/PUT config) and the cron sweep.
 */

/** The per-tenant email-digest configuration (stored at Client.settings.emailReports). */
export interface EmailReportsConfig {
  enabled: boolean;
  recipients: string[];
  /** Local send hour, 0–23, interpreted in IST (Asia/Kolkata). */
  sendHourLocal: number;
  /** A SUBMITTED recce older than this many hours is "stale" (>= 1). */
  staleRecceHours: number;
  /** A SUBMITTED installation older than this many hours is "stale" (>= 1). */
  staleInstallHours: number;
}

/** The SAFE defaults applied when a tenant has no emailReports config (or a malformed one). */
export const DEFAULT_EMAIL_REPORTS_CONFIG: EmailReportsConfig = {
  enabled: false,
  recipients: [],
  sendHourLocal: 8,
  staleRecceHours: 24,
  staleInstallHours: 48,
};

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function boundedHour(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  return i >= 0 && i <= 23 ? i : fallback;
}

function positiveHours(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  return i >= 1 ? i : fallback;
}

function cleanRecipients(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    if (typeof r !== 'string') continue;
    const email = r.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/**
 * The effective email-digest config for a tenant, read from `Client.settings.emailReports`.
 * Missing / malformed → {@link DEFAULT_EMAIL_REPORTS_CONFIG}. Each field is independently
 * defaulted, so a partially-written blob (e.g. only `enabled`) still resolves to a complete,
 * valid config. Recipients are trimmed + de-duplicated (case-insensitive).
 */
export function readEmailReportsConfig(settings: unknown): EmailReportsConfig {
  const root = isObject(settings) ? settings : {};
  const node = isObject(root.emailReports) ? root.emailReports : {};
  return {
    enabled: Boolean(node.enabled ?? DEFAULT_EMAIL_REPORTS_CONFIG.enabled),
    recipients: cleanRecipients(node.recipients),
    sendHourLocal: boundedHour(node.sendHourLocal, DEFAULT_EMAIL_REPORTS_CONFIG.sendHourLocal),
    staleRecceHours: positiveHours(node.staleRecceHours, DEFAULT_EMAIL_REPORTS_CONFIG.staleRecceHours),
    staleInstallHours: positiveHours(
      node.staleInstallHours,
      DEFAULT_EMAIL_REPORTS_CONFIG.staleInstallHours,
    ),
  };
}

/**
 * Merge a new email-digest config into an existing `Client.settings` blob WITHOUT clobbering
 * any sibling key (posmCapture, geoFence, branding-adjacent settings, …). Returns a fresh
 * settings object safe to hand straight to `prisma.client.update({ data: { settings } })`.
 */
export function mergeEmailReportsConfig(
  settings: unknown,
  config: EmailReportsConfig,
): Record<string, unknown> {
  const root = isObject(settings) ? { ...settings } : {};
  root.emailReports = { ...config };
  return root;
}
