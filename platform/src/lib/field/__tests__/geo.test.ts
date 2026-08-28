import { describe, it, expect } from 'vitest';
import { geoErrorMessage, mapPositionError, formatFix, type GeoErrorCode } from '@/lib/field/geo';

describe('mapPositionError — W3C code → typed code', () => {
  it('maps PERMISSION_DENIED (1)', () => {
    expect(mapPositionError({ code: 1 })).toBe('permission_denied');
  });
  it('maps POSITION_UNAVAILABLE (2)', () => {
    expect(mapPositionError({ code: 2 })).toBe('unavailable');
  });
  it('maps TIMEOUT (3)', () => {
    expect(mapPositionError({ code: 3 })).toBe('timeout');
  });
  it('falls back to unavailable for unknown/missing code', () => {
    expect(mapPositionError({ code: 99 })).toBe('unavailable');
    expect(mapPositionError(null)).toBe('unavailable');
    expect(mapPositionError(undefined)).toBe('unavailable');
  });
});

describe('geoErrorMessage — every code has honest, non-empty copy', () => {
  const codes: GeoErrorCode[] = ['unsupported', 'permission_denied', 'unavailable', 'timeout'];
  it('returns a non-empty message for each code', () => {
    for (const c of codes) {
      expect(geoErrorMessage(c).length).toBeGreaterThan(0);
    }
  });
  it('makes no "verified"/"real"/anti-spoof claim', () => {
    for (const c of codes) {
      expect(geoErrorMessage(c).toLowerCase()).not.toMatch(/verified|spoof|mock|genuine/);
    }
  });
});

describe('formatFix — display of a GPS fix', () => {
  it('includes rounded accuracy when present', () => {
    expect(formatFix({ lat: 19.076, lng: 72.8777, accuracy: 12.4 })).toBe('19.07600, 72.87770 · ±12 m');
  });
  it('omits accuracy when absent', () => {
    expect(formatFix({ lat: 19.076, lng: 72.8777 })).toBe('19.07600, 72.87770');
  });
  it('omits accuracy when non-finite', () => {
    expect(formatFix({ lat: 1, lng: 2, accuracy: NaN })).toBe('1.00000, 2.00000');
  });
});
