import {
  buildOutletExecutionRows,
  buildRecceRow,
  CURATED_COLUMNS,
  INSTALL_COLUMNS,
  INSTALL_AUDIT_COLUMNS,
  columnsForMode,
  dimsLabel,
  readPhoto,
  fmtDateTime,
  recceStatusCell,
  outletStatusCell,
  activityStatusCell,
  elementInstallStatusCell,
  installAuditStatusCell,
  installHoStatusCell,
  reviewerLabel,
  beforeAfterGeoLabel,
  rsLabel,
  sourceLabel,
  isPlausibleOrigin,
  mediaHyperlinkTarget,
  type Cell,
  type ReportColumn,
  type RepSite,
  type RepRecce,
  type RepInstallation,
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
      ['outletStatus', 'location'],
      ['town', 'location'],
      ['state', 'location'],
      ['rs', 'location'],
      ['vendor', 'location'],
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
      ['activityStatus', 'overall'],
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
    expect(byKey.outletStatus).toBe('Outlet Status');
    expect(byKey.activityStatus).toBe('Activity Status');
    expect(byKey.asmApprovedBy).toBe('ASM Approved By');
    expect(byKey.hoApprovedOn).toBe('HO Approved On');
  });

  it('places outletStatus first in the location group (near the pinned identity) and activityStatus in overall', () => {
    const loc = CURATED_COLUMNS.filter((c) => c.group === 'location').map((c) => c.key);
    expect(loc[0]).toBe('outletStatus'); // immediately after the pinned outlet identity
    // Neither new column un-pins the identity (they are NOT in the `outlet` group) nor is excel-only.
    expect(CURATED_COLUMNS.find((c) => c.key === 'outletStatus')).toMatchObject({ group: 'location' });
    expect(CURATED_COLUMNS.find((c) => c.key === 'outletStatus')?.excelOnly).toBeFalsy();
    expect(CURATED_COLUMNS.find((c) => c.key === 'activityStatus')).toMatchObject({ group: 'overall' });
    expect(CURATED_COLUMNS.find((c) => c.key === 'activityStatus')?.excelOnly).toBeFalsy();
    // The outlet (pinned) group is still exactly the two identity columns.
    expect(CURATED_COLUMNS.filter((c) => c.group === 'outlet').map((c) => c.key)).toEqual(['outletCode', 'outletName']);
  });
});

// ── Outlet Status tone mapping ──────────────────────────────────────────────────────────────────

describe('outletStatusCell — Site.status → chip + tone', () => {
  it('ACTIVE → green "Active"', () => {
    expect(outletStatusCell('ACTIVE')).toEqual({ t: 'status', v: 'Active', tone: 'approved' });
  });
  it('INACTIVE → neutral "Inactive"', () => {
    expect(outletStatusCell('INACTIVE')).toEqual({ t: 'status', v: 'Inactive', tone: 'neutral' });
  });
  it('SUSPENDED (future value) → red "Suspended"', () => {
    expect(outletStatusCell('SUSPENDED')).toEqual({ t: 'status', v: 'Suspended', tone: 'rejected' });
  });
  it('absent / unknown → neutral (never a crash)', () => {
    expect(outletStatusCell(null)).toEqual({ t: 'status', v: 'Unknown', tone: 'neutral' });
    expect(outletStatusCell(undefined)).toEqual({ t: 'status', v: 'Unknown', tone: 'neutral' });
    expect(outletStatusCell('')).toEqual({ t: 'status', v: 'Unknown', tone: 'neutral' });
    // A future enum value still surfaces (defensive) rather than being lost.
    expect(outletStatusCell('ARCHIVED')).toEqual({ t: 'status', v: 'ARCHIVED', tone: 'neutral' });
  });
});

// ── Activity Status rollup (the loosely-specified "furthest stage reached" interpretation) ──────

