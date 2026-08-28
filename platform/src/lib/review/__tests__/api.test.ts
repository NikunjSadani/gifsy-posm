import { describe, it, expect } from 'vitest';
import {
  mediaSrc,
  queueQueryString,
  recceFlags,
  photoCount,
  summarizeQueue,
  REJECT_REASON_CODES,
  REJECT_REASON_LABELS,
  type RecceQueueItem,
  type RecceIntegrity,
} from '@/lib/review/api';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const baseIntegrity: RecceIntegrity = {
  geoFenceOk: true,
  distanceMeters: 10,
  captureAccuracy: 12,
  captureLat: 18.5,
  captureLng: 73.8,
  duplicatePhoto: false,
};

function makeItem(overrides: Partial<RecceQueueItem> = {}): RecceQueueItem {
  return {
    id: 'r1',
    status: 'SUBMITTED',
    version: 1,
    site: { id: 's1', code: 'KW-1', name: 'Shop One', town: 'Pune', lat: 18.5, lng: 73.8 },
    submittedBy: { id: 'u1', name: 'Field Rep' },
    capturedAt: '2026-08-01T10:00:00.000Z',
    receivedAt: '2026-08-01T10:05:00.000Z',
    integrity: { ...baseIntegrity },
    posms: [
      { id: 'p1', slotNo: 1, posmType: { id: 't1', code: 'A', name: 'Board' }, dimensions: '2x3', photo: { key: 'k1', viewPath: '/v1/media/view?key=k1', geo: null }, markup: null },
      { id: 'p2', slotNo: 2, posmType: null, dimensions: null, photo: null, markup: null },
    ],
    ...overrides,
  };
}

// ─── mediaSrc ───────────────────────────────────────────────────────────────

describe('mediaSrc', () => {
  it('builds a proxied, auth-gated media URL and encodes the key', () => {
    expect(mediaSrc('tenant/abc.jpg')).toBe('/api/media/view?key=tenant%2Fabc.jpg');
  });
  it('encodes query-hostile characters', () => {
    expect(mediaSrc('a b&c=d')).toBe('/api/media/view?key=a%20b%26c%3Dd');
  });
});

// ─── queueQueryString ─────────────────────────────────────────────────────────

describe('queueQueryString', () => {
  it('returns an empty string for no filters', () => {
    expect(queueQueryString()).toBe('');
    expect(queueQueryString({})).toBe('');
  });
  it('drops blank / whitespace-only string filters', () => {
    expect(queueQueryString({ siteCode: '   ', town: '' })).toBe('');
  });
  it('trims and serialises string filters', () => {
    expect(queueQueryString({ siteCode: ' KW-1 ', town: 'Pune' })).toBe('?siteCode=KW-1&town=Pune');
  });
  it('includes page and limit when provided', () => {
    expect(queueQueryString({ page: 2, limit: 50 })).toBe('?page=2&limit=50');
  });
  it('serialises page 0 (does not treat 0 as absent)', () => {
    expect(queueQueryString({ page: 0 })).toBe('?page=0');
  });
});

// ─── recceFlags ───────────────────────────────────────────────────────────────

describe('recceFlags', () => {
  it('returns no flags for a clean recce', () => {
    expect(recceFlags(makeItem())).toEqual([]);
  });
  it('flags an out-of-fence recce with the distance', () => {
    const item = makeItem({ integrity: { ...baseIntegrity, geoFenceOk: false, distanceMeters: 254.6 } });
    expect(recceFlags(item)).toContain('Outside geo-fence (255 m away)');
  });
  it('flags out-of-fence without a distance when unknown', () => {
    const item = makeItem({ integrity: { ...baseIntegrity, geoFenceOk: false, distanceMeters: null } });
    expect(recceFlags(item)).toContain('Outside geo-fence');
  });
  it('flags a duplicate photo', () => {
    const item = makeItem({ integrity: { ...baseIntegrity, duplicatePhoto: true } });
    expect(recceFlags(item)).toContain('Duplicate photo detected');
  });
  it('flags low GPS accuracy over 100 m only', () => {
    expect(recceFlags(makeItem({ integrity: { ...baseIntegrity, captureAccuracy: 150 } }))).toContain(
      'Low GPS accuracy (±150 m)',
    );
    expect(recceFlags(makeItem({ integrity: { ...baseIntegrity, captureAccuracy: 80 } }))).toEqual([]);
  });
  it('does not flag on a null geoFenceOk (unknown, not failed)', () => {
    expect(recceFlags(makeItem({ integrity: { ...baseIntegrity, geoFenceOk: null } }))).toEqual([]);
  });
  it('accumulates multiple flags', () => {
    const item = makeItem({
      integrity: { ...baseIntegrity, geoFenceOk: false, distanceMeters: 300, duplicatePhoto: true, captureAccuracy: 200 },
    });
    expect(recceFlags(item)).toHaveLength(3);
  });
});

// ─── photoCount ───────────────────────────────────────────────────────────────

describe('photoCount', () => {
  it('counts only POSM lines that carry a photo', () => {
    expect(photoCount(makeItem())).toBe(1);
  });
  it('is zero when no line has a photo', () => {
    const item = makeItem({ posms: [{ id: 'p', slotNo: 1, posmType: null, dimensions: null, photo: null, markup: null }] });
    expect(photoCount(item)).toBe(0);
  });
});

// ─── summarizeQueue ───────────────────────────────────────────────────────────

describe('summarizeQueue', () => {
  it('summarises an empty queue', () => {
    expect(summarizeQueue([])).toEqual({ total: 0, flagged: 0, towns: 0 });
  });
  it('counts totals, flagged recces and distinct towns (case-insensitive)', () => {
    const items = [
      makeItem({ id: 'a', site: { id: 's1', code: 'K1', name: 'A', town: 'Pune', lat: null, lng: null } }),
      makeItem({ id: 'b', site: { id: 's2', code: 'K2', name: 'B', town: 'pune', lat: null, lng: null } }),
      makeItem({
        id: 'c',
        site: { id: 's3', code: 'K3', name: 'C', town: 'Mumbai', lat: null, lng: null },
        integrity: { ...baseIntegrity, duplicatePhoto: true },
      }),
      makeItem({ id: 'd', site: { id: 's4', code: 'K4', name: 'D', town: null, lat: null, lng: null } }),
    ];
    expect(summarizeQueue(items)).toEqual({ total: 4, flagged: 1, towns: 2 });
  });
});

// ─── reject vocabulary ─────────────────────────────────────────────────────────

describe('reject reason vocabulary', () => {
  it('has a human label for every code', () => {
    for (const code of REJECT_REASON_CODES) {
      expect(REJECT_REASON_LABELS[code]).toBeTruthy();
    }
  });
  it('mirrors the backend RejectReasonCode enum exactly', () => {
    expect([...REJECT_REASON_CODES]).toEqual([
      'BLURRY',
      'WRONG_SITE',
      'POSM_NOT_VISIBLE',
      'GEO_MISMATCH',
      'DUPLICATE_PHOTO',
      'WRONG_POSM',
      'DIMENSIONS_MISMATCH',
      'OTHER',
    ]);
  });
});
