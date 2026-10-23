import { describe, it, expect } from 'vitest';
import { istDateStamp, reportMediaSrc, gpsMapsUrl } from '../outlet-execution';

// ─── istDateStamp (IST, not UTC — matches the dates shown in the report) ──────────────────────
describe('istDateStamp', () => {
  it('formats YYYY-MM-DD in Asia/Kolkata', () => {
    // 2026-08-28T02:30:00Z == 08:00 IST 28th.
    expect(istDateStamp(new Date('2026-08-28T02:30:00Z'))).toBe('2026-08-28');
  });

  it('uses the IST calendar day, not UTC, for a late-evening-IST instant (the bug fixed)', () => {
    // 2026-08-28T20:00:00Z == 01:30 IST on the 29th. toISOString() would stamp the 28th (UTC);
    // istDateStamp must stamp the 29th (IST).
    const d = new Date('2026-08-28T20:00:00Z');
    expect(d.toISOString().slice(0, 10)).toBe('2026-08-28'); // the old UTC behaviour
    expect(istDateStamp(d)).toBe('2026-08-29'); // the IST stamp now used for the filename
  });
});

// ─── reportMediaSrc (browser <img src> on the /api proxy surface) ─────────────────────────────
describe('reportMediaSrc', () => {
  it('remaps /v1 → /api, keeps /api, prefixes bare + rooted paths, and blanks empty', () => {
    expect(reportMediaSrc('/v1/media/view?key=k')).toBe('/api/media/view?key=k');
    expect(reportMediaSrc('/api/media/view?key=k')).toBe('/api/media/view?key=k');
    expect(reportMediaSrc('/media/view?key=k')).toBe('/api/media/view?key=k');
    expect(reportMediaSrc('media/view?key=k')).toBe('/api/media/view?key=k');
    expect(reportMediaSrc('')).toBe('');
  });
});

describe('gpsMapsUrl', () => {
  it('builds a Google Maps query link', () => {
    expect(gpsMapsUrl(19.1, 72.8)).toBe('https://www.google.com/maps?q=19.1,72.8');
  });
});
