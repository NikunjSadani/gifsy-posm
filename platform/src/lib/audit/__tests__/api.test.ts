import { describe, it, expect } from 'vitest';
import {
  geoStatus,
  geoStatusLabel,
  distanceLabel,
  formatLatLng,
  toApiMediaUrl,
  mediaUrlFromKey,
  reasonLabel,
  activeQualityFlags,
  hasIntegrityWarning,
  REJECT_REASONS,
  type QualityFlags,
} from '@/lib/audit/api';

describe('geoStatus (honest tri-state)', () => {
  it('maps the backend geoFenceOk verdict truthfully', () => {
    expect(geoStatus(true)).toBe('inside');
    expect(geoStatus(false)).toBe('outside');
    expect(geoStatus(null)).toBe('unverified');
    expect(geoStatus(undefined)).toBe('unverified');
  });

  it('never claims verification when the backend did not confirm it', () => {
    expect(geoStatusLabel(true)).toBe('Inside geo-fence');
    expect(geoStatusLabel(false)).toBe('Outside geo-fence');
    expect(geoStatusLabel(null)).toBe('Geo not verified');
    // Must not assert a positive "verified" claim on the unverified path.
    expect(geoStatusLabel(null).toLowerCase()).not.toContain('verified geo');
  });
});

describe('distanceLabel', () => {
  it('renders a dash for missing / non-finite input', () => {
    expect(distanceLabel(null)).toBe('—');
    expect(distanceLabel(undefined)).toBe('—');
    expect(distanceLabel(Number.NaN)).toBe('—');
  });
  it('renders metres under a kilometre', () => {
    expect(distanceLabel(0)).toBe('0 m');
    expect(distanceLabel(12.4)).toBe('12 m');
    expect(distanceLabel(999)).toBe('999 m');
  });
  it('renders kilometres at/over 1000 m', () => {
    expect(distanceLabel(1000)).toBe('1.0 km');
    expect(distanceLabel(1449)).toBe('1.4 km');
    expect(distanceLabel(12_000)).toBe('12 km');
  });
});

describe('formatLatLng', () => {
  it('formats a valid coordinate pair to 5 dp', () => {
    expect(formatLatLng(19.123456, 72.987654)).toBe('19.12346, 72.98765');
  });
  it('returns null when either side is missing or non-finite', () => {
    expect(formatLatLng(null, 72)).toBeNull();
    expect(formatLatLng(19, null)).toBeNull();
    expect(formatLatLng(Number.NaN, 72)).toBeNull();
  });
});

describe('toApiMediaUrl', () => {
  it('rewrites a /v1 view-path to the /api proxy path', () => {
    expect(toApiMediaUrl('/v1/media/view?key=posm-media%2Fc1%2Fa.jpg')).toBe(
      '/api/media/view?key=posm-media%2Fc1%2Fa.jpg',
    );
  });
  it('leaves an already-/api path unchanged', () => {
    expect(toApiMediaUrl('/api/media/view?key=x')).toBe('/api/media/view?key=x');
  });
  it('leaves an unrelated value unchanged', () => {
    expect(toApiMediaUrl('https://cdn/x.jpg')).toBe('https://cdn/x.jpg');
    expect(toApiMediaUrl('')).toBe('');
  });
});

describe('mediaUrlFromKey', () => {
  it('encodes the key into the proxy path', () => {
    expect(mediaUrlFromKey('posm-media/c1/a b.jpg')).toBe(
      '/api/media/view?key=posm-media%2Fc1%2Fa%20b.jpg',
    );
  });
});

describe('reasonLabel', () => {
  it('returns the human label for a known code', () => {
    expect(reasonLabel('GEO_MISMATCH')).toBe('Geo-location mismatch');
    expect(reasonLabel('OTHER')).toBe('Other (add a note)');
  });
  it('has a label for every reject reason', () => {
    for (const r of REJECT_REASONS) {
      expect(r.label.length).toBeGreaterThan(0);
    }
  });
});

describe('activeQualityFlags', () => {
  it('returns only the strictly-true boolean flags, in display order', () => {
    const flags: QualityFlags = { blur: true, lowLight: false, duplicate: true, siteToRecceMeters: 5 };
    expect(activeQualityFlags(flags)).toEqual(['Blurry', 'Duplicate']);
  });
  it('handles null / empty', () => {
    expect(activeQualityFlags(null)).toEqual([]);
    expect(activeQualityFlags({})).toEqual([]);
  });
});

describe('hasIntegrityWarning', () => {
  it('is clean only when in-fence, differs from recce, and no soft flags', () => {
    expect(
      hasIntegrityWarning({ geoFenceOk: true, beforeAfterDiffOk: true, qualityFlags: {} }),
    ).toBe(false);
  });
  it('warns on an outside/unverified fence', () => {
    expect(hasIntegrityWarning({ geoFenceOk: false, beforeAfterDiffOk: true, qualityFlags: {} })).toBe(true);
    expect(hasIntegrityWarning({ geoFenceOk: null, beforeAfterDiffOk: true, qualityFlags: {} })).toBe(true);
  });
  it('warns when before/after is not confirmed different', () => {
    expect(hasIntegrityWarning({ geoFenceOk: true, beforeAfterDiffOk: null, qualityFlags: {} })).toBe(true);
    expect(hasIntegrityWarning({ geoFenceOk: true, beforeAfterDiffOk: false, qualityFlags: {} })).toBe(true);
  });
  it('warns when any soft flag is raised', () => {
    expect(
      hasIntegrityWarning({ geoFenceOk: true, beforeAfterDiffOk: true, qualityFlags: { lowAccuracy: true } }),
    ).toBe(true);
  });
});
