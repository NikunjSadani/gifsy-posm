import {
  buildOutletExecutionRows,
  buildRecceRow,
  CURATED_COLUMNS,
  dimsLabel,
  readPhoto,
  fmtDateTime,
  recceStatusCell,
  rsLabel,
  sourceLabel,
  type Cell,
  type ReportColumn,
  type RepSite,
  type RepRecce,
} from './outlet-execution.helper';

// Durable rule: NEVER hardcode a fixed date in a test. All timestamps are derived from `now` so the
// suite is stable whatever day it runs (fmtDateTime just formats; no assertion pins a calendar date).
const now = new Date();
const daysAgo = (d: number): Date => new Date(now.getTime() - d * 86_400_000);

// ── The curated column contract ───────────────────────────────────────────────────────────────

describe('CURATED_COLUMNS (the authoritative column contract)', () => {
  it('lists the curated keys in order, with the right groups', () => {
    expect(CURATED_COLUMNS.map((c) => [c.key, c.group])).toEqual([
      ['outletCode', 'outlet'],
      ['outletName', 'outlet'],
      ['town', 'location'],
      ['state', 'location'],
      ['rs', 'location'],
      ['outletType', 'profile'],
      ['source', 'profile'],
      ['recceDate', 'profile'],
      ['promoter', 'profile'],
      ['el1Type', 'element1'],
      ['el1Dims', 'element1'],
      ['el1RecceStatus', 'element1'],
      ['el1Photo', 'element1'],
      ['el2Type', 'element2'],
      ['el2Dims', 'element2'],
      ['el2RecceStatus', 'element2'],
      ['el2Photo', 'element2'],
      ['recceStatus', 'overall'],
      ['capturedOn', 'audit'],
      ['asmApprovedBy', 'audit'],
      ['asmApprovedOn', 'audit'],
      ['hoApprovedBy', 'audit'],
      ['hoApprovedOn', 'audit'],
    ]);
  });

  it('pins ONLY the two outlet-identity columns', () => {
    expect(CURATED_COLUMNS.filter((c) => c.pinned).map((c) => c.key)).toEqual([
      'outletCode',
      'outletName',
    ]);
  });

  it('marks EVERY audit-group column (and only those) excelOnly', () => {
    const excelOnly = CURATED_COLUMNS.filter((c) => c.excelOnly);
    expect(excelOnly.map((c) => c.key)).toEqual([
      'capturedOn',
      'asmApprovedBy',
      'asmApprovedOn',
      'hoApprovedBy',
      'hoApprovedOn',
    ]);
    expect(excelOnly.every((c) => c.group === 'audit')).toBe(true);
    // No non-audit column is excel-only (the FE table renders everything else).
    expect(CURATED_COLUMNS.filter((c) => c.group !== 'audit').some((c) => c.excelOnly)).toBe(false);
  });

  it('labels the key-only columns the FE needs', () => {
    const byKey = Object.fromEntries(CURATED_COLUMNS.map((c) => [c.key, c.label] as const));
    expect(byKey.outletCode).toBe('Outlet Code');
    expect(byKey.rs).toBe('RS');
    expect(byKey.el1Dims).toBe('Element 1 W×H');
    expect(byKey.recceStatus).toBe('Recce Status');
    expect(byKey.asmApprovedBy).toBe('ASM Approved By');
    expect(byKey.hoApprovedOn).toBe('HO Approved On');
  });
});

// ── Pure formatters ─────────────────────────────────────────────────────────────────────────

