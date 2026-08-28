import { aggregatePhotoFence } from './photo-geo.helper';

const ref = { lat: 19.076, lng: 72.877 };

describe('photo-geo.helper — aggregatePhotoFence', () => {
  it('all photos inside → geoFenceOk true, no outside', () => {
    const agg = aggregatePhotoFence(
      [{ geo: { lat: 19.0761, lng: 72.8771 } }, { geo: { lat: 19.0762, lng: 72.8772 } }],
      ref,
      100,
    );
    expect(agg.geoFenceOk).toBe(true);
    expect(agg.anyOutside).toBe(false);
    expect(agg.worst).not.toBeNull();
  });

  it('a photo beyond the radius → anyOutside true, geoFenceOk false', () => {
    const agg = aggregatePhotoFence(
      [{ geo: { lat: 19.0761, lng: 72.8771 } }, { geo: { lat: 19.5, lng: 72.9 } }],
      ref,
      100,
    );
    expect(agg.anyOutside).toBe(true);
    expect(agg.geoFenceOk).toBe(false);
    // The worst (farthest) fix is the representative.
    expect(agg.worst?.lat).toBeCloseTo(19.5, 3);
    expect(agg.worst?.distanceMeters).toBeGreaterThan(100);
  });

  it('no site reference → unverifiable (geoFenceOk null, never outside)', () => {
    const agg = aggregatePhotoFence([{ geo: { lat: 19.0761, lng: 72.8771 } }], null, 100);
    expect(agg.geoFenceOk).toBeNull();
    expect(agg.anyOutside).toBe(false);
    // Still surfaces the fix (distance unknown without a reference).
    expect(agg.worst?.distanceMeters).toBeNull();
  });

  it('no valid fix on any photo → unverifiable (null)', () => {
    const agg = aggregatePhotoFence([{ geo: undefined }, {}], ref, 100);
    expect(agg.geoFenceOk).toBeNull();
    expect(agg.worst).toBeNull();
  });
});