describe('activityStatusCell — execution-pipeline rollup across the whole ladder', () => {
  const base = (over: Partial<RepRecce>): RepRecce =>
    ({ status: 'SUBMITTED', hoReviewStatus: 'NONE', installation: null, ...over } as RepRecce);

  it('no recce → neutral "Not started"', () => {
    expect(activityStatusCell(null)).toEqual({ t: 'status', v: 'Not started', tone: 'neutral' });
  });
  it('recce submitted (no further) → "Recce submitted"', () => {
    expect(activityStatusCell(base({ status: 'SUBMITTED', hoReviewStatus: 'NONE' }))).toEqual({ t: 'status', v: 'Recce submitted', tone: 'pending' });
  });
  it('ASM approved, HO pending → "ASM approved"', () => {
    expect(activityStatusCell(base({ status: 'APPROVED', hoReviewStatus: 'PENDING' }))).toEqual({ t: 'status', v: 'ASM approved', tone: 'pending' });
  });
  it('HO approved (installable, not yet installed) → "HO approved"', () => {
    expect(activityStatusCell(base({ status: 'APPROVED', hoReviewStatus: 'APPROVED' }))).toEqual({ t: 'status', v: 'HO approved', tone: 'approved' });
  });
  it('rejected recce (no install) → red "Recce rejected"', () => {
    expect(activityStatusCell(base({ status: 'REJECTED', hoReviewStatus: 'NONE' }))).toEqual({ t: 'status', v: 'Recce rejected', tone: 'rejected' });
  });
  it('installed but not yet audit-approved → "Installed"', () => {
    expect(activityStatusCell(base({ status: 'APPROVED', hoReviewStatus: 'APPROVED', installation: { status: 'SUBMITTED' } as RepInstallation }))).toEqual({ t: 'status', v: 'Installed', tone: 'pending' });
    // An audit-rejected-pending-HO install is still "Installed" (the pipeline reached installation).
    expect(activityStatusCell(base({ installation: { status: 'AUDIT_REJECTED', hoReviewStatus: 'PENDING' } as RepInstallation }))).toEqual({ t: 'status', v: 'Installed', tone: 'pending' });
  });
  it('install auditor-rejected AND HO upheld (terminal fail) → red "Install rejected" (not "Installed")', () => {
    // The recce report is the ONLY place this install appears with no auditStatus/HO column beside it,
    // so a dead install must not read the same amber "Installed" as one still awaiting audit.
    expect(activityStatusCell(base({ installation: { status: 'AUDIT_REJECTED', hoReviewStatus: 'REJECTED' } as RepInstallation }))).toEqual({ t: 'status', v: 'Install rejected', tone: 'rejected' });
  });
  it('audited (install AUDIT_APPROVED) → green "Audited" — the furthest stage', () => {
    expect(activityStatusCell(base({ installation: { status: 'AUDIT_APPROVED' } as RepInstallation }))).toEqual({ t: 'status', v: 'Audited', tone: 'approved' });
    // An auditor-rejected install that HO overruled to APPROVED also reads "Audited".
    expect(activityStatusCell(base({ installation: { status: 'AUDIT_REJECTED', hoReviewStatus: 'APPROVED' } as RepInstallation }))).toEqual({ t: 'status', v: 'Audited', tone: 'approved' });
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

// ── Element-status tone (same status+hoReviewStatus nuance as the overall chip) ─────────────────
// elementStatusCell isn't exported; drive it through buildRecceRow's el1RecceStatus cell. Recce
// approval is per-recce, so el1 == el2 on the recce report (they diverge on the future installed one).
describe('element status chip — tone + label mirror the overall recce lifecycle', () => {
  const el1 = (over: Partial<RepRecce>): Cell =>
    buildRecceRow(fullSite(), { ...appRecce(), ...over }).cells.el1RecceStatus;

  it('APPROVED + HO APPROVED → green "Approved" (terminal good)', () => {
    expect(el1({ status: 'APPROVED', hoReviewStatus: 'APPROVED' })).toEqual({ t: 'status', v: 'Approved', tone: 'approved' });
  });

  it('APPROVED + HO PENDING → amber "ASM approved" (NOT a premature green), matching the overall chip', () => {
    // The audit bug: this used to show green "Approved" while recceStatus correctly said "ASM approved".
    expect(el1({ status: 'APPROVED', hoReviewStatus: 'PENDING' })).toEqual({ t: 'status', v: 'ASM approved', tone: 'pending' });
    expect(recceStatusCell({ ...appRecce(), status: 'APPROVED', hoReviewStatus: 'PENDING' })).toEqual({ t: 'status', v: 'ASM approved', tone: 'pending' });
  });

  it('SUBMITTED → amber "Submitted"', () => {
    expect(el1({ status: 'SUBMITTED', hoReviewStatus: 'NONE' })).toEqual({ t: 'status', v: 'Submitted', tone: 'pending' });
  });

  it('REJECTED → red "Rejected"', () => {
    expect(el1({ status: 'REJECTED', hoReviewStatus: 'NONE' })).toEqual({ t: 'status', v: 'Rejected', tone: 'rejected' });
  });

  it('an empty slot stays empty regardless of status', () => {
    const site = fullSite();
    site.recces[0] = { ...appRecce(), posms: [appRecce().posms[0]] }; // only slot 1
    expect(buildRecceRow(site, site.recces[0]).cells.el2RecceStatus).toEqual({ t: 'empty' });
  });
});

// ── Vendor column ───────────────────────────────────────────────────────────────────────────
describe('vendor cell', () => {
  it('renders the servicing vendor name', () => {
    expect(buildRecceRow(fullSite(), appRecce()).cells.vendor).toEqual({ t: 'text', v: 'Prime Fleet' });
  });
  it('falls back to blank text when the outlet has no vendor (filterable field never invisible)', () => {
    const noVendor: RepSite = { ...fullSite(), vendor: null };
    expect(buildRecceRow(noVendor, appRecce()).cells.vendor).toEqual({ t: 'text', v: '' });
    const omitted: RepSite = { ...fullSite() };
    delete (omitted as { vendor?: unknown }).vendor;
    expect(buildRecceRow(omitted, appRecce()).cells.vendor).toEqual({ t: 'text', v: '' });
  });
});

// ── xlsx photo hyperlink target (absolute app-origin URL + validation + fallback) ───────────────
describe('isPlausibleOrigin', () => {
  it('accepts a bare http(s)://host[:port]', () => {
    expect(isPlausibleOrigin('https://app.kwality.in')).toBe(true);
    expect(isPlausibleOrigin('http://localhost:3000')).toBe(true);
    expect(isPlausibleOrigin(' https://app.kwality.in ')).toBe(true); // trimmed
  });
  it('rejects anything that is not a bare origin', () => {
    expect(isPlausibleOrigin('')).toBe(false);
    expect(isPlausibleOrigin(undefined)).toBe(false);
    expect(isPlausibleOrigin(null)).toBe(false);
    expect(isPlausibleOrigin(42)).toBe(false);
    expect(isPlausibleOrigin('ftp://app.kwality.in')).toBe(false); // wrong scheme
    expect(isPlausibleOrigin('app.kwality.in')).toBe(false); // no scheme
    expect(isPlausibleOrigin('https://app.kwality.in/reports')).toBe(false); // has a path
    expect(isPlausibleOrigin('https://app.kwality.in?x=1')).toBe(false); // has a query
    expect(isPlausibleOrigin('javascript:alert(1)')).toBe(false);
  });
});

describe('mediaHyperlinkTarget', () => {
  it('makes the link ABSOLUTE on the app origin + /api surface, remapping /v1 → /api', () => {
    expect(mediaHyperlinkTarget('/v1/media/view?key=r1', 'https://app.kwality.in')).toBe(
      'https://app.kwality.in/api/media/view?key=r1',
    );
    // A trailing slash on the origin is normalised (no double slash).
    expect(mediaHyperlinkTarget('/v1/media/view?key=r1', 'https://app.kwality.in/')).toBe(
      'https://app.kwality.in/api/media/view?key=r1',
    );
    // An already-/api path and a bare path both land on <origin>/api/…
    expect(mediaHyperlinkTarget('/api/media/view?key=r1', 'http://localhost:3000')).toBe(
      'http://localhost:3000/api/media/view?key=r1',
    );
  });
  it('DEGRADES to the relative view-path when the origin is absent or invalid (never crashes)', () => {
    expect(mediaHyperlinkTarget('/v1/media/view?key=r1', undefined)).toBe('/v1/media/view?key=r1');
    expect(mediaHyperlinkTarget('/v1/media/view?key=r1', '')).toBe('/v1/media/view?key=r1');
    expect(mediaHyperlinkTarget('/v1/media/view?key=r1', 'not-an-origin')).toBe('/v1/media/view?key=r1');
    expect(mediaHyperlinkTarget('/v1/media/view?key=r1', 'https://evil.test/path')).toBe('/v1/media/view?key=r1');
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
  status: 'ACTIVE',
  vendor: { name: 'Prime Fleet' },
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
    expect(cells.outletStatus).toEqual({ t: 'status', v: 'Active', tone: 'approved' });
    expect(cells.town).toEqual({ t: 'text', v: 'Kalyan' });
    expect(cells.state).toEqual({ t: 'text', v: 'MH' });
    expect(cells.rs).toEqual({ t: 'text', v: 'WB2.09 — Das' });
    expect(cells.vendor).toEqual({ t: 'text', v: 'Prime Fleet' });
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

  it('a recce photo carries its markup (element-placement box); an un-annotated one has no markup key', () => {
    const site = fullSite();
    const markup = { version: 1, shapes: [{ type: 'rect', x: 0.1, y: 0.2, w: 0.3, h: 0.25 }] };
    site.recces[0] = {
      ...appRecce(),
      posms: [
        { ...appRecce().posms[0], markup }, // slot 1 annotated
        appRecce().posms[1], // slot 2 un-annotated (no markup field)
      ],
    };
    const { cells } = buildRecceRow(site, site.recces[0]);
    expect(cells.el1Photo).toEqual({ t: 'photo', key: 'r1', viewPath: '/v1/media/view?key=r1', lat: 19.2401, lng: 73.1301, markup });
    // The un-annotated slot carries NO markup key (byte-identical to pre-change → FE draws no box).
    expect(cells.el2Photo).toEqual({ t: 'photo', key: 'r2', viewPath: '/v1/media/view?key=r2' });
    expect('markup' in (cells.el2Photo as Record<string, unknown>)).toBe(false);
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
    // HO-approved recce, not yet installed (recce mode, no installation loaded) → Activity "HO approved".
    expect(cells.activityStatus).toEqual({ t: 'status', v: 'HO approved', tone: 'approved' });
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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// INSTALLED VARIANT (Phase C) — columns, cells, filter, and recce-mode non-regression
// ══════════════════════════════════════════════════════════════════════════════════════════════

const sampleInstallation = (over: Partial<RepInstallation> = {}): RepInstallation => ({
  status: 'AUDIT_APPROVED',
  capturedAt: daysAgo(1),
  receivedAt: daysAgo(1),
  submittedBy: { promoterCode: 'INST9' },
  auditedBy: { name: 'Auditor A' },
  auditedAt: now,
  ...over,
});

/** An app recce whose slot-1 element IS installed (with geo+distance) and slot-2 element is NOT. */
const installedRecce = (over: Partial<RepRecce> = {}): RepRecce => ({
  ...appRecce(),
  installation: sampleInstallation(),
  posms: [
    {
      id: 'rp1', slotNo: 1, posmType: { name: 'Standard Board' }, dimensions: { width: 24, height: 12, unit: 'in' },
      photo: { key: 'r1', geo: { lat: 19.2401, lng: 73.1301 } },
      installPosm: { photo: { key: 'i1', geo: { lat: 19.2402, lng: 73.1302 } }, geoFenceOk: true, distanceFromRecce: 3.2 },
    },
    {
      id: 'rp2', slotNo: 2, posmType: { name: 'Danglers' }, dimensions: {},
      photo: { key: 'r2' }, installPosm: null, // element present in recce, not installed yet
    },
  ],
  ...over,
});

const installedSite = (over: Partial<RepSite> = {}): RepSite => ({ ...fullSite(), recces: [installedRecce()], ...over });

describe('columnsForMode — the installed column contract', () => {
  it('recce mode returns exactly CURATED_COLUMNS (unchanged)', () => {
    expect(columnsForMode('recce')).toBe(CURATED_COLUMNS);
  });

  it('installed mode inserts the install group BEFORE overall and appends install audit after the recce audit', () => {
    const cols = columnsForMode('installed');
    const keys = cols.map((c) => c.key);
    // The install group sits directly before `recceStatus` (the overall column), in its declared order.
    const installKeys = INSTALL_COLUMNS.map((c) => c.key);
    const recceIdx = keys.indexOf('recceStatus');
    expect(keys.slice(recceIdx - installKeys.length, recceIdx)).toEqual(installKeys);
    // The install audit columns are the final four, excel-only, in the audit group (the auditor pair
    // THEN the independent HO-override reviewer pair).
    expect(keys.slice(-4)).toEqual([
      'installAuditedBy',
      'installAuditedOn',
      'installHoReviewedBy',
      'installHoReviewedOn',
    ]);
    expect(cols.slice(-4).every((c) => c.group === 'audit' && c.excelOnly === true)).toBe(true);
    // The install HO-override chip sits in the `install` group next to auditStatus, NOT excel-only.
    expect(cols.find((c) => c.key === 'installHoStatus')).toMatchObject({ group: 'install', label: 'Install HO Review' });
    expect(cols.find((c) => c.key === 'installHoStatus')?.excelOnly).toBeFalsy();
    // auditStatus is immediately followed by installHoStatus (the two independent axes, side by side).
    expect(keys[keys.indexOf('auditStatus') + 1]).toBe('installHoStatus');
    // Every install-group column is in the `install` group and NOT excel-only (the FE table renders them).
    expect(INSTALL_COLUMNS.every((c) => c.group === 'install' && !c.excelOnly)).toBe(true);
    // All recce columns are still present (superset).
    for (const c of CURATED_COLUMNS) expect(keys).toContain(c.key);
  });

  it('every row in installed mode carries a cell for every installed column', () => {
    const [row] = buildOutletExecutionRows(installedSite(), 'installed');
    expect(Object.keys(row.cells).sort()).toEqual(columnsForMode('installed').map((c) => c.key).sort());
  });
});

describe('installed-mode cell helpers', () => {
  it('elementInstallStatusCell: Installed(green) / Not installed(amber) / empty', () => {
    expect(elementInstallStatusCell(true, true)).toEqual({ t: 'status', v: 'Installed', tone: 'approved' });
    expect(elementInstallStatusCell(true, false)).toEqual({ t: 'status', v: 'Not installed', tone: 'pending' });
    expect(elementInstallStatusCell(false, false)).toEqual({ t: 'empty' });
  });

  it('installAuditStatusCell maps the installation status to a chip, empty when no installation', () => {
    expect(installAuditStatusCell(null)).toEqual({ t: 'empty' });
    expect(installAuditStatusCell({ status: 'SUBMITTED' } as RepInstallation)).toEqual({ t: 'status', v: 'Submitted', tone: 'pending' });
    expect(installAuditStatusCell({ status: 'AUDIT_APPROVED' } as RepInstallation)).toEqual({ t: 'status', v: 'Audited', tone: 'approved' });
    expect(installAuditStatusCell({ status: 'AUDIT_REJECTED' } as RepInstallation)).toEqual({ t: 'status', v: 'Audit rejected', tone: 'rejected' });
  });

  it('beforeAfterGeoLabel joins distance + geo-fence verdict (null verdict omitted)', () => {
    expect(beforeAfterGeoLabel(null)).toBe('');
    expect(beforeAfterGeoLabel({ photo: {}, distanceFromRecce: 3.2, geoFenceOk: true })).toBe('3.2 m · Geo-fence pass');
    expect(beforeAfterGeoLabel({ photo: {}, distanceFromRecce: 12, geoFenceOk: false })).toBe('12.0 m · Geo-fence fail');
    expect(beforeAfterGeoLabel({ photo: {}, geoFenceOk: null })).toBe(''); // unverifiable → nothing
    expect(beforeAfterGeoLabel({ photo: {}, distanceFromRecce: 5 })).toBe('5.0 m'); // distance only, rounded
    // A raw float is rounded to 1 dp (not emitted verbatim).
    expect(beforeAfterGeoLabel({ photo: {}, distanceFromRecce: 3.19999, geoFenceOk: true })).toBe('3.2 m · Geo-fence pass');
  });

  it('installHoStatusCell maps the HO-override outcome independently, empty when no installation', () => {
    expect(installHoStatusCell(null)).toEqual({ t: 'empty' });
    expect(installHoStatusCell({ status: 'AUDIT_REJECTED', hoReviewStatus: 'APPROVED' } as RepInstallation)).toEqual({ t: 'status', v: 'HO approved', tone: 'approved' });
    expect(installHoStatusCell({ status: 'AUDIT_REJECTED', hoReviewStatus: 'PENDING' } as RepInstallation)).toEqual({ t: 'status', v: 'HO review pending', tone: 'pending' });
    expect(installHoStatusCell({ status: 'AUDIT_REJECTED', hoReviewStatus: 'REJECTED' } as RepInstallation)).toEqual({ t: 'status', v: 'HO rejected', tone: 'rejected' });
    // NONE / undefined — never escalated to HO → neutral.
    expect(installHoStatusCell({ status: 'AUDIT_APPROVED', hoReviewStatus: 'NONE' } as RepInstallation)).toEqual({ t: 'status', v: 'Not escalated', tone: 'neutral' });
    expect(installHoStatusCell({ status: 'AUDIT_APPROVED' } as RepInstallation)).toEqual({ t: 'status', v: 'Not escalated', tone: 'neutral' });
  });

  it('reviewerLabel prefers name, falls back to promoterCode, else blank', () => {
    expect(reviewerLabel({ name: 'Hari HO' })).toBe('Hari HO');
    expect(reviewerLabel({ name: null, promoterCode: 'HO9' })).toBe('HO9');
    expect(reviewerLabel({ name: '  ', promoterCode: 'HO9' })).toBe('HO9');
    expect(reviewerLabel(null)).toBe('');
    expect(reviewerLabel({})).toBe('');
  });
});

describe('buildRecceRow — installed cells', () => {
  it('slot 1 installed → "Installed" chip + an install photo cell; slot 2 not installed → amber + empty photo', () => {
    const { cells } = buildRecceRow(installedSite(), installedRecce(), 'installed');
    expect(cells.el1InstallStatus).toEqual({ t: 'status', v: 'Installed', tone: 'approved' });
    expect(cells.el1InstallPhoto).toEqual({ t: 'photo', key: 'i1', viewPath: '/v1/media/view?key=i1', lat: 19.2402, lng: 73.1302 });
    expect(cells.el2InstallStatus).toEqual({ t: 'status', v: 'Not installed', tone: 'pending' });
    expect(cells.el2InstallPhoto).toEqual({ t: 'empty' });
  });

  it('install metadata: date (IST), installer promoter, audit chip, before/after geo', () => {
    const { cells } = buildRecceRow(installedSite(), installedRecce(), 'installed');
    expect(cells.installDate).toEqual({ t: 'text', v: fmtDateTime(daysAgo(1)) });
    expect(cells.installer).toEqual({ t: 'text', v: 'INST9' });
    expect(cells.auditStatus).toEqual({ t: 'status', v: 'Audited', tone: 'approved' });
    expect(cells.beforeAfterGeo).toEqual({ t: 'text', v: '3.2 m · Geo-fence pass' });
  });

  it('activityStatus rolls up to "Audited" for an audit-approved installed recce', () => {
    const { cells } = buildRecceRow(installedSite(), installedRecce(), 'installed');
    expect(cells.activityStatus).toEqual({ t: 'status', v: 'Audited', tone: 'approved' });
  });

  it('the recce photo carries markup but the INSTALL photo never does (InstallPosm has no markup)', () => {
    const markup = { version: 1, shapes: [{ type: 'rect', x: 0.1, y: 0.2, w: 0.3, h: 0.25 }] };
    const recce = installedRecce();
    recce.posms[0] = { ...recce.posms[0], markup }; // annotate the recce photo
    const { cells } = buildRecceRow({ ...installedSite(), recces: [recce] }, recce, 'installed');
    expect(cells.el1Photo).toMatchObject({ t: 'photo', key: 'r1', markup });
    // The install photo cell carries NO markup — the FE draws no box over the installed "after" photo.
    expect('markup' in (cells.el1InstallPhoto as Record<string, unknown>)).toBe(false);
  });

  it('excel-only install audit trail filled on a terminal audit outcome', () => {
    const { cells } = buildRecceRow(installedSite(), installedRecce(), 'installed');
    expect(cells.installAuditedBy).toEqual({ t: 'text', v: 'Auditor A' });
    expect(cells.installAuditedOn).toEqual({ t: 'text', v: fmtDateTime(now) });
  });

  it('a still-SUBMITTED installation leaves the excel-only install audit trail empty', () => {
    const recce = installedRecce({ installation: sampleInstallation({ status: 'SUBMITTED', auditedBy: null, auditedAt: null }) });
    const { cells } = buildRecceRow({ ...installedSite(), recces: [recce] }, recce, 'installed');
    expect(cells.auditStatus).toEqual({ t: 'status', v: 'Submitted', tone: 'pending' });
    expect(cells.installAuditedBy).toEqual({ t: 'empty' });
    expect(cells.installAuditedOn).toEqual({ t: 'empty' });
  });

  it('a ONE-element installed recce: slot-2 install cells are empty (never "Not installed")', () => {
    const recce = installedRecce();
    recce.posms = [recce.posms[0]]; // only slot 1
    const { cells } = buildRecceRow({ ...installedSite(), recces: [recce] }, recce, 'installed');
    expect(cells.el1InstallStatus).toEqual({ t: 'status', v: 'Installed', tone: 'approved' });
    for (const k of ['el2InstallStatus', 'el2InstallPhoto']) expect(cells[k]).toEqual({ t: 'empty' });
  });

  it('recce mode does NOT add any install keys (byte-identical to before)', () => {
    const { cells } = buildRecceRow(installedSite(), installedRecce(), 'recce');
    for (const k of ['el1InstallStatus', 'el1InstallPhoto', 'installDate', 'installer', 'auditStatus', 'installHoStatus', 'beforeAfterGeo', 'installAuditedBy', 'installHoReviewedBy', 'installHoReviewedOn']) {
      expect(cells[k]).toBeUndefined();
    }
    // The recce cells themselves are unchanged.
    expect(cells.recceStatus).toEqual({ t: 'status', v: 'HO approved', tone: 'approved' });
    expect(Object.keys(cells).sort()).toEqual(CURATED_COLUMNS.map((c) => c.key).sort());
  });
});

describe('buildRecceRow — install HO-override reads INDEPENDENTLY of the auditor verdict', () => {
  it('auditor-rejected THEN HO-approved: auditStatus red "Audit rejected" AND installHoStatus green "HO approved"', () => {
    // The exact schema contract: status stays AUDIT_REJECTED while hoReviewStatus becomes APPROVED.
    const recce = installedRecce({
      installation: sampleInstallation({
        status: 'AUDIT_REJECTED',
        hoReviewStatus: 'APPROVED',
        hoReviewedBy: { name: 'Hari HO' },
        hoReviewedAt: now,
      }),
    });
    const { cells } = buildRecceRow({ ...installedSite(), recces: [recce] }, recce, 'installed');
    // Two independent axes — the auditor's red verdict is untouched; the HO override reads green beside it.
    expect(cells.auditStatus).toEqual({ t: 'status', v: 'Audit rejected', tone: 'rejected' });
    expect(cells.installHoStatus).toEqual({ t: 'status', v: 'HO approved', tone: 'approved' });
    // Excel-only HO-override audit trail is filled on a terminal HO outcome.
    expect(cells.installHoReviewedBy).toEqual({ t: 'text', v: 'Hari HO' });
    expect(cells.installHoReviewedOn).toEqual({ t: 'text', v: fmtDateTime(now) });
  });

  it('auditor-rejected, HO still PENDING: installHoStatus amber "HO review pending", audit trail blank', () => {
    const recce = installedRecce({
      installation: sampleInstallation({ status: 'AUDIT_REJECTED', hoReviewStatus: 'PENDING', hoReviewedBy: null, hoReviewedAt: null }),
    });
    const { cells } = buildRecceRow({ ...installedSite(), recces: [recce] }, recce, 'installed');
    expect(cells.auditStatus).toEqual({ t: 'status', v: 'Audit rejected', tone: 'rejected' });
    expect(cells.installHoStatus).toEqual({ t: 'status', v: 'HO review pending', tone: 'pending' });
    expect(cells.installHoReviewedBy).toEqual({ t: 'empty' });
    expect(cells.installHoReviewedOn).toEqual({ t: 'empty' });
  });

  it('plain audited install (never escalated): auditStatus green "Audited" + installHoStatus neutral "Not escalated"', () => {
    // The default sampleInstallation: AUDIT_APPROVED, hoReviewStatus undefined/NONE.
    const { cells } = buildRecceRow(installedSite(), installedRecce(), 'installed');
    expect(cells.auditStatus).toEqual({ t: 'status', v: 'Audited', tone: 'approved' });
    expect(cells.installHoStatus).toEqual({ t: 'status', v: 'Not escalated', tone: 'neutral' });
    expect(cells.installHoReviewedBy).toEqual({ t: 'empty' });
    expect(cells.installHoReviewedOn).toEqual({ t: 'empty' });
  });
});

describe('buildOutletExecutionRows — installed-mode filter (only recces WITH an installation)', () => {
  it('keeps only recces that have an installation; drops the rest', () => {
    const withInstall = installedRecce({ id: 'recInstalled' });
    const noInstall: RepRecce = { ...appRecce(), id: 'recNoInstall', installation: null };
    const site: RepSite = { ...fullSite(), recces: [withInstall, noInstall] };
    const rows = buildOutletExecutionRows(site, 'installed');
    expect(rows.map((r) => r.id)).toEqual(['recInstalled']);
  });

  it('an outlet with NO installed recce yields ZERO rows in installed mode (vs one in recce mode)', () => {
    const noInstall: RepRecce = { ...appRecce(), id: 'recNoInstall', installation: null };
    const site: RepSite = { ...fullSite(), recces: [noInstall] };
    expect(buildOutletExecutionRows(site, 'installed')).toHaveLength(0);
    expect(buildOutletExecutionRows(site, 'recce')).toHaveLength(1);
  });

  it('a no-recce outlet still yields one row in recce mode, zero in installed mode', () => {
    const bare: RepSite = { ...fullSite(), recces: [] };
    expect(buildOutletExecutionRows(bare, 'recce')).toHaveLength(1);
    expect(buildOutletExecutionRows(bare, 'installed')).toHaveLength(0);
  });
});