describe('outlet-execution formatters', () => {
  it('dimsLabel renders "w × h unit", or "NA" when absent/malformed', () => {
    expect(dimsLabel({ width: 24, height: 12, unit: 'in' })).toBe('24 × 12 in');
    expect(dimsLabel({ width: 2.5, height: 1.5, unit: 'ft' })).toBe('2.5 × 1.5 ft');
    expect(dimsLabel({ width: 24, height: 12 })).toBe('24 × 12'); // no unit
    expect(dimsLabel({ width: 24 })).toBe('NA'); // missing height
    expect(dimsLabel({})).toBe('NA');
    expect(dimsLabel(null)).toBe('NA');
    expect(dimsLabel('garbage')).toBe('NA');
  });

  it('readPhoto pulls key + geotag defensively', () => {
    expect(readPhoto({ key: 'k', geo: { lat: 1.5, lng: 2.5 } })).toEqual({ key: 'k', lat: 1.5, lng: 2.5 });
    expect(readPhoto({ key: 'k' })).toEqual({ key: 'k' });
    expect(readPhoto('legacy-key')).toEqual({ key: 'legacy-key' });
    expect(readPhoto(null)).toEqual({ key: '' });
    expect(readPhoto({ key: 'k', geo: { lat: 'x', lng: 2 } })).toEqual({ key: 'k', lng: 2 });
  });

  it('fmtDateTime formats IST or "" for absent/invalid', () => {
    expect(fmtDateTime(null)).toBe('');
    expect(fmtDateTime('not-a-date')).toBe('');
    expect(fmtDateTime(new Date('2026-08-28T02:30:00Z'))).toBe('28-08-2026 08:00'); // +5:30 IST
  });

  it('rsLabel prefers code and appends name', () => {
    expect(rsLabel('WB2.09', 'Das')).toBe('WB2.09 — Das');
    expect(rsLabel('WB2.09', null)).toBe('WB2.09');
    expect(rsLabel(null, 'Das')).toBe('Das');
    expect(rsLabel(null, null)).toBe('');
  });

  it('sourceLabel maps the recce entry path', () => {
    expect(sourceLabel(null)).toBe('');
    expect(sourceLabel({ recceMode: 'APP' } as any)).toBe('App');
    expect(sourceLabel({ recceMode: 'MANUAL' } as any)).toBe('Manual');
  });
});

// ── Recce-status tone mapping ─────────────────────────────────────────────────────────────────

describe('recceStatusCell — overall lifecycle chip + tone', () => {
  const c = (over: Partial<RepRecce>): Cell => recceStatusCell({ status: 'SUBMITTED', hoReviewStatus: 'NONE', ...over } as RepRecce);

  it('neutral "Not started" when the outlet has no recce', () => {
    expect(recceStatusCell(null)).toEqual({ t: 'status', v: 'Not started', tone: 'neutral' });
  });
  it('Submitted → pending', () => {
    expect(c({ status: 'SUBMITTED', hoReviewStatus: 'NONE' })).toEqual({ t: 'status', v: 'Submitted', tone: 'pending' });
  });
  it('ASM approved (APPROVED, HO still pending) → "ASM approved" / pending', () => {
    expect(c({ status: 'APPROVED', hoReviewStatus: 'PENDING' })).toEqual({ t: 'status', v: 'ASM approved', tone: 'pending' });
  });
  it('HO approved → "HO approved" / approved (terminal good)', () => {
    expect(c({ status: 'APPROVED', hoReviewStatus: 'APPROVED' })).toEqual({ t: 'status', v: 'HO approved', tone: 'approved' });
  });
  it('Rejected → rejected (even if an HO reject also set status)', () => {
    expect(c({ status: 'REJECTED', hoReviewStatus: 'REJECTED' })).toEqual({ t: 'status', v: 'Rejected', tone: 'rejected' });
  });
});

// ── Row builder fixtures ──────────────────────────────────────────────────────────────────────

const appRecce = (): RepRecce => ({
  id: 'recA',
  recceMode: 'APP',
  status: 'APPROVED',
  hoReviewStatus: 'APPROVED',
  capturedAt: daysAgo(2),
  receivedAt: daysAgo(2),
  reviewedAt: daysAgo(1),
  hoReviewedAt: daysAgo(1),
  submittedBy: { promoterCode: 'P100' },
  approvedBy: { name: 'Asha ASM' },
  hoReviewedBy: { name: 'Hari HO' },
  posms: [
    { id: 'rp1', slotNo: 1, posmType: { name: 'Standard Board' }, dimensions: { width: 24, height: 12, unit: 'in' }, photo: { key: 'r1', geo: { lat: 19.2401, lng: 73.1301 } } },
    { id: 'rp2', slotNo: 2, posmType: { name: 'Danglers' }, dimensions: {}, photo: { key: 'r2' } },
  ],
});

const fullSite = (): RepSite => ({
  id: 'siteA',
  code: 'A8',
  name: 'Kalyan Mega Mart',
  town: 'Kalyan',
  state: 'MH',
  rsCode: 'WB2.09',
  rsName: 'Das',
  channel: 'GT',
  recces: [appRecce()],
});

