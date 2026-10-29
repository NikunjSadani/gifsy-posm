import { describe, it, expect } from 'vitest';
import {
  siteCoords,
  directionsUrl,
  statusPinColor,
  distanceMeters,
  formatDistance,
  rankByDistance,
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
    expect(distanceMeters({ lat: 19.076, lng: 72.8777 }, { lat: 19.076, lng: 72.8777 })).toBeCloseTo(0, 3);
  });
  it('measures a realistic distance (Mumbai↔Pune ~120km)', () => {
    const d = distanceMeters({ lat: 19.076, lng: 72.8777 }, { lat: 18.5204, lng: 73.8567 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(130_000);
  });
  it('is symmetric (order of the two points does not matter)', () => {
    const a = { lat: 19.076, lng: 72.8777 };
    const b = { lat: 18.5204, lng: 73.8567 };
    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 6);
  });
  it('formats sub-km in metres and ≥1000 m in km (threshold)', () => {
    expect(formatDistance(350)).toBe('350 m');
    expect(formatDistance(999)).toBe('999 m');
    expect(formatDistance(1000)).toBe('1.0 km'); // exactly 1000 m crosses to km
    expect(formatDistance(1200)).toBe('1.2 km');
    expect(formatDistance(1400)).toBe('1.4 km');
    expect(formatDistance(15_000)).toBe('15 km'); // ≥10 km drops the decimal
  });
});

describe('rankByDistance — distance-ordered field outlet list', () => {
  interface O {
    id: string;
    name: string;
    lat: number | null;
    lng: number | null;
  }
  const near: O = { id: 'near', name: 'Zeta', lat: 19.076, lng: 72.8777 }; // Mumbai (= the fix)
  const mid: O = { id: 'mid', name: 'Alpha', lat: 18.5204, lng: 73.8567 }; // Pune ~120 km
  const far: O = { id: 'far', name: 'Mike', lat: 28.6139, lng: 77.209 }; // Delhi ~1150 km
  const noGeoA: O = { id: 'nA', name: 'Bravo', lat: null, lng: null };
  const noGeoB: O = { id: 'nB', name: 'Yankee', lat: 19.0, lng: null };
  const FIX = { lat: 19.076, lng: 72.8777 };

  const coordsOf = (o: O) => (o.lat != null && o.lng != null ? { lat: o.lat, lng: o.lng } : null);
  const nameOf = (o: O) => o.name;
  const ids = (items: { item: O }[]) => items.map((r) => r.item.id);

  it('nearest-first: ranks by proximity to the device fix', () => {
    const r = rankByDistance([far, near, mid], FIX, coordsOf, nameOf, 'nearest');
    expect(ids(r)).toEqual(['near', 'mid', 'far']);
    // Each ranked item carries its computed distance for the card chip.
    expect(r[0].distanceMeters).toBeCloseTo(0, 3);
    expect(r[1].distanceMeters).toBeGreaterThan(100_000);
  });

  it('outlets with NO geotag always sort to the END (and keep their original relative order)', () => {
    const r = rankByDistance([noGeoA, far, noGeoB, near], FIX, coordsOf, nameOf, 'nearest');
    expect(ids(r)).toEqual(['near', 'far', 'nA', 'nB']); // ranked first, then the two null-geo in input order
    expect(r[2].distanceMeters).toBeNull();
    expect(r[3].distanceMeters).toBeNull();
  });

  it('no fix → nearest mode leaves the list in its ORIGINAL order, every distance null', () => {
    const input = [far, near, mid, noGeoA];
    const r = rankByDistance(input, null, coordsOf, nameOf, 'nearest');
    expect(ids(r)).toEqual(['far', 'near', 'mid', 'nA']); // untouched
    expect(r.every((x) => x.distanceMeters === null)).toBe(true);
  });

  it('A–Z mode sorts by name (case-insensitive), independent of any fix', () => {
    const r = rankByDistance([near, mid, far, noGeoA], FIX, coordsOf, nameOf, 'name');
    // Alpha, Bravo, Mike, Zeta
    expect(ids(r)).toEqual(['mid', 'nA', 'far', 'near']);
    // Distances are still annotated in name mode when a fix exists (for the chip).
    expect(r[0].distanceMeters).toBeGreaterThan(0); // 'mid' (Alpha) has a geotag
    expect(r[1].distanceMeters).toBeNull(); // 'nA' (Bravo) has none
  });

  it('does not mutate the input array', () => {
    const input = [far, near, mid];
    rankByDistance(input, FIX, coordsOf, nameOf, 'nearest');
    expect(input.map((o) => o.id)).toEqual(['far', 'near', 'mid']);
  });
});
