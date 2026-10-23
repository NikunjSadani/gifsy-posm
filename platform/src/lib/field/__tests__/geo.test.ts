import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  geoErrorMessage,
  mapPositionError,
  formatFix,
  useGeo,
  type GeoErrorCode,
  type GeoFix,
} from '@/lib/field/geo';

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
  it('shows lat/lng only — accuracy is NOT displayed to the field user', () => {
    expect(formatFix({ lat: 19.076, lng: 72.8777, accuracy: 12.4 })).toBe('19.07600, 72.87770');
  });
  it('shows lat/lng when accuracy is absent', () => {
    expect(formatFix({ lat: 19.076, lng: 72.8777 })).toBe('19.07600, 72.87770');
  });
  it('shows lat/lng when accuracy is non-finite', () => {
    expect(formatFix({ lat: 1, lng: 2, accuracy: NaN })).toBe('1.00000, 2.00000');
  });
});

/**
 * Harness: a controllable `navigator.geolocation.watchPosition` so a test can drive the
 * sampling window — emit position fixes and errors on demand, and observe teardown.
 */
function installGeoMock() {
  let successCb: ((pos: unknown) => void) | null = null;
  let errorCb: ((err: unknown) => void) | null = null;
  const clearWatch = vi.fn();
  const watchPosition = vi.fn((s: (pos: unknown) => void, e: (err: unknown) => void) => {
    successCb = s;
    errorCb = e;
    return 123;
  });

  Object.defineProperty(globalThis.navigator, 'geolocation', {
    value: { watchPosition, clearWatch, getCurrentPosition: vi.fn() },
    configurable: true,
    writable: true,
  });

  return {
    watchPosition,
    clearWatch,
    emitPos: (coords: { latitude: number; longitude: number; accuracy?: number }, timestamp = 1_700_000_000_000) =>
      successCb?.({ coords, timestamp }),
    emitErr: (code: number) => errorCb?.({ code }),
  };
}

describe('useGeo().capture — sampling robustness (audit #5 / #7)', () => {
  let geo: ReturnType<typeof installGeoMock>;

  beforeEach(() => {
    vi.useFakeTimers();
    geo = installGeoMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('a watch error AFTER a good fix resolves with that fix (does not reject) — audit #5', async () => {
    const { result } = renderHook(() => useGeo());

    let p!: Promise<GeoFix>;
    act(() => {
      p = result.current.capture();
    });

    // First fix: 35 m (looser than GEO_GOOD_ENOUGH_M=20) → `best` set, sampling window opens.
    act(() => {
      geo.emitPos({ latitude: 19.076, longitude: 72.8777, accuracy: 35 });
    });
    // Transient POSITION_UNAVAILABLE under flaky signal — must hand up the 35 m fix, not reject.
    act(() => {
      geo.emitErr(2);
    });

    await expect(p).resolves.toMatchObject({ lat: 19.076, lng: 72.8777, accuracy: 35 });
    expect(geo.clearWatch).toHaveBeenCalledWith(123);
  });

  it('a watch error with NO prior fix still rejects with the mapped code', async () => {
    const { result } = renderHook(() => useGeo());

    let p!: Promise<GeoFix>;
    act(() => {
      p = result.current.capture();
    });
    // No fix captured yet → the error is the only outcome available.
    act(() => {
      geo.emitErr(1); // PERMISSION_DENIED
    });

    await expect(p).rejects.toMatchObject({ code: 'permission_denied' });
    expect(geo.clearWatch).toHaveBeenCalledWith(123);
  });

  it('unmount while a capture is in flight tears down the watch + timers and does not setState — audit #7', async () => {
    const { result, unmount } = renderHook(() => useGeo());

    act(() => {
      result.current.capture();
    });

    // A loose fix opens the sampling window (a pending setTimeout) and arms the hard timeout.
    act(() => {
      geo.emitPos({ latitude: 1, longitude: 2, accuracy: 50 });
    });
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Unmount mid-capture: the in-flight watch + timers must be cleaned up.
    unmount();

    expect(geo.clearWatch).toHaveBeenCalledWith(123);
    expect(vi.getTimerCount()).toBe(0);

    // A late platform callback after unmount must not trigger a setState-after-unmount warning.
    act(() => {
      geo.emitPos({ latitude: 1, longitude: 2, accuracy: 10 });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("can't perform a React state update"),
    );

    errorSpy.mockRestore();
  });
});
