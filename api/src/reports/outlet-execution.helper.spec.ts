import {
  buildOutletExecutionRows,
  buildRecceRow,
  OUTLET_REPORT_COLUMNS,
  latLng,
  photoLatLng,
  distanceLabel,
  hoApprovalLabel,
  hoRecceApprovalLabel,
  asmRejectionReasonLabel,
  hoRejectionReasonLabel,
  auditStatusLabel,
  asmApprovalLabel,
  recceModeLabel,
  type RepSite,
  type RepRecce,
  type RepInstallation,
} from './outlet-execution.helper';

// Durable rule: NEVER hardcode a fixed date in a test. All timestamps are derived from `now` so the
// suite is stable whatever day it runs (fmtDateTime just formats; no assertion pins a calendar date).
const now = new Date();
const daysAgo = (d: number): Date => new Date(now.getTime() - d * 86_400_000);

describe('outlet-execution helpers', () => {
  it('latLng / photoLatLng / distanceLabel format defensively', () => {
    expect(latLng(19.077, 72.8986)).toBe('19.07700, 72.89860');
    expect(latLng(null, 72)).toBe('');
    expect(photoLatLng({ key: 'k', geo: { lat: 1.5, lng: 2.5 } })).toBe('1.50000, 2.50000');
    expect(photoLatLng({ key: 'k' })).toBe('');
    expect(photoLatLng('garbage')).toBe('');
    expect(distanceLabel(3.4)).toBe('3 m');
    expect(distanceLabel(1500)).toBe('1.5 km');
    expect(distanceLabel(null)).toBe('');
  });

  it('status labels map the enums (and empty when the stage does not apply)', () => {
    expect(asmApprovalLabel(null)).toBe('');
    expect(asmApprovalLabel({ status: 'SUBMITTED' } as any)).toBe('Pending');
    expect(asmApprovalLabel({ status: 'APPROVED' } as any)).toBe('Approved');
    // A MANUAL recce never had an ASM stage → "N/A" regardless of status (audit F3).
    expect(asmApprovalLabel({ status: 'APPROVED', recceMode: 'MANUAL' } as any)).toBe('N/A');
    expect(asmApprovalLabel({ status: 'SUBMITTED', recceMode: 'MANUAL' } as any)).toBe('N/A');
    expect(hoApprovalLabel(null)).toBe('');
    expect(hoApprovalLabel({ hoReviewStatus: 'NONE' } as any)).toBe('N/A');
    expect(hoApprovalLabel({ hoReviewStatus: 'PENDING' } as any)).toBe('Pending');
    expect(auditStatusLabel(null)).toBe('');
    expect(auditStatusLabel({ status: 'AUDIT_REJECTED' } as any)).toBe('Rejected');
    expect(auditStatusLabel({ status: 'SUBMITTED' } as any)).toBe('Pending audit');
  });

  it('recceModeLabel maps the recce entry path (App / Manual; empty for a no-recce row)', () => {
    expect(recceModeLabel(null)).toBe('');
    expect(recceModeLabel({ recceMode: 'APP' } as any)).toBe('App');
    expect(recceModeLabel({ recceMode: 'MANUAL' } as any)).toBe('Manual');
  });

  it('hoRecceApprovalLabel maps the recce-side HO stage (N/A for NONE, empty for no recce)', () => {
    expect(hoRecceApprovalLabel(null)).toBe('');
    expect(hoRecceApprovalLabel({ hoReviewStatus: 'NONE' } as any)).toBe('N/A');
    expect(hoRecceApprovalLabel({ hoReviewStatus: 'PENDING' } as any)).toBe('Pending');
    expect(hoRecceApprovalLabel({ hoReviewStatus: 'APPROVED' } as any)).toBe('Approved');
    expect(hoRecceApprovalLabel({ hoReviewStatus: 'REJECTED' } as any)).toBe('Rejected');
  });

  it('asmRejectionReasonLabel: only when ASM-rejected (REJECTED and HO not rejected); code + note', () => {
    expect(asmRejectionReasonLabel(null)).toBe('');
    // ASM-rejected with a free-text note → "<label> — <note>"
    expect(
      asmRejectionReasonLabel({
        status: 'REJECTED', hoReviewStatus: 'NONE',
        rejectionReasonCode: 'BLURRY', rejectionReason: 'left corner cut off',
      } as any),
    ).toBe('Blurry / unclear photo — left corner cut off');
    // code only, no note
    expect(
      asmRejectionReasonLabel({
        status: 'REJECTED', hoReviewStatus: 'NONE',
        rejectionReasonCode: 'WRONG_SITE', rejectionReason: null,
      } as any),
    ).toBe('Wrong outlet');
    // an HO rejection (also status REJECTED) is NOT an ASM rejection → empty here
    expect(
      asmRejectionReasonLabel({
        status: 'REJECTED', hoReviewStatus: 'REJECTED',
        rejectionReasonCode: 'BLURRY', rejectionReason: null,
      } as any),
    ).toBe('');
    // not rejected at all → empty
    expect(
      asmRejectionReasonLabel({ status: 'APPROVED', hoReviewStatus: 'APPROVED' } as any),
    ).toBe('');
  });

  it('hoRejectionReasonLabel: only when HO-rejected; code + note', () => {
    expect(hoRejectionReasonLabel(null)).toBe('');
    expect(
      hoRejectionReasonLabel({
        hoReviewStatus: 'REJECTED',
        hoRejectionReasonCode: 'GEO_MISMATCH', hoRejectionReason: 'too far from site',
      } as any),
    ).toBe('Location mismatch — too far from site');
    expect(
      hoRejectionReasonLabel({ hoReviewStatus: 'REJECTED', hoRejectionReasonCode: 'OTHER', hoRejectionReason: null } as any),
    ).toBe('Other');
    // not HO-rejected → empty even if an ASM reason exists
    expect(
      hoRejectionReasonLabel({ hoReviewStatus: 'PENDING', hoRejectionReasonCode: null, hoRejectionReason: null } as any),
    ).toBe('');
  });
});

