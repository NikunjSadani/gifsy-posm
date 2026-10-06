import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the network edge so we can assert the exact POST body the submit helpers build.
// `vi.hoisted` runs before the hoisted vi.mock factory, so `post` is initialised in time.
const { post, get } = vi.hoisted(() => ({
  post: vi.fn((_path: string, _body?: unknown) =>
    Promise.resolve({ success: true, data: { id: 'r1', status: 'SUBMITTED' } }),
  ),
  get: vi.fn((_url: string) => Promise.resolve({ success: true, data: { recces: [] } })),
}));
vi.mock('@/lib/api-client', () => ({ api: { post, get } }));

import {
  groupRecces,
  classifyRecce,
  findSiteRecce,
  rejectionLabel,
  submitRecce,
  resubmitRecce,
  fetchMyRecces,
  RECCE_GROUP_ORDER,
  type RecceGroupKey,
  type RecceListRow,
} from '@/lib/field/recce-api';
import type { CapturedReccePosm } from '@/components/field/capture/PosmCaptureCard';
import type { RecceMarkup } from '@/lib/markup';

/** Minimal recce-row factory for the grouping/lookup fixtures. */
function row(partial: Partial<RecceListRow> & Pick<RecceListRow, 'id' | 'status'>): RecceListRow {
  return {
    hoReviewStatus: 'NONE',
    version: 1,
    site: { id: `site-${partial.id}`, code: `C${partial.id}`, name: `Site ${partial.id}`, town: null },
    posmCount: 1,
    geoFenceOk: true,
    distanceMeters: 0,
    capturedAt: null,
    receivedAt: '2026-01-01T00:00:00.000Z',
    rejectionReasonCode: null,
    hoRejectionReasonCode: null,
    ...partial,
  };
}

describe('classifyRecce', () => {
  it('REJECTED → NEEDS_RECAPTURE (ASM or HO sent it back)', () => {
    expect(classifyRecce({ status: 'REJECTED', hoReviewStatus: 'NONE' })).toBe('NEEDS_RECAPTURE');
    expect(classifyRecce({ status: 'REJECTED', hoReviewStatus: 'REJECTED' })).toBe('NEEDS_RECAPTURE');
  });

  it('SUBMITTED → AWAITING_ASM', () => {
    expect(classifyRecce({ status: 'SUBMITTED', hoReviewStatus: 'NONE' })).toBe('AWAITING_ASM');
  });

  it('APPROVED is READY_TO_INSTALL only when HO has also approved', () => {
    expect(classifyRecce({ status: 'APPROVED', hoReviewStatus: 'APPROVED' })).toBe('READY_TO_INSTALL');
  });

  it('APPROVED but HO not yet approved → AWAITING_HO (PENDING or NONE)', () => {
    expect(classifyRecce({ status: 'APPROVED', hoReviewStatus: 'PENDING' })).toBe('AWAITING_HO');
    expect(classifyRecce({ status: 'APPROVED', hoReviewStatus: 'NONE' })).toBe('AWAITING_HO');
  });
});

