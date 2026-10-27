import {
  recceLifecycleLabel,
  installLifecycleLabel,
  siteStatusLabel,
  summarizeElementNames,
  summarizeDimensions,
  formatDimensions,
  summarizeElements,
  drilldownXlsxRow,
  xlsxDate,
  DRILLDOWN_XLSX_HEADERS,
  siteFunnelStage,
  latestRecceFunnelStage,
  recceFunnelStage,
  installFunnelStage,
  funnelBadge,
  funnelStageToGeo,
  type DrilldownRecordItem,
} from './drilldown-record';

describe('drilldown-record — human lifecycle labels', () => {
  it('recce: Not started / Rejected / HO approved / ASM approved / Submitted (matches the report)', () => {
    expect(recceLifecycleLabel(null, null)).toBe('Not started');
    expect(recceLifecycleLabel('REJECTED', 'NONE')).toBe('Rejected');
    expect(recceLifecycleLabel('APPROVED', 'APPROVED')).toBe('HO approved');
    expect(recceLifecycleLabel('APPROVED', 'PENDING')).toBe('ASM approved');
    expect(recceLifecycleLabel('SUBMITTED', 'NONE')).toBe('Submitted');
    // A MANUAL recce (never ASM-approved) reads HO approved once HO signs off.
    expect(recceLifecycleLabel('SUBMITTED', 'APPROVED')).toBe('HO approved');
  });

  it('install: Submitted / Audited / Audit rejected', () => {
    expect(installLifecycleLabel('SUBMITTED')).toBe('Submitted');
    expect(installLifecycleLabel('AUDIT_APPROVED')).toBe('Audited');
    expect(installLifecycleLabel('AUDIT_REJECTED')).toBe('Audit rejected');
    expect(installLifecycleLabel(null)).toBe('');
  });

  it('site: title-cased status', () => {
    expect(siteStatusLabel('ACTIVE')).toBe('Active');
    expect(siteStatusLabel('INACTIVE')).toBe('Inactive');
    expect(siteStatusLabel(null)).toBe('');
  });
});

