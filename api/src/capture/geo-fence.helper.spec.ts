import { haversineMeters, isValidGeo, evaluatePhotoFence } from './geo-fence.helper';

describe('geo-fence.helper', () => {
  it('computes ~0 distance for identical points', () => {
    expect(haversineMeters({ lat: 19.07, lng: 72.87 }, { lat: 19.07, lng: 72.87 })).toBeCloseTo(0, 5);
  });

  it('computes a plausible distance for two Mumbai points', () => {
    const d = haversineMeters({ lat: 19.076, lng: 72.877 }, { lat: 19.086, lng: 72.877 });
    // ~1.1 km for 0.01° of latitude.
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1200);
  });

  it('rejects out-of-range / garbage geo', () => {
    expect(isValidGeo({ lat: 200, lng: 0 })).toBe(false);
    expect(isValidGeo(null)).toBe(false);
    expect(isValidGeo({ lat: 19, lng: 72 })).toBe(true);
  });

  it('flags a fence-required photo as unverifiable when there is no reference', () => {
    expect(evaluatePhotoFence({ lat: 19, lng: 72 }, null, 100)).toBe('unverifiable');
  });

  it('marks a nearby photo inside and a far photo outside', () => {
    const ref = { lat: 19.076, lng: 72.877 };
    expect(evaluatePhotoFence({ lat: 19.0761, lng: 72.8771 }, ref, 100)).toBe('inside');
    expect(evaluatePhotoFence({ lat: 19.2, lng: 72.9 }, ref, 100)).toBe('outside');
  });
});
