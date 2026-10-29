import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the network edge so we can assert the exact POST body the submit helpers build.
// `vi.hoisted` runs before the hoisted vi.mock factory, so `post` is initialised in time.
const { post, get } = vi.hoisted(() => ({
  post: vi.fn((_path: string, _body?: unknown) =>
    Promise.resolve({ success: true, data: { id: 'r1', status: 'SUBMITTED' } }),
  ),
  get: vi.fn((_url: string): Promise<unknown> => Promise.resolve({ success: true, data: { recces: [] } })),
}));
vi.mock('@/lib/api-client', () => ({ api: { post, get } }));

import {
  groupRecces,
  groupInstallableByOutlet,
  classifyRecce,
  findSiteRecce,
  rejectionLabel,
  submitRecce,
  resubmitRecce,
  submitManualRecce,
  fetchMyRecces,
  fetchAllMyRecces,
  fetchRejectedRecceForSite,
  RECCE_GROUP_ORDER,
  RECCE_PAGE_SIZE,
  type RecceGroupKey,
  type RecceListRow,
} from '@/lib/field/recce-api';
import type { CapturedReccePosm } from '@/components/field/capture/PosmCaptureCard';
import type { RecceMarkup } from '@/lib/markup';

/** Minimal recce-row factory for the grouping/lookup fixtures. */
function row(partial: Partial<RecceListRow> & Pick<RecceListRow, 'id' | 'status'>): RecceListRow {
  return {
    recceMode: 'APP',
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
    installStatus: null,
    ...partial,
  };
}

describe('classifyRecce', () => {
  it('REJECTED → NEEDS_RECAPTURE (ASM or HO sent it back, APP or MANUAL)', () => {
    expect(classifyRecce({ status: 'REJECTED', hoReviewStatus: 'NONE', recceMode: 'APP' })).toBe('NEEDS_RECAPTURE');
    expect(classifyRecce({ status: 'REJECTED', hoReviewStatus: 'REJECTED', recceMode: 'APP' })).toBe('NEEDS_RECAPTURE');
    // A MANUAL recce HO sent back must also land in re-capture so the exec can re-submit (D5).
    expect(classifyRecce({ status: 'REJECTED', hoReviewStatus: 'REJECTED', recceMode: 'MANUAL' })).toBe('NEEDS_RECAPTURE');
  });

  it('SUBMITTED APP → AWAITING_ASM', () => {
    expect(classifyRecce({ status: 'SUBMITTED', hoReviewStatus: 'NONE', recceMode: 'APP' })).toBe('AWAITING_ASM');
  });

  it('SUBMITTED MANUAL → AWAITING_HO (no ASM stage — straight to Head-Office, D4)', () => {
    // A manual recce lands as SUBMITTED + hoReviewStatus PENDING; it must NOT read as awaiting ASM.
    expect(classifyRecce({ status: 'SUBMITTED', hoReviewStatus: 'PENDING', recceMode: 'MANUAL' })).toBe('AWAITING_HO');
    expect(classifyRecce({ status: 'SUBMITTED', hoReviewStatus: 'NONE', recceMode: 'MANUAL' })).toBe('AWAITING_HO');
  });

  it('APPROVED is READY_TO_INSTALL only when HO has also approved (APP or MANUAL)', () => {
    expect(classifyRecce({ status: 'APPROVED', hoReviewStatus: 'APPROVED', recceMode: 'APP' })).toBe('READY_TO_INSTALL');
    expect(classifyRecce({ status: 'APPROVED', hoReviewStatus: 'APPROVED', recceMode: 'MANUAL' })).toBe('READY_TO_INSTALL');
  });

  it('APPROVED but HO not yet approved → AWAITING_HO (PENDING or NONE)', () => {
    expect(classifyRecce({ status: 'APPROVED', hoReviewStatus: 'PENDING', recceMode: 'APP' })).toBe('AWAITING_HO');
    expect(classifyRecce({ status: 'APPROVED', hoReviewStatus: 'NONE', recceMode: 'APP' })).toBe('AWAITING_HO');
  });

  it('APPROVED+HO but ALREADY submitted for installation → INSTALLED (not Ready to install)', () => {
    expect(classifyRecce({ status: 'APPROVED', hoReviewStatus: 'APPROVED', recceMode: 'APP', installStatus: 'SUBMITTED' })).toBe('INSTALLED');
    expect(classifyRecce({ status: 'APPROVED', hoReviewStatus: 'APPROVED', recceMode: 'MANUAL', installStatus: 'AUDIT_APPROVED' })).toBe('INSTALLED');
    // No installation yet → still ready to install.
    expect(classifyRecce({ status: 'APPROVED', hoReviewStatus: 'APPROVED', recceMode: 'APP', installStatus: null })).toBe('READY_TO_INSTALL');
  });
});