describe('drilldown-record — execution-funnel ladder', () => {
  it('funnelBadge: clean label + report-matching tone per rung', () => {
    expect(funnelBadge('NOT_STARTED')).toEqual({ funnelStage: 'Not started', funnelTone: 'neutral' });
    expect(funnelBadge('RECCE_SUBMITTED')).toEqual({ funnelStage: 'Recce submitted', funnelTone: 'pending' });
    expect(funnelBadge('ASM_APPROVED')).toEqual({ funnelStage: 'ASM approved', funnelTone: 'pending' });
    expect(funnelBadge('HO_APPROVED')).toEqual({ funnelStage: 'HO approved', funnelTone: 'approved' });
    expect(funnelBadge('INSTALLED')).toEqual({ funnelStage: 'Installed', funnelTone: 'pending' });
    expect(funnelBadge('AUDITED')).toEqual({ funnelStage: 'Audited', funnelTone: 'approved' });
    expect(funnelBadge('RECCE_REJECTED')).toEqual({ funnelStage: 'Recce rejected', funnelTone: 'rejected' });
    expect(funnelBadge('INSTALL_REJECTED')).toEqual({ funnelStage: 'Install rejected', funnelTone: 'rejected' });
  });

  it('recceFunnelStage: null → not started; the recce rungs + rejection', () => {
    expect(recceFunnelStage(null, null)).toBe('NOT_STARTED');
    expect(recceFunnelStage('SUBMITTED', 'NONE')).toBe('RECCE_SUBMITTED');
    expect(recceFunnelStage('APPROVED', 'PENDING')).toBe('ASM_APPROVED');
    expect(recceFunnelStage('APPROVED', 'APPROVED')).toBe('HO_APPROVED');
    // A MANUAL recce (no ASM stage) jumps straight to HO approved once HO signs off.
    expect(recceFunnelStage('SUBMITTED', 'APPROVED')).toBe('HO_APPROVED');
    expect(recceFunnelStage('REJECTED', 'NONE')).toBe('RECCE_REJECTED');
  });

  it('installFunnelStage: Installed / Audited / terminal Install rejected (HO-upheld)', () => {
    expect(installFunnelStage('SUBMITTED', 'NONE')).toBe('INSTALLED');
    expect(installFunnelStage('AUDIT_APPROVED', 'NONE')).toBe('AUDITED');
    // HO overruled an audit rejection → approved → Audited (the two axes honoured).
    expect(installFunnelStage('AUDIT_REJECTED', 'APPROVED')).toBe('AUDITED');
    // Auditor rejected AND HO upheld → the terminal fail.
    expect(installFunnelStage('AUDIT_REJECTED', 'REJECTED')).toBe('INSTALL_REJECTED');
    // Audit-rejected but HO still pending → in-flight, not terminal.
    expect(installFunnelStage('AUDIT_REJECTED', 'PENDING')).toBe('INSTALLED');
  });

  describe('latestRecceFunnelStage — the LATEST recce stage for the outlet badge', () => {
    it('no recces → Not started', () => {
      expect(latestRecceFunnelStage([])).toBe('NOT_STARTED');
    });
    it('picks the most-recent recce by capture date and folds in ITS installation', () => {
      // Older recce submitted; newer recce HO-approved + audit-approved install → latest = Audited.
      expect(
        latestRecceFunnelStage([
          { capturedAt: new Date('2026-01-10'), status: 'SUBMITTED', hoReviewStatus: 'NONE', installation: null },
          { capturedAt: new Date('2026-02-20'), status: 'APPROVED', hoReviewStatus: 'APPROVED', installation: { status: 'AUDIT_APPROVED', hoReviewStatus: 'NONE' } },
        ]),
      ).toBe('AUDITED');
    });
    it('a NEW submitted recce is shown as-is even when an OLDER recce was installed (latest, not furthest)', () => {
      expect(
        latestRecceFunnelStage([
          { capturedAt: new Date('2026-01-10'), status: 'APPROVED', hoReviewStatus: 'APPROVED', installation: { status: 'AUDIT_APPROVED', hoReviewStatus: 'NONE' } },
          { capturedAt: new Date('2026-03-01'), status: 'SUBMITTED', hoReviewStatus: 'NONE', installation: null },
        ]),
      ).toBe('RECCE_SUBMITTED');
    });
    it('latest recce with an HO-upheld terminal install rejection → Install rejected', () => {
      expect(
        latestRecceFunnelStage([
          { capturedAt: new Date('2026-02-20'), status: 'APPROVED', hoReviewStatus: 'APPROVED', installation: { status: 'AUDIT_REJECTED', hoReviewStatus: 'REJECTED' } },
        ]),
      ).toBe('INSTALL_REJECTED');
    });
    it('falls back to receivedAt when capturedAt is absent; undated recces sort oldest', () => {
      expect(
        latestRecceFunnelStage([
          { receivedAt: new Date('2026-05-01'), status: 'APPROVED', hoReviewStatus: 'PENDING', installation: null },
          { status: 'SUBMITTED', hoReviewStatus: 'NONE', installation: null }, // undated → oldest
        ]),
      ).toBe('ASM_APPROVED');
    });
  });

  describe('siteFunnelStage — folds all recces + installs to the furthest rung', () => {
    it('no recce, no install → Not started', () => {
      expect(siteFunnelStage([], [])).toBe('NOT_STARTED');
    });

    it('recce-only: picks the furthest recce rung across many recces', () => {
      expect(siteFunnelStage([{ status: 'SUBMITTED', hoReviewStatus: 'NONE' }], [])).toBe('RECCE_SUBMITTED');
      // A later HO-approved recce wins over an earlier submitted one.
      expect(
        siteFunnelStage(
          [
            { status: 'SUBMITTED', hoReviewStatus: 'NONE' },
            { status: 'APPROVED', hoReviewStatus: 'APPROVED' },
          ],
          [],
        ),
      ).toBe('HO_APPROVED');
      // ASM-approved (HO pending) is below HO-approved.
      expect(siteFunnelStage([{ status: 'APPROVED', hoReviewStatus: 'PENDING' }], [])).toBe('ASM_APPROVED');
    });

    it('a live recce beside a rejected one → the live rung (not rejected)', () => {
      expect(
        siteFunnelStage(
          [
            { status: 'REJECTED', hoReviewStatus: 'NONE' },
            { status: 'SUBMITTED', hoReviewStatus: 'NONE' },
          ],
          [],
        ),
      ).toBe('RECCE_SUBMITTED');
    });

    it('ALL recces rejected, no install → Recce rejected', () => {
      expect(siteFunnelStage([{ status: 'REJECTED', hoReviewStatus: 'NONE' }], [])).toBe('RECCE_REJECTED');
    });

    it('an installation dominates the recce rungs: Installed, then Audited', () => {
      const recce = [{ status: 'APPROVED', hoReviewStatus: 'APPROVED' }];
      expect(siteFunnelStage(recce, [{ status: 'SUBMITTED', hoReviewStatus: 'NONE' }])).toBe('INSTALLED');
      // AUDITED if ANY install is audit-approved.
      expect(
        siteFunnelStage(recce, [
          { status: 'SUBMITTED', hoReviewStatus: 'NONE' },
          { status: 'AUDIT_APPROVED', hoReviewStatus: 'NONE' },
        ]),
      ).toBe('AUDITED');
    });

    it('the ONLY install is a terminal HO-upheld rejection → Install rejected', () => {
      expect(
        siteFunnelStage(
          [{ status: 'APPROVED', hoReviewStatus: 'APPROVED' }],
          [{ status: 'AUDIT_REJECTED', hoReviewStatus: 'REJECTED' }],
        ),
      ).toBe('INSTALL_REJECTED');
    });

    it('tolerates a lean install select (no hoReviewStatus) — any install reads Installed', () => {
      // The geo heatmap selects install `status` only; a rejected install still folds to INSTALLED.
      expect(siteFunnelStage([], [{ status: 'AUDIT_REJECTED' }])).toBe('INSTALLED');
      expect(siteFunnelStage([{ status: 'APPROVED' }], [{ status: 'AUDIT_APPROVED' }])).toBe('AUDITED');
    });
  });

  it('funnelStageToGeo: collapses to the 6-value heatmap vocabulary (rejected rungs fold back)', () => {
    expect(funnelStageToGeo('NOT_STARTED')).toBe('NONE');
    expect(funnelStageToGeo('RECCE_SUBMITTED')).toBe('RECCED');
    expect(funnelStageToGeo('RECCE_REJECTED')).toBe('RECCED'); // a rejected recce still = coverage
    expect(funnelStageToGeo('ASM_APPROVED')).toBe('ASM_APPROVED');
    expect(funnelStageToGeo('HO_APPROVED')).toBe('HO_APPROVED');
    expect(funnelStageToGeo('INSTALLED')).toBe('INSTALLED');
    expect(funnelStageToGeo('INSTALL_REJECTED')).toBe('INSTALLED'); // any install = INSTALLED
    expect(funnelStageToGeo('AUDITED')).toBe('AUDITED');
  });
});

