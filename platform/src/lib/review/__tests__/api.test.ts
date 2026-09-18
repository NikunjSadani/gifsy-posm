import { describe, it, expect } from 'vitest';
import {
  mediaSrc,
  queueQueryString,
  recceFlags,
  photoCount,
  posmQualityFlags,
  summarizeQueue,
  dimensionsLabel,
  flaggedOnPageLabel,
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
      { id: 'p1', slotNo: 1, posmType: { id: 't1', code: 'A', name: 'Board' }, dimensions: '2x3', photo: { key: 'k1', viewPath: '/v1/media/view?key=k1', geo: null }, markup: null, qualityFlags: null },
      { id: 'p2', slotNo: 2, posmType: null, dimensions: null, photo: null, markup: null, qualityFlags: null },
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
    const item = makeItem({ posms: [{ id: 'p', slotNo: 1, posmType: null, dimensions: null, photo: null, markup: null, qualityFlags: null }] });
    expect(photoCount(item)).toBe(0);
  });
});

// ─── posmQualityFlags ───────────────────────────────────────────────────────────

describe('posmQualityFlags', () => {
  it('returns no labels for null (legacy recce) or undefined flags', () => {
    expect(posmQualityFlags(null)).toEqual([]);
    expect(posmQualityFlags(undefined)).toEqual([]);
  });
  it('returns no labels when all flags are false', () => {
    expect(posmQualityFlags({ blur: false, blank: false, lowLight: false, overexposed: false, lowAccuracy: false })).toEqual([]);
  });
  it('maps each raised flag to its plain ASM label', () => {
    expect(posmQualityFlags({ blur: false, blank: true, lowLight: false, overexposed: false, lowAccuracy: false })).toEqual(['Blank']);
    expect(posmQualityFlags({ blur: true, blank: false, lowLight: false, overexposed: false, lowAccuracy: false })).toEqual(['Blurry']);
    expect(posmQualityFlags({ blur: false, blank: false, lowLight: true, overexposed: false, lowAccuracy: false })).toEqual(['Dark']);
    expect(posmQualityFlags({ blur: false, blank: false, lowLight: false, overexposed: true, lowAccuracy: false })).toEqual(['Too bright']);
    expect(posmQualityFlags({ blur: false, blank: false, lowLight: false, overexposed: false, lowAccuracy: true })).toEqual(['Weak GPS']);
  });
  it('returns raised labels in display order (blank → blur → dark → too bright → weak GPS)', () => {
    expect(posmQualityFlags({ blur: true, blank: true, lowLight: true, overexposed: true, lowAccuracy: true })).toEqual([
      'Blank',
      'Blurry',
      'Dark',
      'Too bright',
      'Weak GPS',
    ]);
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

// ─── dimensionsLabel ────────────────────────────────────────────────────────────

describe('dimensionsLabel', () => {
  it('renders the backend {width,height,unit} object as a string (the crash case)', () => {
    expect(dimensionsLabel({ width: 2, height: 3, unit: 'ft' })).toBe('2 × 3 ft');
  });
  it('renders width/height with no unit', () => {
    expect(dimensionsLabel({ width: 4, height: 6 })).toBe('4 × 6');
  });
  it('accepts the short w/h keys', () => {
    expect(dimensionsLabel({ w: 10, h: 20, unit: 'cm' })).toBe('10 × 20 cm');
  });
  it('passes a legacy string through, trimmed', () => {
    expect(dimensionsLabel('  2x3  ')).toBe('2x3');
  });
  it('returns null for empty / missing / unrenderable values', () => {
    expect(dimensionsLabel(null)).toBeNull();
    expect(dimensionsLabel(undefined)).toBeNull();
    expect(dimensionsLabel('')).toBeNull();
    expect(dimensionsLabel('   ')).toBeNull();
    expect(dimensionsLabel({})).toBeNull();
    expect(dimensionsLabel({ width: 2 })).toBeNull();
  });
});

// ─── flaggedOnPageLabel ─────────────────────────────────────────────────────────

describe('flaggedOnPageLabel', () => {
  it('is null when nothing on the page is flagged', () => {
    expect(flaggedOnPageLabel(0)).toBeNull();
    expect(flaggedOnPageLabel(-1)).toBeNull();
  });
  it('scopes the count honestly to the current page', () => {
    expect(flaggedOnPageLabel(1)).toBe('1 flagged on this page');
    expect(flaggedOnPageLabel(7)).toBe('7 flagged on this page');
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