describe('buildOutletExecutionRows — app-only outlet (one recce → one row)', () => {
  it('yields exactly one row, id = recce id, with every curated cell key', () => {
    const rows = buildOutletExecutionRows(fullSite());
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('recA');
    expect(rows[0].outletCode).toBe('A8');
    expect(rows[0].outletName).toBe('Kalyan Mega Mart');
    expect(Object.keys(rows[0].cells).sort()).toEqual(CURATED_COLUMNS.map((c) => c.key).sort());
  });

  it('maps the outlet / location / profile cells', () => {
    const { cells } = buildOutletExecutionRows(fullSite())[0];
    expect(cells.outletCode).toEqual({ t: 'text', v: 'A8' });
    expect(cells.town).toEqual({ t: 'text', v: 'Kalyan' });
    expect(cells.state).toEqual({ t: 'text', v: 'MH' });
    expect(cells.rs).toEqual({ t: 'text', v: 'WB2.09 — Das' });
    expect(cells.outletType).toEqual({ t: 'text', v: 'GT' });
    expect(cells.source).toEqual({ t: 'text', v: 'App' });
    expect(cells.promoter).toEqual({ t: 'text', v: 'P100' });
    expect(cells.recceDate).toEqual({ t: 'text', v: fmtDateTime(daysAgo(2)) });
  });

  it('element 1: type + dims "w × h unit" + status chip + a photo cell carrying key/viewPath/geotag', () => {
    const { cells } = buildOutletExecutionRows(fullSite())[0];
    expect(cells.el1Type).toEqual({ t: 'text', v: 'Standard Board' });
    expect(cells.el1Dims).toEqual({ t: 'text', v: '24 × 12 in' });
    expect(cells.el1RecceStatus).toEqual({ t: 'status', v: 'Approved', tone: 'approved' });
    expect(cells.el1Photo).toEqual({
      t: 'photo',
      key: 'r1',
      viewPath: '/v1/media/view?key=r1',
      lat: 19.2401,
      lng: 73.1301,
    });
  });

  it('element 2: present but dims absent → "NA"; photo without geo → no lat/lng', () => {
    const { cells } = buildOutletExecutionRows(fullSite())[0];
    expect(cells.el2Type).toEqual({ t: 'text', v: 'Danglers' });
    expect(cells.el2Dims).toEqual({ t: 'text', v: 'NA' });
    expect(cells.el2Photo).toEqual({ t: 'photo', key: 'r2', viewPath: '/v1/media/view?key=r2' });
  });

  it('overall + excel-only audit trail cells (ASM + HO approved)', () => {
    const { cells } = buildOutletExecutionRows(fullSite())[0];
    expect(cells.recceStatus).toEqual({ t: 'status', v: 'HO approved', tone: 'approved' });
    expect(cells.capturedOn).toEqual({ t: 'text', v: fmtDateTime(daysAgo(2)) });
    expect(cells.asmApprovedBy).toEqual({ t: 'text', v: 'Asha ASM' });
    expect(cells.asmApprovedOn).toEqual({ t: 'text', v: fmtDateTime(daysAgo(1)) });
    expect(cells.hoApprovedBy).toEqual({ t: 'text', v: 'Hari HO' });
    expect(cells.hoApprovedOn).toEqual({ t: 'text', v: fmtDateTime(daysAgo(1)) });
  });
});

