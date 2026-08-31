'use client';

/**
 * Admin → Settings → Capture / Geo-fence.
 *
 * The tenant admin controls the geo-fence: whether it's enforced, the radius (metres) a
 * capture must fall within of the outlet (the "is the rep AT the store?" distance, e.g. 500 m),
 * and the GPS-accuracy cap. What's saved here is exactly what the recce + installation lanes
 * enforce (both read the same server-side resolver).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Save, ShieldCheck, AlertCircle } from 'lucide-react';
import {
  fetchCaptureConfig,
  saveCaptureConfig,
  validateGeoFence,
  RADIUS_MIN,
  RADIUS_MAX,
  ACCURACY_MIN,
  ACCURACY_MAX,
  type CaptureConfig,
} from '@/lib/admin/settings-api';

type NumOrEmpty = number | '';

export default function CaptureSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [nearby, setNearby] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [radius, setRadius] = useState<NumOrEmpty>('');
  const [accuracy, setAccuracy] = useState<NumOrEmpty>('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await fetchCaptureConfig();
    if (!res.success) {
      setLoadError(res.error || 'Could not load settings.');
      setLoading(false);
      return;
    }
    apply(res.data);
    setLoading(false);
  }, []);

  const apply = (c: CaptureConfig) => {
    setEnabled(c.geoFence.enabled);
    setRadius(c.geoFence.radiusMeters);
    setAccuracy(c.geoFence.maxAccuracyMeters);
    setNearby(c.nearbyOutletsEnabled);
  };

  useEffect(() => {
    void load();
  }, [load]);

  const errors = useMemo(
    () => validateGeoFence({ radiusMeters: radius, maxAccuracyMeters: accuracy }),
    [radius, accuracy],
  );
  const valid = Object.keys(errors).length === 0;

  const save = async () => {
    if (saving || !valid) return;
    setSaving(true);
    const res = await saveCaptureConfig({
      geoFence: {
        enabled,
        radiusMeters: radius as number,
        maxAccuracyMeters: accuracy as number,
      },
    });
    setSaving(false);
    if (!res.success) {
      toast.error(res.error || 'Could not save settings.');
      return;
    }
    apply(res.data);
    toast.success('Capture settings saved.');
  };

  const numInput = (v: NumOrEmpty, set: (n: NumOrEmpty) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.trim();
    set(raw === '' ? '' : Number(raw));
  };

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Capture settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          The geo-fence controls how location is checked when a rep captures a recce or installation photo.
        </p>
      </header>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : loadError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center">
          <AlertCircle className="mx-auto mb-2 h-6 w-6 text-red-500" />
          <p className="text-sm text-red-700">{loadError}</p>
          <button
            onClick={() => void load()}
            className="mt-3 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white active:scale-95"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-primary-light)]">
                <ShieldCheck className="h-5 w-5 text-[var(--brand-primary)]" />
              </div>
              <div className="flex-1">
                <label className="flex items-center justify-between gap-3">
                  <span>
                    <span className="block text-sm font-semibold text-gray-900">Enforce the geo-fence</span>
                    <span className="mt-0.5 block text-xs text-gray-500">
                      When on, a capture outside the radius (or with no usable GPS) is blocked. When off, it&apos;s
                      still recorded and flagged for the reviewer, never blocked.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="h-5 w-5 shrink-0 accent-[var(--brand-primary)]"
                    aria-label="Enforce the geo-fence"
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <label htmlFor="radius" className="block text-sm font-semibold text-gray-900">
              Geo-fence radius (metres)
            </label>
            <p className="mt-0.5 text-xs text-gray-500">
              How close to the outlet a capture must be to count as &ldquo;at the outlet&rdquo;. Typical: 100–500 m.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                id="radius"
                type="number"
                inputMode="numeric"
                min={RADIUS_MIN}
                max={RADIUS_MAX}
                value={radius}
                onChange={numInput(radius, setRadius)}
                className="w-40 rounded-xl border-2 border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-[var(--brand-primary)] focus:outline-none"
              />
              <span className="text-sm text-gray-500">metres</span>
            </div>
            {errors.radiusMeters && <p className="mt-1.5 text-xs text-red-600">{errors.radiusMeters}</p>}
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <label htmlFor="accuracy" className="block text-sm font-semibold text-gray-900">
              GPS-accuracy cap (metres)
            </label>
            <p className="mt-0.5 text-xs text-gray-500">
              A GPS fix reported less accurate than this is treated as unverifiable (flagged, and blocked when the
              fence is enforced). Typical: 50–100 m.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                id="accuracy"
                type="number"
                inputMode="numeric"
                min={ACCURACY_MIN}
                max={ACCURACY_MAX}
                value={accuracy}
                onChange={numInput(accuracy, setAccuracy)}
                className="w-40 rounded-xl border-2 border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-[var(--brand-primary)] focus:outline-none"
              />
              <span className="text-sm text-gray-500">metres</span>
            </div>
            {errors.maxAccuracyMeters && <p className="mt-1.5 text-xs text-red-600">{errors.maxAccuracyMeters}</p>}
          </section>

          <p className="text-xs text-gray-400">
            Nearby-outlets helper is {nearby ? 'enabled' : 'disabled'} for your account (managed by Gifsy).
          </p>

          <div className="flex justify-end">
            <button
              onClick={() => void save()}
              disabled={saving || !valid}
              className="inline-flex items-center gap-2 rounded-2xl bg-[var(--brand-primary)] px-5 py-2.5 text-sm font-bold text-white hover:bg-[var(--brand-primary-dark)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
