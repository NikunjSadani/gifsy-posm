/* ─── Admin masters — pure formatting helpers ────────────────────────────────
   No React, no I/O — safe to unit-test in isolation.
─────────────────────────────────────────────────────────────────────────────── */

import type { BulkUploadResult, Site } from './types';

export interface UploadSummary {
  /** Headline sentence, e.g. "48 of 50 rows imported — 2 rejected". */
  headline: string;
  /** Tone for the summary banner. */
  tone: 'success' | 'partial' | 'error';
  rowCount: number;
  successCount: number;
  errorCount: number;
  hasErrorFile: boolean;
}

/**
 * Turn a bulk-upload response into a display summary. Reports EXACTLY what the
 * backend returned — never claims success for rejected rows.
 *  - every row ok           → success
 *  - some ok, some rejected → partial
 *  - nothing imported       → error
 */
export function summarizeUpload(res: BulkUploadResult): UploadSummary {
  const { rowCount, successCount, errorCount } = res;
  const tone: UploadSummary['tone'] =
    errorCount === 0 ? 'success' : successCount === 0 ? 'error' : 'partial';

  const rowsWord = (n: number) => `${n} ${n === 1 ? 'row' : 'rows'}`;
  let headline: string;
  if (tone === 'success') {
    headline = `All ${rowsWord(rowCount)} imported successfully.`;
  } else if (tone === 'error') {
    headline = `No rows imported — all ${rowsWord(rowCount)} were rejected.`;
  } else {
    headline = `${successCount} of ${rowsWord(rowCount)} imported — ${errorCount} rejected.`;
  }

  return {
    headline,
    tone,
    rowCount,
    successCount,
    errorCount,
    hasErrorFile: !!res.errorFileBase64,
  };
}

/** Normalise a site's lat/lng (Decimal→string over JSON) to a display string. */
export function formatCoords(site: Pick<Site, 'lat' | 'lng'>): string {
  if (site.lat == null || site.lng == null) return '—';
  const lat = typeof site.lat === 'number' ? site.lat : Number(site.lat);
  const lng = typeof site.lng === 'number' ? site.lng : Number(site.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '—';
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** Decode a base64 payload to a Blob (for the rejection-report download). */
export function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Trigger a browser download of the base64 .xlsx rejection report. */
export function downloadErrorReport(base64: string, fileName = 'site-upload-errors.xlsx'): void {
  const blob = base64ToBlob(base64, XLSX_MIME);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Human display for a phone stored as +91XXXXXXXXXX or a bare 10-digit string. */
export function displayPhone(phone: string): string {
  const m = /^\+91(\d{10})$/.exec(phone);
  if (m) return `+91 ${m[1]}`;
  return phone;
}