// The APP recce + its installation used by the single-row (app-only outlet) tests. One APP recce
// with an installation nested under it (Recce.installation), so each row's install facts are its own.
const appInstall = (): RepInstallation => ({
  status: 'AUDIT_REJECTED',
  hoReviewStatus: 'APPROVED',
  isDirect: false,
  capturedAt: daysAgo(1),
  submittedBy: { name: 'Rep Two', promoterCode: 'P200' },
  posms: [
    { reccePosmId: 'rp1', captureLat: 19.2402, captureLng: 73.1302, distanceFromRecce: 3.2 },
    // rp2 has no install → element 2 shows "Not installed"
  ],
});

const appRecce = (): RepRecce => ({
  id: 'recA',
  recceMode: 'APP',
  status: 'APPROVED',
  rejectionReasonCode: null,
  rejectionReason: null,
  hoReviewStatus: 'APPROVED',
  hoRejectionReasonCode: null,
  hoRejectionReason: null,
  capturedAt: daysAgo(2),
  receivedAt: daysAgo(2),
  captureLat: 19.24, captureLng: 73.13,
  submittedBy: { name: 'Rep One', promoterCode: 'P100' },
  posms: [
    { id: 'rp1', slotNo: 1, posmType: { name: 'Standard Board' }, photo: { key: 'r1', geo: { lat: 19.2401, lng: 73.1301 } } },
    { id: 'rp2', slotNo: 2, posmType: { name: 'Danglers' }, photo: { key: 'r2' } },
  ],
  installation: appInstall(),
});