describe('groupRecces', () => {
  it('returns no groups for an empty list', () => {
    expect(groupRecces([])).toEqual([]);
  });

  it('orders groups by action priority and drops empties', () => {
    const recces = [
      row({ id: '1', status: 'SUBMITTED' }),
      row({ id: '2', status: 'APPROVED', hoReviewStatus: 'PENDING' }),
      row({ id: '3', status: 'APPROVED', hoReviewStatus: 'APPROVED' }),
      row({ id: '4', status: 'REJECTED' }),
    ];
    const groups = groupRecces(recces);
    expect(groups.map((g) => g.key)).toEqual([
      'NEEDS_RECAPTURE',
      'READY_TO_INSTALL',
      'AWAITING_HO',
      'AWAITING_ASM',
    ]);
  });

  it('splits APPROVED into READY_TO_INSTALL (HO approved) vs AWAITING_HO (HO pending)', () => {
    const groups = groupRecces([
      row({ id: '1', status: 'APPROVED', hoReviewStatus: 'APPROVED' }),
      row({ id: '2', status: 'APPROVED', hoReviewStatus: 'PENDING' }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['READY_TO_INSTALL', 'AWAITING_HO']);
    expect(groups.find((g) => g.key === 'READY_TO_INSTALL')?.recces.map((r) => r.id)).toEqual(['1']);
    expect(groups.find((g) => g.key === 'AWAITING_HO')?.recces.map((r) => r.id)).toEqual(['2']);
  });

  it('only includes groups that are present', () => {
    const groups = groupRecces([row({ id: '1', status: 'SUBMITTED' }), row({ id: '2', status: 'SUBMITTED' })]);
    expect(groups.map((g) => g.key)).toEqual(['AWAITING_ASM']);
    expect(groups[0].recces).toHaveLength(2);
  });

  it('preserves the incoming order within a group (newest-first)', () => {
    const recces = [
      row({ id: 'a', status: 'REJECTED' }),
      row({ id: 'b', status: 'REJECTED' }),
      row({ id: 'c', status: 'REJECTED' }),
    ];
    expect(groupRecces(recces)[0].recces.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('covers every RecceGroupKey in the order constant', () => {
    const all: RecceGroupKey[] = ['NEEDS_RECAPTURE', 'READY_TO_INSTALL', 'AWAITING_HO', 'AWAITING_ASM'];
    expect([...RECCE_GROUP_ORDER].sort()).toEqual([...all].sort());
  });
});

describe('findSiteRecce', () => {
  const recces = [
    row({ id: '1', status: 'APPROVED', site: { id: 'site-x', code: 'X', name: 'X', town: null } }),
    row({ id: '2', status: 'REJECTED', site: { id: 'site-y', code: 'Y', name: 'Y', town: null } }),
  ];

  it('finds the recce for a site by site id', () => {
    expect(findSiteRecce(recces, 'site-y')?.id).toBe('2');
  });

  it('returns undefined when the site has no recce', () => {
    expect(findSiteRecce(recces, 'site-z')).toBeUndefined();
  });

  it('returns undefined for an empty list', () => {
    expect(findSiteRecce([], 'site-x')).toBeUndefined();
  });
});

describe('rejectionLabel', () => {
  it('maps known codes to friendly labels', () => {
    expect(rejectionLabel('BLURRY')).toBe('Photo was blurry');
    expect(rejectionLabel('GEO_MISMATCH')).toBe('Location did not match the site');
    expect(rejectionLabel('OTHER')).toBe('Other');
  });

  it('returns null for a missing code', () => {
    expect(rejectionLabel(null)).toBeNull();
    expect(rejectionLabel(undefined)).toBeNull();
  });
});

describe('fetchMyRecces — query building', () => {
  beforeEach(() => get.mockClear());
  const urlOf = () => get.mock.calls[0][0] as string;

  it('requests the endpoint with only the default limit when no filters', () => {
    void fetchMyRecces();
    // limit is always set (200, matching the sites screen) so work in a beat isn't truncated at 50.
    expect(urlOf()).toBe('/api/recce?limit=200');
  });

  it('appends rsCode + beatName when set', () => {
    void fetchMyRecces({ rsCode: 'RS1', beatName: 'Beat A' });
    const url = urlOf();
    expect(url).toContain('rsCode=RS1');
    expect(url).toContain('beatName=Beat+A');
  });

  it('appends status when set', () => {
    void fetchMyRecces({ status: 'APPROVED' });
    expect(urlOf()).toContain('status=APPROVED');
  });
});

describe('submit body carries markup', () => {
  const markup: RecceMarkup = { version: 1, shapes: [{ type: 'rect', x: 0.2, y: 0.3, w: 0.4, h: 0.25 }] };

  function line(overrides: Partial<CapturedReccePosm> = {}): CapturedReccePosm {
    return {
      posmTypeId: 't1',
      dimensions: { width: 10, height: 20, unit: 'cm' },
      photo: { key: 'k1', geo: { lat: 18.5, lng: 73.8, accuracy: 8, capturedAt: '2026-01-01T00:00:00.000Z' } },
      markup, // marking is compulsory — every captured line carries a markup
      ...overrides,
    };
  }

  beforeEach(() => post.mockClear());

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bodyOf = (): any => post.mock.calls[0][1];

  it('includes markup on every posm (create)', () => {
    void submitRecce('site-1', [line()]);
    const body = bodyOf();
    expect(body.siteId).toBe('site-1');
    expect(body.posms[0].markup).toEqual(markup);
  });

  it("carries each line's own markup (resubmit)", () => {
    const other: RecceMarkup = { version: 1, shapes: [{ type: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] };
    void resubmitRecce('recce-9', [line({ markup }), line({ markup: other })]);
    const body = bodyOf();
    expect(body.posms[0].markup).toEqual(markup);
    expect(body.posms[1].markup).toEqual(other);
  });
});