describe('buildRecceRow — edge cases', () => {
  it('a one-element recce yields EMPTY element-2 cells', () => {
    const site = fullSite();
    site.recces[0] = { ...appRecce(), posms: [appRecce().posms[0]] }; // drop slot 2
    const { cells } = buildRecceRow(site, site.recces[0]);
    for (const k of ['el2Type', 'el2Dims', 'el2RecceStatus', 'el2Photo']) {
      expect(cells[k]).toEqual({ t: 'empty' });
    }
    // Element 1 is still fully populated.
    expect(cells.el1Type).toEqual({ t: 'text', v: 'Standard Board' });
  });

  it('a no-recce outlet → id site-<id>, neutral "Not started", recce-derived cells empty', () => {
    const bare: RepSite = {
      id: 'siteZ', code: 'Z1', name: 'New Outlet',
      town: 'Pune', state: null, rsCode: null, rsName: null, channel: null, recces: [],
    };
    const rows = buildOutletExecutionRows(bare);
    expect(rows).toHaveLength(1);
    const { id, cells } = rows[0];
    expect(id).toBe('site-siteZ');
    expect(cells.recceStatus).toEqual({ t: 'status', v: 'Not started', tone: 'neutral' });
    expect(cells.town).toEqual({ t: 'text', v: 'Pune' });
    for (const k of ['source', 'recceDate', 'promoter', 'capturedOn', 'asmApprovedBy', 'asmApprovedOn', 'hoApprovedBy', 'hoApprovedOn', 'el1Type', 'el1Photo', 'el2Type']) {
      expect(cells[k]).toEqual({ t: 'empty' });
    }
  });

  it('a REJECTED recce: element chip rejected; NO audit approver stamps', () => {
    const site = fullSite();
    site.recces[0] = {
      ...appRecce(),
      status: 'REJECTED',
      hoReviewStatus: 'NONE',
      approvedBy: null, // ASM reject never sets the approver
      hoReviewedBy: null,
    };
    const { cells } = buildRecceRow(site, site.recces[0]);
    expect(cells.recceStatus).toEqual({ t: 'status', v: 'Rejected', tone: 'rejected' });
    expect(cells.el1RecceStatus).toEqual({ t: 'status', v: 'Rejected', tone: 'rejected' });
    expect(cells.asmApprovedBy).toEqual({ t: 'empty' });
    expect(cells.asmApprovedOn).toEqual({ t: 'empty' });
    expect(cells.hoApprovedBy).toEqual({ t: 'empty' });
  });

  it('a MANUAL recce HO-approved: ASM audit blank, HO audit filled, element chip approved', () => {
    const manual: RepRecce = {
      id: 'recM', recceMode: 'MANUAL', status: 'APPROVED', hoReviewStatus: 'APPROVED',
      capturedAt: daysAgo(3), receivedAt: daysAgo(3), reviewedAt: null, hoReviewedAt: daysAgo(2),
      submittedBy: { promoterCode: 'PM1' }, approvedBy: null, hoReviewedBy: { name: 'Hari HO' },
      posms: [{ id: 'm1', slotNo: 1, posmType: { name: 'Shelf Strip' }, dimensions: { width: 6, height: 2, unit: 'in' }, photo: { key: 'mk1' } }],
    };
    const site: RepSite = { ...fullSite(), recces: [manual] };
    const { cells } = buildRecceRow(site, manual);
    expect(cells.source).toEqual({ t: 'text', v: 'Manual' });
    expect(cells.recceStatus).toEqual({ t: 'status', v: 'HO approved', tone: 'approved' });
    expect(cells.el1RecceStatus).toEqual({ t: 'status', v: 'Approved', tone: 'approved' });
    expect(cells.asmApprovedBy).toEqual({ t: 'empty' }); // no ASM stage
    expect(cells.asmApprovedOn).toEqual({ t: 'empty' });
    expect(cells.hoApprovedBy).toEqual({ t: 'text', v: 'Hari HO' });
    expect(cells.hoApprovedOn).toEqual({ t: 'text', v: fmtDateTime(daysAgo(2)) });
  });
});

describe('buildOutletExecutionRows — mixed outlet (1 app + 2 manual → 3 rows, ordered)', () => {
  const manualRecce = (id: string, receivedAt: Date, posmName: string, promoter: string): RepRecce => ({
    id, recceMode: 'MANUAL', status: 'APPROVED', hoReviewStatus: 'APPROVED',
    capturedAt: receivedAt, receivedAt, reviewedAt: null, hoReviewedAt: receivedAt,
    submittedBy: { promoterCode: promoter }, approvedBy: null, hoReviewedBy: { name: 'Hari HO' },
    posms: [{ id: `${id}-p1`, slotNo: 1, posmType: { name: posmName }, dimensions: { width: 3, height: 3, unit: 'ft' }, photo: { key: `${id}k` } }],
  });

  // Deliberately out of order (manual-newer, app, manual-older) to prove the sort.
  const mixedSite = (): RepSite => ({
    ...fullSite(),
    code: 'M9', name: 'Multi Outlet',
    recces: [
      manualRecce('recMnew', daysAgo(1), 'Wobbler', 'PM2'),
      appRecce(),
      manualRecce('recMold', daysAgo(5), 'Shelf Strip', 'PM1'),
    ],
  });

  it('yields 3 rows ordered APP first then MANUAL oldest-first, each its own element + promoter', () => {
    const rows = buildOutletExecutionRows(mixedSite());
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.id)).toEqual(['recA', 'recMold', 'recMnew']);
    expect(rows.map((r) => (r.cells.source as any).v)).toEqual(['App', 'Manual', 'Manual']);
    expect(rows.map((r) => (r.cells.el1Type as any).v)).toEqual(['Standard Board', 'Shelf Strip', 'Wobbler']);
    expect(rows.map((r) => (r.cells.promoter as any).v)).toEqual(['P100', 'PM1', 'PM2']);
    // Outlet identity repeats on every row.
    for (const r of rows) {
      expect(r.outletCode).toBe('M9');
      expect(r.cells.outletName).toEqual({ t: 'text', v: 'Multi Outlet' });
    }
  });
});