describe('buildOutletExecutionRows — app-only outlet (one recce → one row)', () => {
  const fullSite = (): RepSite => ({
    code: 'A8', name: 'Kalyan Mega Mart', lat: 19.24, lng: 73.13,
    region: 'West', state: 'MH', cluster: 'Thane', town: 'Kalyan', rsCode: 'RS9',
    beatName: 'Beat-3', channel: 'GT', address: '12 Main Rd',
    vendor: { name: 'FleetCo' },
    recces: [appRecce()],
  });

  it('an app-only outlet yields exactly one row', () => {
    expect(buildOutletExecutionRows(fullSite())).toHaveLength(1);
  });

  it('produces every spec column, in order', () => {
    const row = buildOutletExecutionRows(fullSite())[0];
    expect(Object.keys(row)).toEqual([...OUTLET_REPORT_COLUMNS]);
  });

  it('maps the leading outlet-master + promoter + direct + recce-mode columns', () => {
    const row = buildOutletExecutionRows(fullSite())[0];
    expect(row['Vendor Name']).toBe('FleetCo');
    expect(row['Recce Promoter ID']).toBe('P100');
    expect(row['Install Promoter ID']).toBe('P200');
    expect(row['Region']).toBe('West');
    expect(row['State']).toBe('MH');
    expect(row['Cluster']).toBe('Thane');
    expect(row['Beat Name']).toBe('Beat-3');
    expect(row['Channel']).toBe('GT');
    expect(row['Address']).toBe('12 Main Rd');
    expect(row['Outlet Code']).toBe('A8');
    expect(row['Lat Long']).toBe('19.24000, 73.13000');
    expect(row['Direct Installation']).toBe('No');
    expect(row['Recce Mode']).toBe('App');
  });

  it('maps per-element recce/install facts (element 1 installed, element 2 not)', () => {
    const row = buildOutletExecutionRows(fullSite())[0];
    expect(row['Element 1']).toBe('Standard Board');
    expect(row['Element 1 Recce Status']).toBe('Approved');
    expect(row['Element 1 Recce Location']).toBe('19.24010, 73.13010'); // per-photo geo
    expect(row['Element 1 Installation Status']).toBe('Installed');
    expect(row['Element 1 Installation Location']).toBe('19.24020, 73.13020');
    expect(row['Element 1 Recce and Installation distance']).toBe('3 m');

    expect(row['Element 2']).toBe('Danglers');
    expect(row['Element 2 Recce Location']).toBe('19.24000, 73.13000'); // falls back to recce capture geo
    expect(row['Element 2 Installation Status']).toBe('Not installed');
    expect(row['Element 2 Installation Location']).toBe('');
    expect(row['Element 2 Recce and Installation distance']).toBe('');
  });

  it('maps the trailing workflow-status columns (HO override kept independent of audit)', () => {
    const row = buildOutletExecutionRows(fullSite())[0];
    expect(row['Outlet Recce Status']).toBe('Approved');
    expect(row['ASM Approval Status']).toBe('Approved');
    // Auditor rejected, but HO overrode → the two columns tell the truth independently.
    expect(row['Audit Status']).toBe('Rejected');
    expect(row['HO Approval Status']).toBe('Approved');
    expect(row['Installation Status']).toBe('Submitted');
    // Recce-side HO stage approved; neither rejection-reason column applies on an approved recce.
    expect(row['HO Recce Approval']).toBe('Approved');
    expect(row['ASM Rejection Reason']).toBe('');
    expect(row['HO Rejection Reason']).toBe('');
  });

  it('surfaces the ASM rejection reason (and leaves the HO columns empty) on an ASM-rejected recce', () => {
    const site = fullSite();
    site.recces[0] = {
      ...site.recces[0],
      status: 'REJECTED',
      hoReviewStatus: 'NONE',
      rejectionReasonCode: 'POSM_NOT_VISIBLE',
      rejectionReason: 'board hidden behind shutter',
      installation: null,
    };
    const row = buildOutletExecutionRows(site)[0];
    expect(row['ASM Approval Status']).toBe('Rejected');
    expect(row['HO Recce Approval']).toBe('N/A');
    expect(row['ASM Rejection Reason']).toBe('Element not visible — board hidden behind shutter');
    expect(row['HO Rejection Reason']).toBe('');
  });

  it('surfaces the HO rejection reason (and leaves the ASM column empty) on an HO-rejected recce', () => {
    const site = fullSite();
    site.recces[0] = {
      ...site.recces[0],
      status: 'REJECTED',
      hoReviewStatus: 'REJECTED',
      rejectionReasonCode: null,
      rejectionReason: null,
      hoRejectionReasonCode: 'WRONG_POSM',
      hoRejectionReason: null,
      installation: null,
    };
    const row = buildOutletExecutionRows(site)[0];
    expect(row['HO Recce Approval']).toBe('Rejected');
    expect(row['ASM Rejection Reason']).toBe('');
    expect(row['HO Rejection Reason']).toBe('Wrong Element');
  });

  it('a bare outlet with no recce → one "Not started" row with empty downstream stages', () => {
    const bare: RepSite = {
      code: 'B1', name: 'New Outlet', lat: null, lng: null,
      region: null, state: null, cluster: null, town: 'Pune', rsCode: null,
      beatName: null, channel: null, address: null,
      vendor: null, recces: [],
    };
    const rows = buildOutletExecutionRows(bare);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row['Outlet Recce Status']).toBe('Not started');
    expect(row['Recce Mode']).toBe(''); // no recce → blank mode
    expect(row['ASM Approval Status']).toBe('');
    expect(row['HO Approval Status']).toBe('');
    expect(row['Installation Status']).toBe('');
    expect(row['Audit Status']).toBe('');
    expect(row['Element 1']).toBe('');
    expect(row['Element 1 Recce Status']).toBe('');
    expect(row['Lat Long']).toBe('');
    expect(row['Direct Installation']).toBe('');
  });
});

