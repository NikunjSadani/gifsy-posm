import { describe, it, expect } from 'vitest';
import {
  formatPct,
  conversionPct,
  formatDays,
  buildFunnel,
  stageColor,
  geoFenceLabel,
  exportUrl,
  recordsQueryString,
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
  const w: SummaryWaterfall = { totalSites: 100, recced: 80, approved: 60, installed: 40, audited: 20 };

  it('produces the 5 ordered stages', () => {
    const stages = buildFunnel(w);
    expect(stages.map((s) => s.key)).toEqual(['totalSites', 'recced', 'approved', 'installed', 'audited']);
  });

  it('sets bar width as a share of total sites', () => {
    const stages = buildFunnel(w);
    expect(stages[0].pctOfTotal).toBe(100); // total
    expect(stages[1].pctOfTotal).toBe(80); // recced
    expect(stages[4].pctOfTotal).toBe(20); // audited
  });

  it('computes step-to-step conversion from the previous stage', () => {
    const stages = buildFunnel(w);
    expect(stages[0].conversionFromPrev).toBeNull(); // first stage
    expect(stages[1].conversionFromPrev).toBe(80); // 80/100
    expect(stages[2].conversionFromPrev).toBe(75); // 60/80
    expect(stages[3].conversionFromPrev).toBeCloseTo(66.666, 2); // 40/60
    expect(stages[4].conversionFromPrev).toBe(50); // 20/40
  });

  it('gives drill targets for every stage except the total universe', () => {
    const stages = buildFunnel(w);
    expect(stages[0].drill).toBeNull();
    expect(stages[1].drill).toEqual({ stage: 'recce' });
    expect(stages[2].drill).toEqual({ stage: 'recce', status: 'APPROVED' });
    expect(stages[3].drill).toEqual({ stage: 'install' });
    expect(stages[4].drill).toEqual({ stage: 'install', status: 'AUDITED' });
  });

  it('degrades honestly when there are zero sites (no divide-by-zero, no fake 0%)', () => {
    const stages = buildFunnel({ totalSites: 0, recced: 0, approved: 0, installed: 0, audited: 0 });
    expect(stages[0].pctOfTotal).toBeNull();
    expect(stages[1].pctOfTotal).toBeNull();
    expect(stages[1].conversionFromPrev).toBeNull();
    expect(formatPct(stages[1].conversionFromPrev)).toBe('—');
  });
});

// ─── stageColor / stage tables ─────────────────────────────────────────────────

describe('stageColor', () => {
  it('maps each furthest stage to its heatmap colour', () => {
    expect(stageColor('NONE')).toBe('#9ca3af');
    expect(stageColor('RECCED')).toBe('#f59e0b');
    expect(stageColor('APPROVED')).toBe('#3b82f6');
    expect(stageColor('INSTALLED')).toBe('#8b5cf6');
    expect(stageColor('AUDITED')).toBe('#22c55e');
  });
  it('falls back to grey for an unknown / null value', () => {
    expect(stageColor('WHATEVER')).toBe(STAGE_COLORS.NONE);
    expect(stageColor(null)).toBe(STAGE_COLORS.NONE);
    expect(stageColor(undefined)).toBe(STAGE_COLORS.NONE);
  });
  it('has a colour and label for every ordered stage', () => {
    for (const s of STAGE_ORDER) {
      expect(STAGE_COLORS[s as FurthestStage]).toBeTruthy();
      expect(STAGE_LABELS[s as FurthestStage]).toBeTruthy();
    }
    expect(STAGE_ORDER).toHaveLength(5);
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
