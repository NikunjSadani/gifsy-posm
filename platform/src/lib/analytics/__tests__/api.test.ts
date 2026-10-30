import { describe, it, expect } from 'vitest';
import {
  formatPct,
  conversionPct,
  formatDays,
  buildFunnel,
  stageColor,
  geoFenceLabel,
  exportUrl,
  drilldownExportUrl,
  recordsQueryString,
  drilldownQueryString,
  toAnalyticsMediaUrl,
  STAGE_COLORS,
  STAGE_LABELS,
  STAGE_ORDER,
  type SummaryWaterfall,
  type FurthestStage,
} from '@/lib/analytics/api';

// ─── formatPct ──────────────────────────────────────────────────────────────

describe('formatPct', () => {
  it('renders "—" for null / undefined / NaN (never a misleading 0%)', () => {
    expect(formatPct(null)).toBe('—');
    expect(formatPct(undefined)).toBe('—');
    expect(formatPct(Number.NaN)).toBe('—');
  });
  it('renders a real 0 as "0%"', () => {
    expect(formatPct(0)).toBe('0%');
  });
  it('rounds to the nearest whole percent', () => {
    expect(formatPct(83.4)).toBe('83%');
    expect(formatPct(83.6)).toBe('84%');
    expect(formatPct(100)).toBe('100%');
  });
});

// ─── conversionPct ────────────────────────────────────────────────────────────

describe('conversionPct', () => {
  it('returns null for a 0 / missing denominator (a 0-of-0 ratio is blank, not 0%)', () => {
    expect(conversionPct(0, 0)).toBeNull();
    expect(conversionPct(5, 0)).toBeNull();
  });
  it('computes the percentage', () => {
    expect(conversionPct(1, 2)).toBe(50);
    expect(conversionPct(3, 4)).toBe(75);
  });
  it('formats through formatPct as "—" when denominator is 0', () => {
    expect(formatPct(conversionPct(0, 0))).toBe('—');
  });
});

// ─── formatDays ───────────────────────────────────────────────────────────────

describe('formatDays', () => {
  it('renders "—" for null / NaN', () => {
    expect(formatDays(null)).toBe('—');
    expect(formatDays(Number.NaN)).toBe('—');
  });
  it('formats to one decimal with a "d" suffix', () => {
    expect(formatDays(2)).toBe('2.0 d');
    expect(formatDays(3.456)).toBe('3.5 d');
  });
});

// ─── buildFunnel ──────────────────────────────────────────────────────────────

describe('buildFunnel', () => {
  // approved (ASM-approved) = 60; hoApproved (installable) = 50 — distinct, HO ⊆ ASM.
  const w: SummaryWaterfall = { totalSites: 100, recced: 80, approved: 60, hoApproved: 50, installed: 40, audited: 20 };

  it('produces the 6 ordered stages (ASM approved + HO approved distinct)', () => {
    const stages = buildFunnel(w);
    expect(stages.map((s) => s.key)).toEqual([
      'totalSites', 'recced', 'approved', 'hoApproved', 'installed', 'audited',
    ]);
    // ASM approved and HO approved are labelled unambiguously (never a bare "Approved").
    expect(stages[2].label).toBe('ASM approved');
    expect(stages[3].label).toBe('HO approved');
  });

  it('sets bar width as a share of total sites', () => {
    const stages = buildFunnel(w);
    expect(stages[0].pctOfTotal).toBe(100); // total
    expect(stages[1].pctOfTotal).toBe(80); // recced
    expect(stages[2].pctOfTotal).toBe(60); // ASM approved
    expect(stages[3].pctOfTotal).toBe(50); // HO approved
    expect(stages[5].pctOfTotal).toBe(20); // audited
  });

  it('computes step-to-step conversion from the previous stage', () => {
    const stages = buildFunnel(w);
    expect(stages[0].conversionFromPrev).toBeNull(); // first stage
    expect(stages[1].conversionFromPrev).toBe(80); // recced 80/100
    expect(stages[2].conversionFromPrev).toBe(75); // ASM approved 60/80
    expect(stages[3].conversionFromPrev).toBeCloseTo(83.333, 2); // HO approved 50/60
    expect(stages[4].conversionFromPrev).toBe(80); // installed 40/50 (from HO approved, not ASM)
    expect(stages[5].conversionFromPrev).toBe(50); // audited 20/40
  });

  it('maps every stage to a drill-down metric — including Total outlets and HO approved', () => {
    const stages = buildFunnel(w);
    // Every funnel stage is now drillable via the unified sheet (the dedicated /drilldown endpoint
    // resolves HO approved correctly, so it is no longer dead, and Total outlets is drillable too).
    expect(stages.map((s) => s.metric)).toEqual([
      'total-outlets', 'recce', 'asm-approved', 'ho-approved', 'installed', 'audited',
    ]);
  });

  it('degrades honestly when there are zero sites (no divide-by-zero, no fake 0%)', () => {
    const stages = buildFunnel({ totalSites: 0, recced: 0, approved: 0, hoApproved: 0, installed: 0, audited: 0 });
    expect(stages[0].pctOfTotal).toBeNull();
    expect(stages[1].pctOfTotal).toBeNull();
    expect(stages[1].conversionFromPrev).toBeNull();
    expect(formatPct(stages[1].conversionFromPrev)).toBe('—');
  });
});

