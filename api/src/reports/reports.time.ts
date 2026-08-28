/**
 * reports.time.ts — pure IST (Asia/Kolkata, UTC+05:30) date helpers for the digest cron. The
 * server TZ is Asia/Calcutta in prod, but these compute the IST wall-clock explicitly from a
 * UTC instant so the logic is correct AND unit-testable regardless of the host TZ. No imports.
 */

/** IST is a fixed UTC+05:30 offset (India observes no DST). */
const IST_OFFSET_MINUTES = 5 * 60 + 30;

/** The IST calendar parts (year, month 0-11, day, hour 0-23) for a given UTC instant. */
function istParts(now: Date): { year: number; month: number; day: number; hour: number } {
  const shifted = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
  };
}

/** The current hour (0–23) on the IST wall clock — the value compared to `sendHourLocal`. */
export function istHour(now: Date): number {
  return istParts(now).hour;
}

/**
 * The calendar day (in IST) that the digest covers, as a UTC-midnight Date suitable for the
 * `@db.Date` idempotency key. Using UTC midnight of the IST date keeps the stored date stable
 * (no TZ drift) — two fires in the same IST day map to the SAME forDate, so the unique ledger
 * dedupes them.
 */
export function istDateOnlyUtc(now: Date): Date {
  const { year, month, day } = istParts(now);
  return new Date(Date.UTC(year, month, day));
}

/** The IST calendar day as a human `YYYY-MM-DD` string (for the subject line + preview). */
export function istDateLabel(now: Date): string {
  const { year, month, day } = istParts(now);
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}