describe('buildOutletExecutionRows — mixed outlet (1 app + 2 manual recces → 3 rows)', () => {
  // A manual recce: field-typed, skips ASM, approved by HO (HO sets BOTH status + hoReviewStatus
  // APPROVED), optionally installed. Different element from the app recce.
  const manualRecce = (
    id: string,
    receivedAt: Date,
    opts: { posmName: string; promoter: string; installed: boolean },
  ): RepRecce => ({
    id,
    recceMode: 'MANUAL',
    status: 'APPROVED',
    rejectionReasonCode: null,
    rejectionReason: null,
    hoReviewStatus: 'APPROVED',
    hoRejectionReasonCode: null,
    hoRejectionReason: null,
    capturedAt: receivedAt,
    receivedAt,
    captureLat: 19.25, captureLng: 73.14,
    submittedBy: { name: 'Field Exec', promoterCode: opts.promoter },
    posms: [
      { id: `${id}-p1`, slotNo: 1, posmType: { name: opts.posmName }, photo: { key: `${id}k`, geo: { lat: 19.2501, lng: 73.1401 } } },
    ],
    installation: opts.installed
      ? {
          status: 'AUDIT_APPROVED',
          hoReviewStatus: 'NONE',
          isDirect: false,
          capturedAt: new Date(receivedAt.getTime() + 3_600_000),
          submittedBy: { name: 'Installer', promoterCode: `${opts.promoter}-I` },
          posms: [{ reccePosmId: `${id}-p1`, captureLat: 19.2502, captureLng: 73.1402, distanceFromRecce: 5 }],
        }
      : null,
  });

  // Deliberately out of order in the array (manual-newer BEFORE manual-older, app last) to prove the
  // builder sorts: APP first, then MANUAL oldest-first.
  const mixedSite = (): RepSite => ({
    code: 'M9', name: 'Multi Outlet', lat: 19.25, lng: 73.14,
    region: 'West', state: 'MH', cluster: 'Thane', town: 'Kalyan', rsCode: 'RS9',
    beatName: 'Beat-3', channel: 'GT', address: '7 Market Rd',
    vendor: { name: 'FleetCo' },
    recces: [
      manualRecce('recMnew', daysAgo(1), { posmName: 'Wobbler', promoter: 'PM2', installed: false }),
      appRecce(),
      manualRecce('recMold', daysAgo(5), { posmName: 'Shelf Strip', promoter: 'PM1', installed: true }),
    ],
  });

  it('yields exactly 3 rows (1 per recce)', () => {
    expect(buildOutletExecutionRows(mixedSite())).toHaveLength(3);
  });

  it('orders rows APP first, then MANUAL oldest-first (by receivedAt)', () => {
    const rows = buildOutletExecutionRows(mixedSite());
    expect(rows.map((r) => r['Recce Mode'])).toEqual(['App', 'Manual', 'Manual']);
    // The app row carries the app recce's element; the two manual rows carry THEIR own elements in
    // oldest-first order (Shelf Strip @ 5d, then Wobbler @ 1d).
    expect(rows.map((r) => r['Element 1'])).toEqual(['Standard Board', 'Shelf Strip', 'Wobbler']);
  });

  it('repeats the outlet-identity columns on every row', () => {
    const rows = buildOutletExecutionRows(mixedSite());
    for (const r of rows) {
      expect(r['Outlet Code']).toBe('M9');
      expect(r['Outlet Name']).toBe('Multi Outlet');
      expect(r['Vendor Name']).toBe('FleetCo');
      expect(r['Beat Name']).toBe('Beat-3');
      expect(r['Lat Long']).toBe('19.25000, 73.14000');
    }
  });

  it('each row reflects ITS OWN recce + install, not a sibling recce', () => {
    const [appRow, manualOld, manualNew] = buildOutletExecutionRows(mixedSite());

    // App row: its own promoter + its own (audit-rejected, HO-approved) install.
    expect(appRow['Recce Promoter ID']).toBe('P100');
    expect(appRow['Install Promoter ID']).toBe('P200');
    expect(appRow['Audit Status']).toBe('Rejected');
    expect(appRow['HO Approval Status']).toBe('Approved');

    // Oldest manual row: installed + audit-approved, its own promoter codes.
    expect(manualOld['Recce Mode']).toBe('Manual');
    expect(manualOld['Recce Promoter ID']).toBe('PM1');
    expect(manualOld['Install Promoter ID']).toBe('PM1-I');
    expect(manualOld['Element 1']).toBe('Shelf Strip');
    expect(manualOld['Element 1 Installation Status']).toBe('Installed');
    expect(manualOld['Installation Status']).toBe('Submitted');
    expect(manualOld['Audit Status']).toBe('Approved');
    // Manual recces skip ASM → the ASM approval column reads Approved (status APPROVED set by HO).
    expect(manualOld['Outlet Recce Status']).toBe('Approved');

    // Newest manual row: NOT installed → no install facts leak from the installed sibling.
    expect(manualNew['Recce Mode']).toBe('Manual');
    expect(manualNew['Recce Promoter ID']).toBe('PM2');
    expect(manualNew['Install Promoter ID']).toBe('');
    expect(manualNew['Element 1']).toBe('Wobbler');
    expect(manualNew['Element 1 Installation Status']).toBe('Not installed');
    expect(manualNew['Installation Status']).toBe('Not installed');
    expect(manualNew['Audit Status']).toBe('');
  });

  it('every row carries the full ordered column set', () => {
    for (const r of buildOutletExecutionRows(mixedSite())) {
      expect(Object.keys(r)).toEqual([...OUTLET_REPORT_COLUMNS]);
    }
  });
});

describe('buildRecceRow — single-row builder (used by buildOutletExecutionRows)', () => {
  it('builds one row for a given recce (null recce → blank Recce Mode + "Not started")', () => {
    const site: RepSite = {
      code: 'Z1', name: 'Solo', lat: null, lng: null,
      region: null, state: null, cluster: null, town: null, rsCode: null,
      beatName: null, channel: null, address: null, vendor: null, recces: [],
    };
    const row = buildRecceRow(site, null);
    expect(row['Recce Mode']).toBe('');
    expect(row['Outlet Recce Status']).toBe('Not started');
    expect(Object.keys(row)).toEqual([...OUTLET_REPORT_COLUMNS]);
  });
});