// ─── stageColor / stage tables ─────────────────────────────────────────────────

describe('stageColor', () => {
  it('maps each furthest stage to its heatmap colour (ASM vs HO approved distinct)', () => {
    expect(stageColor('NONE')).toBe('#9ca3af');
    expect(stageColor('RECCED')).toBe('#f59e0b');
    expect(stageColor('ASM_APPROVED')).toBe('#3b82f6');
    expect(stageColor('HO_APPROVED')).toBe('#6366f1');
    expect(stageColor('ASM_APPROVED')).not.toBe(stageColor('HO_APPROVED'));
    expect(stageColor('INSTALLED')).toBe('#8b5cf6');
    expect(stageColor('AUDITED')).toBe('#22c55e');
  });
  it('falls back to grey for an unknown / null value (incl. the retired bare APPROVED)', () => {
    expect(stageColor('WHATEVER')).toBe(STAGE_COLORS.NONE);
    expect(stageColor('APPROVED')).toBe(STAGE_COLORS.NONE); // bare APPROVED no longer a stage
    expect(stageColor(null)).toBe(STAGE_COLORS.NONE);
    expect(stageColor(undefined)).toBe(STAGE_COLORS.NONE);
  });
  it('has a colour and label for every ordered stage', () => {
    for (const s of STAGE_ORDER) {
      expect(STAGE_COLORS[s as FurthestStage]).toBeTruthy();
      expect(STAGE_LABELS[s as FurthestStage]).toBeTruthy();
    }
    expect(STAGE_ORDER).toHaveLength(6);
    expect(STAGE_LABELS.ASM_APPROVED).toBe('ASM approved');
    expect(STAGE_LABELS.HO_APPROVED).toBe('HO approved');
  });
});

// ─── geoFenceLabel ────────────────────────────────────────────────────────────

describe('geoFenceLabel', () => {
  it('never claims "verified"; renders inside / outside / not-verified truthfully', () => {
    expect(geoFenceLabel(true)).toEqual({ label: 'Inside geo-fence', tone: 'ok' });
    expect(geoFenceLabel(false)).toEqual({ label: 'Outside geo-fence', tone: 'bad' });
    expect(geoFenceLabel(null)).toEqual({ label: 'Location not verified', tone: 'unknown' });
    expect(geoFenceLabel(undefined)).toEqual({ label: 'Location not verified', tone: 'unknown' });
  });
});

// ─── exportUrl ────────────────────────────────────────────────────────────────

describe('exportUrl', () => {
  it('builds the plain same-origin export path (no stage param — export is always Summary + Scorecards)', () => {
    expect(exportUrl()).toBe('/api/analytics/export');
  });
});

