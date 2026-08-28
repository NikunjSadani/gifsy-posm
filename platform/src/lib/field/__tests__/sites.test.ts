import { describe, it, expect } from 'vitest';
import {
  siteCoords,
  directionsUrl,
  statusPinColor,
  distanceMeters,
  formatDistance,
} from '@/lib/field/sites';

describe('siteCoords — Decimal/string/number normalisation', () => {
  it('parses string lat/lng (Prisma Decimal JSON form) to numbers', () => {
    expect(siteCoords({ lat: '19.076', lng: '72.8777' })).toEqual({ lat: 19.076, lng: 72.8777 });
  });
  it('passes through numeric lat/lng', () => {
    expect(siteCoords({ lat: 12.9, lng: 77.6 })).toEqual({ lat: 12.9, lng: 77.6 });
  });
  it('returns null when either coordinate is missing', () => {
    expect(siteCoords({ lat: null, lng: '72.8' })).toBeNull();
    expect(siteCoords({ lat: '19.0', lng: null })).toBeNull();
  });
  it('returns null for a non-numeric coordinate', () => {
    expect(siteCoords({ lat: 'abc', lng: '72.8' })).toBeNull();
  });
});

describe('directionsUrl — free Google Maps deep-link', () => {
  it('builds a directions link from a geotag', () => {
    expect(directionsUrl({ lat: '19.076', lng: '72.8777' })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=19.076,72.8777',
    );
  });
  it('is null when the site has no geotag', () => {
    expect(directionsUrl({ lat: null, lng: null })).toBeNull();
  });
});

describe('statusPinColor', () => {
  it('is green for ACTIVE and gray for INACTIVE', () => {
    expect(statusPinColor('ACTIVE')).toBe('#16a34a');
    expect(statusPinColor('INACTIVE')).toBe('#9ca3af');
  });
});

describe('distanceMeters + formatDistance', () => {
  it('measures ~0 between identical points', () => {
    expect(distanceMeters(19.076, 72.8777, 19.076, 72.8777)).toBeCloseTo(0, 3);
  });
  it('measures a realistic distance (Mumbai↔Pune ~120km)', () => {
    const d = distanceMeters(19.076, 72.8777, 18.5204, 73.8567);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(130_000);
  });
  it('formats sub-km in metres and above in km', () => {
    expect(formatDistance(320)).toBe('320 m');
    expect(formatDistance(1400)).toBe('1.4 km');
    expect(formatDistance(15_000)).toBe('15 km');
  });
});