describe('drilldown-record — element + dimension summaries', () => {
  it('element names: de-duped, order-preserving, collapses the tail into (+N)', () => {
    expect(summarizeElementNames([])).toBeNull();
    expect(summarizeElementNames([null, '', '  '])).toBeNull();
    expect(summarizeElementNames(['GSB', 'GSB'])).toBe('GSB'); // de-dup
    expect(summarizeElementNames(['GSB', 'Banner'])).toBe('GSB, Banner');
    expect(summarizeElementNames(['GSB', 'Banner', 'Standee', 'Poster'])).toBe('GSB, Banner (+2)');
  });

  it('formatDimensions: object {width,height,unit} or legacy string → "W × H unit"', () => {
    expect(formatDimensions({ width: 4, height: 3, unit: 'ft' })).toBe('4 × 3 ft');
    expect(formatDimensions({ width: 4, height: 3 })).toBe('4 × 3');
    expect(formatDimensions('2x2')).toBe('2x2');
    expect(formatDimensions(null)).toBeNull();
    expect(formatDimensions({})).toBeNull();
  });

  it('dimension summary: de-duped (common same-size case) + (+N) tail', () => {
    const same = { width: 4, height: 3, unit: 'ft' };
    expect(summarizeDimensions([same, same])).toBe('4 × 3 ft');
    expect(
      summarizeDimensions([
        { width: 4, height: 3, unit: 'ft' },
        { width: 2, height: 2, unit: 'ft' },
        { width: 1, height: 1, unit: 'ft' },
      ]),
    ).toBe('4 × 3 ft, 2 × 2 ft (+1)');
  });

  it('summarizeElements pairs the two summaries from element lines', () => {
    expect(
      summarizeElements([
        { name: 'GSB', dimensions: { width: 4, height: 3, unit: 'ft' } },
        { name: 'Banner', dimensions: { width: 4, height: 3, unit: 'ft' } },
      ]),
    ).toEqual({ elementSummary: 'GSB, Banner', dimensions: '4 × 3 ft' });
  });
});

describe('drilldown-record — xlsx row projection', () => {
  const item: DrilldownRecordItem = {
    id: 'r1',
    outletCode: 'C1',
    outletName: 'Shop One',
    town: 'Pune',
    recceId: 'r1',
    status: 'APPROVED',
    recceDate: new Date('2026-10-20T06:30:00.000Z'),
    vendorName: 'Vendor One',
    elementSummary: 'GSB',
    dimensions: '4 × 3 ft',
    statusLabel: 'HO approved',
  };

  it('projects onto the fixed header set, IST date, human status', () => {
    const row = drilldownXlsxRow(item);
    expect(Object.keys(row)).toEqual([...DRILLDOWN_XLSX_HEADERS]);
    expect(row).toEqual({
      'Outlet Code': 'C1',
      'Outlet Name': 'Shop One',
      Town: 'Pune',
      Vendor: 'Vendor One',
      'Element(s)': 'GSB',
      'W × H': '4 × 3 ft',
      'Recce Date': '2026-10-20',
      Status: 'HO approved',
    });
  });

  it('nulls render as empty cells; falls back to raw status when no label', () => {
    const row = drilldownXlsxRow({
      ...item,
      town: null,
      recceDate: null,
      vendorName: null,
      elementSummary: null,
      dimensions: null,
      statusLabel: null,
      status: 'SUBMITTED',
    });
    expect(row).toMatchObject({ Town: '', Vendor: '', 'Element(s)': '', 'W × H': '', 'Recce Date': '', Status: 'SUBMITTED' });
  });

  it('xlsxDate: null → empty', () => {
    expect(xlsxDate(null)).toBe('');
  });
});