// ─── drilldownExportUrl ─────────────────────────────────────────────────────────

describe('drilldownExportUrl', () => {
  // In jsdom window.location.origin is set, so the URL also carries an `&origin=…` param (for the
  // report's absolute photo links). Assert on the non-origin part, and that origin is appended.
  it('carries the metric; drops a blank vendorId', () => {
    expect(drilldownExportUrl('recce')).toMatch(/^\/api\/analytics\/drilldown\.xlsx\?metric=recce(&origin=[^&]+)?$/);
    expect(drilldownExportUrl('recce', { vendorId: '  ' })).toMatch(/^\/api\/analytics\/drilldown\.xlsx\?metric=recce(&origin=[^&]+)?$/);
  });
  it('serialises an admin vendorId narrowing', () => {
    const url = drilldownExportUrl('recce', { vendorId: 'v-9' });
    expect(url).toContain('metric=recce');
    expect(url).toContain('vendorId=v-9');
  });
  it('appends the app origin for the report photo links', () => {
    expect(drilldownExportUrl('recce')).toContain(`origin=${encodeURIComponent(window.location.origin)}`);
  });
});

// ─── recordsQueryString ───────────────────────────────────────────────────────

describe('recordsQueryString', () => {
  it('always includes the required stage', () => {
    expect(recordsQueryString({ stage: 'recce' })).toBe('?stage=recce');
  });
  it('drops a blank status but keeps a real one', () => {
    expect(recordsQueryString({ stage: 'recce', status: '   ' })).toBe('?stage=recce');
    expect(recordsQueryString({ stage: 'recce', status: 'APPROVED' })).toBe('?stage=recce&status=APPROVED');
  });
  it('serialises an optional vendorId (admin server-side drill-down) and drops a blank one', () => {
    expect(recordsQueryString({ stage: 'recce', vendorId: 'v-9' })).toBe('?stage=recce&vendorId=v-9');
    expect(recordsQueryString({ stage: 'recce', vendorId: '  ' })).toBe('?stage=recce');
  });
  it('serialises page (including 0) and limit', () => {
    expect(recordsQueryString({ stage: 'install', page: 0, limit: 20 })).toBe('?stage=install&page=0&limit=20');
  });
});

// ─── drilldownQueryString ───────────────────────────────────────────────────

describe('drilldownQueryString', () => {
  it('always includes the required metric', () => {
    expect(drilldownQueryString('ho-approved')).toBe('?metric=ho-approved');
    expect(drilldownQueryString('pending-asm-review')).toBe('?metric=pending-asm-review');
  });
  it('serialises an optional vendorId (admin scorecard-row drill-down) and drops a blank one', () => {
    expect(drilldownQueryString('recce', { vendorId: 'v-9' })).toBe('?metric=recce&vendorId=v-9');
    expect(drilldownQueryString('recce', { vendorId: '  ' })).toBe('?metric=recce');
  });
  it('serialises the keyset afterId cursor and limit (and drops a blank afterId)', () => {
    expect(drilldownQueryString('installed', { afterId: 'id-9', limit: 200 })).toBe('?metric=installed&afterId=id-9&limit=200');
    expect(drilldownQueryString('installed', { afterId: '  ', limit: 200 })).toBe('?metric=installed&limit=200');
  });
});

// ─── toAnalyticsMediaUrl ──────────────────────────────────────────────────────

describe('toAnalyticsMediaUrl', () => {
  it('maps a /v1 view-path to the /api proxy path', () => {
    expect(toAnalyticsMediaUrl('/v1/media/view?key=abc')).toBe('/api/media/view?key=abc');
  });
  it('leaves an already-/api or empty path unchanged', () => {
    expect(toAnalyticsMediaUrl('/api/media/view?key=abc')).toBe('/api/media/view?key=abc');
    expect(toAnalyticsMediaUrl('')).toBe('');
  });
});