describe('groupRecces — drops recces already submitted for installation', () => {
  it('an installed recce never appears in any My Work group', () => {
    const groups = groupRecces([
      row({ id: '1', status: 'APPROVED', hoReviewStatus: 'APPROVED', installStatus: null }), // ready
      row({ id: '2', status: 'APPROVED', hoReviewStatus: 'APPROVED', installStatus: 'SUBMITTED' }), // done → dropped
    ]);
    const ids = groups.flatMap((g) => g.recces.map((r) => r.id));
    expect(ids).toEqual(['1']); // only the not-yet-installed recce remains
    expect(groups.some((g) => g.key === 'INSTALLED')).toBe(false); // no 'INSTALLED' section rendered
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
    expect(rejectionLabel('GEO_MISMATCH')).toBe('Location did not match the outlet');
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

  it('appends rsCode + each beat as a repeated beatNames param', () => {
    void fetchMyRecces({ rsCode: 'RS1', beatNames: ['Beat A', 'Beat B'] });
    const url = urlOf();
    expect(url).toContain('rsCode=RS1');
    expect(url).toContain('beatNames=Beat+A');
    expect(url).toContain('beatNames=Beat+B');
    expect(url).not.toContain('beatName=Beat');
  });

  it('appends status when set', () => {
    void fetchMyRecces({ status: 'APPROVED' });
    expect(urlOf()).toContain('status=APPROVED');
  });

  it('appends recceMode when set (manual recces fetched independent of RS/Beat)', () => {
    void fetchMyRecces({ recceMode: 'MANUAL' });
    expect(urlOf()).toContain('recceMode=MANUAL');
  });
});

describe('fetchAllMyRecces — drains every page before the global sort', () => {
  beforeEach(() => get.mockReset());

  const rows = (n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}` }));

  it('pages through until the server runs out, merging all rows', async () => {
    const total = RECCE_PAGE_SIZE + 3;
    get.mockImplementation((url: string) => {
      const page = Number(new URL(url, 'http://x').searchParams.get('page'));
      const recces = page === 1 ? rows(RECCE_PAGE_SIZE, 'p1') : rows(3, 'p2');
      return Promise.resolve({ success: true, data: { recces, total, page, limit: RECCE_PAGE_SIZE } });
    });
    const res = await fetchAllMyRecces({ rsCode: 'RS1' });
    expect(get).toHaveBeenCalledTimes(2);
    if (res.success) expect(res.data.recces).toHaveLength(total);
  });

  it('short-circuits to the error when a page fails', async () => {
    get.mockResolvedValue({ success: false, error: 'nope', status: 403 });
    const res = await fetchAllMyRecces({ recceMode: 'MANUAL' });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toBe('nope');
      expect(res.status).toBe(403);
    }
  });
});

describe('fetchRejectedRecceForSite — resolver URL', () => {
  beforeEach(() => get.mockClear());

  it('hits the for-site resolver with an encoded site id', () => {
    void fetchRejectedRecceForSite('site 9/x');
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe('/api/recce/for-site/site%209%2Fx');
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

  it('manual submit requires outletName and omits blank optional fields', () => {
    void submitManualRecce({ outletName: '  Shop A  ', posms: [line()] });
    const [path, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/api/recce/manual');
    expect(body.outletName).toBe('Shop A'); // trimmed
    expect('outletId' in body).toBe(false);
    expect('outletAddress' in body).toBe(false);
    expect('outletPhone' in body).toBe(false);
    expect((body.posms as unknown[]).length).toBe(1);
  });

  it('manual submit carries trimmed optional fields when present', () => {
    void submitManualRecce({
      outletId: ' OUT-1 ',
      outletName: 'Shop B',
      outletAddress: ' 12 Main St ',
      outletPhone: ' 999 ',
      posms: [line()],
    });
    const [, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.outletId).toBe('OUT-1');
    expect(body.outletAddress).toBe('12 Main St');
    expect(body.outletPhone).toBe('999');
  });
});

describe('groupInstallableByOutlet', () => {
  it('collapses recces to one entry per outlet, preserving first-seen order', () => {
    const recces = [
      row({ id: '1', status: 'APPROVED', site: { id: 'A', code: 'CA', name: 'A', town: null } }),
      row({ id: '2', status: 'APPROVED', site: { id: 'B', code: 'CB', name: 'B', town: null } }),
      row({ id: '3', status: 'APPROVED', site: { id: 'A', code: 'CA', name: 'A', town: null } }),
    ];
    const grouped = groupInstallableByOutlet(recces);
    expect(grouped.map((g) => g.site.id)).toEqual(['A', 'B']);
    expect(grouped[0].recces.map((r) => r.id)).toEqual(['1', '3']);
    expect(grouped[1].recces.map((r) => r.id)).toEqual(['2']);
  });

  it('returns [] for an empty list', () => {
    expect(groupInstallableByOutlet([])).toEqual([]);
  });
});
