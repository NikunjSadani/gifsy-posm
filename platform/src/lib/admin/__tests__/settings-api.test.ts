import { describe, it, expect } from 'vitest';
import { validateGeoFence, RADIUS_MIN, RADIUS_MAX } from '../settings-api';

describe('validateGeoFence', () => {
  it('accepts a valid 500 m fence + 50 m accuracy', () => {
    expect(validateGeoFence({ radiusMeters: 500, maxAccuracyMeters: 50 })).toEqual({});
  });

  it('rejects an empty radius', () => {
    expect(validateGeoFence({ radiusMeters: '', maxAccuracyMeters: 50 }).radiusMeters).toBeTruthy();
  });

  it('rejects a non-integer / out-of-bounds radius', () => {
    expect(validateGeoFence({ radiusMeters: 12.5, maxAccuracyMeters: 50 }).radiusMeters).toBeTruthy();
    expect(validateGeoFence({ radiusMeters: RADIUS_MIN - 1, maxAccuracyMeters: 50 }).radiusMeters).toBeTruthy();
    expect(validateGeoFence({ radiusMeters: RADIUS_MAX + 1, maxAccuracyMeters: 50 }).radiusMeters).toBeTruthy();
  });

  it('rejects a bad accuracy but keeps a good radius clean', () => {
    const e = validateGeoFence({ radiusMeters: 300, maxAccuracyMeters: 0 });
    expect(e.radiusMeters).toBeUndefined();
    expect(e.maxAccuracyMeters).toBeTruthy();
  });
});
