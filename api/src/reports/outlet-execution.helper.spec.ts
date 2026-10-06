import {
  buildOutletExecutionRow,
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
  type RepSite,
} from './outlet-execution.helper';

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
    expect(hoApprovalLabel(null)).toBe('');
    expect(hoApprovalLabel({ hoReviewStatus: 'NONE' } as any)).toBe('N/A');
    expect(hoApprovalLabel({ hoReviewStatus: 'PENDING' } as any)).toBe('Pending');
    expect(auditStatusLabel(null)).toBe('');
    expect(auditStatusLabel({ status: 'AUDIT_REJECTED' } as any)).toBe('Rejected');
    expect(auditStatusLabel({ status: 'SUBMITTED' } as any)).toBe('Pending audit');
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
    ).toBe('Wrong site');
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

describe('buildOutletExecutionRow', () => {
  const fullSite = (): RepSite => ({
    code: 'A8', name: 'Kalyan Mega Mart', lat: 19.24, lng: 73.13,
    region: 'West', state: 'MH', cluster: 'Thane', town: 'Kalyan', rsCode: 'RS9',
    beatName: 'Beat-3', channel: 'GT', address: '12 Main Rd',
    vendor: { name: 'FleetCo' },
    recces: [
      {
        status: 'APPROVED',
        rejectionReasonCode: null,
        rejectionReason: null,
        hoReviewStatus: 'APPROVED',
        hoRejectionReasonCode: null,
        hoRejectionReason: null,
        capturedAt: new Date('2026-09-28T06:00:00Z'),
        receivedAt: new Date('2026-09-28T06:01:00Z'),
        captureLat: 19.24, captureLng: 73.13,
        submittedBy: { name: 'Rep One', promoterCode: 'P100' },
        posms: [
          { id: 'rp1', slotNo: 1, posmType: { name: 'Standard Board' }, photo: { key: 'r1', geo: { lat: 19.2401, lng: 73.1301 } } },
          { id: 'rp2', slotNo: 2, posmType: { name: 'Danglers' }, photo: { key: 'r2' } },
        ],
      },
    ],
    installs: [
      {
        status: 'AUDIT_REJECTED',
        hoReviewStatus: 'APPROVED',
        isDirect: false,
        capturedAt: new Date('2026-09-29T09:30:00Z'),
        submittedBy: { name: 'Rep Two', promoterCode: 'P200' },
        posms: [
          { reccePosmId: 'rp1', captureLat: 19.2402, captureLng: 73.1302, distanceFromRecce: 3.2 },
          // rp2 has no install → element 2 shows "Not installed"
        ],
      },
    ],
  });

  it('produces every spec column, in order', () => {
    const row = buildOutletExecutionRow(fullSite());
    expect(Object.keys(row)).toEqual([...OUTLET_REPORT_COLUMNS]);
  });

  it('maps the leading outlet-master + promoter + direct columns', () => {
    const row = buildOutletExecutionRow(fullSite());
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
  });

  it('maps per-element recce/install facts (element 1 installed, element 2 not)', () => {
    const row = buildOutletExecutionRow(fullSite());
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
    const row = buildOutletExecutionRow(fullSite());
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
    };
    site.installs = [];
    const row = buildOutletExecutionRow(site);
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
    };
    site.installs = [];
    const row = buildOutletExecutionRow(site);
    expect(row['HO Recce Approval']).toBe('Rejected');
    expect(row['ASM Rejection Reason']).toBe('');
    expect(row['HO Rejection Reason']).toBe('Wrong Element');
  });

  it('a bare outlet with no recce → "Not started" and empty downstream stages', () => {
    const bare: RepSite = {
      code: 'B1', name: 'New Outlet', lat: null, lng: null,
      region: null, state: null, cluster: null, town: 'Pune', rsCode: null,
      beatName: null, channel: null, address: null,
      vendor: null, recces: [], installs: [],
    };
    const row = buildOutletExecutionRow(bare);
    expect(row['Outlet Recce Status']).toBe('Not started');
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
