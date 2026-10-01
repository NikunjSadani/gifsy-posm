/* ─── Scheduled Email Reports — typed API client + pure helpers ─────────────────
   Admins configure the daily POSM digest email: who receives it, when it goes out
   (an IST hour), and the stale-item thresholds that flag overdue recces/installs.
   They can also preview the rendered digest and dispatch a test send.

   Thin wrappers over the backend `/v1/reports/*` endpoints, reached through the
   same-origin `/api/*` proxy (which maps `/api`→`/v1` and injects the bearer cookie).
   The backend re-validates emails / hour / thresholds and scopes everything to the
   admin's tenant.

   Pure helpers (email validation, textarea recipient parsing/dedup, IST hour
   labels) live here and are unit-tested — no React, no fetch.
─────────────────────────────────────────────────────────────────────────────── */

import { api, type ApiResponse } from '@/lib/api-client';

// ─── Domain types (mirror the reports backend response shapes) ─────────────────

/** GET/PUT /api/reports/config */
export interface ReportConfig {
  enabled: boolean;
  /** Digest recipients (validated emails). */
  recipients: string[];
  /** Local (IST) hour-of-day the digest is sent, 0–23. */
  sendHourLocal: number;
  /** A recce with no decision after this many hours is flagged stale. */
  staleRecceHours: number;
  /** An install with no audit after this many hours is flagged stale. */
  staleInstallHours: number;
  /** Per-ASM pending-recce reminder (threshold-triggered). */
  asmRecceReminders: AsmRecceReminderConfig;
}

/** Per-ASM "recce pending your approval" reminder settings. */
export interface AsmRecceReminderConfig {
  enabled: boolean;
  /** Hours a recce must be pending ASM approval before a reminder is eligible. */
  thresholdHours: number;
  /** Re-remind a given recce at most once per this many hours. */
  reminderIntervalHours: number;
}

/** GET /api/reports/preview — the rendered digest HTML + the underlying counts. */
export interface PreviewResult {
  html: string;
  counts: Record<string, unknown>;
}

/** POST /api/reports/send-now — a dispatch to the configured recipients. */
export interface SendResult {
  sent: boolean;
  recipients: string[];
  html: string;
}

// ─── Pure helpers (unit-tested) ────────────────────────────────────────────────

/**
 * Practical email validation for a config textarea — not RFC-5322-complete, but it
 * rejects the mistakes admins actually make (no `@`, no domain dot, embedded spaces,
 * a trailing comma leaving an empty token). The backend is the real validator; this
 * only gives fast, honest inline feedback before a save.
 */
export function isValidEmail(email: string): boolean {
  const value = email.trim();
  if (!value) return false;
  // Single @, non-empty local part, a dotted domain, no whitespace anywhere.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export interface ParsedRecipients {
  /** Deduped, order-preserving valid emails (as typed, trimmed). */
  valid: string[];
  /** Distinct tokens that failed validation, in first-seen order. */
  invalid: string[];
}

/**
 * Parse a comma / newline / semicolon separated recipients textarea into deduped
 * valid + invalid buckets. Dedup is case-insensitive (email addressing is), keeping
 * the first spelling seen; blank tokens are ignored entirely (a trailing comma is not
 * an error). Pure + deterministic so the page and the tests agree exactly.
 */
export function parseRecipients(raw: string): ParsedRecipients {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seenValid = new Set<string>();
  const seenInvalid = new Set<string>();

  for (const token of raw.split(/[\n,;]+/)) {
    const value = token.trim();
    if (!value) continue;
    if (isValidEmail(value)) {
      const key = value.toLowerCase();
      if (seenValid.has(key)) continue;
      seenValid.add(key);
      valid.push(value);
    } else {
      const key = value.toLowerCase();
      if (seenInvalid.has(key)) continue;
      seenInvalid.add(key);
      invalid.push(value);
    }
  }

  return { valid, invalid };
}

/**
 * Label an IST hour-of-day as a zero-padded 24h clock time, e.g. 8 → "08:00 IST",
 * 0 → "00:00 IST", 23 → "23:00 IST". Out-of-range / non-integer hours clamp-render as
 * "—" so a bad value never prints a misleading time.
 */
export function formatHourLabel(hour: number): string {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return '—';
  return `${String(hour).padStart(2, '0')}:00 IST`;
}

/** The 0–23 hour options, pre-labelled, for the send-hour picker. */
export const HOUR_OPTIONS: { value: number; label: string }[] = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: formatHourLabel(h),
}));

// ─── Network calls ─────────────────────────────────────────────────────────────

/** GET the current tenant's digest config. */
export function fetchConfig(): Promise<ApiResponse<ReportConfig>> {
  return api.get<ReportConfig>('/api/reports/config');
}

/** PUT the digest config (backend re-validates; a 400 surfaces its message). */
export function saveConfig(config: ReportConfig): Promise<ApiResponse<ReportConfig>> {
  return api.put<ReportConfig>('/api/reports/config', config);
}

/** GET the rendered digest HTML + counts for this tenant (no send). */
export function fetchPreview(): Promise<ApiResponse<PreviewResult>> {
  return api.get<PreviewResult>('/api/reports/preview');
}

/** POST a real dispatch to the configured recipients now (empty list → backend 400). */
export function sendTest(): Promise<ApiResponse<SendResult>> {
  return api.post<SendResult>('/api/reports/send-now', {});
}
