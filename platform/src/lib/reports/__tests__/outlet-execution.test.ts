import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  istDateStamp,
  reportMediaSrc,
  gpsMapsUrl,
  downloadOutletReportPptx,
  PPTX_MAX_OUTLETS,
} from '../outlet-execution';

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

// ─── downloadOutletReportPptx (1–3 outlet PowerPoint export) ──────────────────────────────────
describe('downloadOutletReportPptx', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('refuses 0 outlets and more than 3 WITHOUT fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(PPTX_MAX_OUTLETS).toBe(3);

    expect(await downloadOutletReportPptx([])).toMatch(/at least one outlet/i);
    expect(await downloadOutletReportPptx(['A1', 'A2', 'A3', 'A4'])).toBe('PPT export is limited to 3 outlets.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches the .pptx for the de-duped selected codes and saves the blob', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob(['x']) });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() } as never);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const err = await downloadOutletReportPptx(['A8', 'A8', 'B2']); // duplicate collapses
    expect(err).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/api/reports/outlet-execution.pptx?');
    // Codes are de-duped and passed as a single comma-joined param.
    expect(decodeURIComponent(url)).toContain('outletCodes=A8,B2');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' });
    expect(clickSpy).toHaveBeenCalledTimes(1);
    // Flush the deferred setTimeout(revokeObjectURL, 0) WHILE the URL stub is still live, so it does
    // not fire against the restored (jsdom) URL after afterEach.
    await new Promise((r) => setTimeout(r, 0));
  });

  it('maps a backend 400 to the owner message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    expect(await downloadOutletReportPptx(['A8'])).toBe('Select 1–3 outlets for a PPT export.');
  });

  it('maps a 403 to a not-allowed message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    expect(await downloadOutletReportPptx(['A8'])).toMatch(/not allowed/i);
  });
});
