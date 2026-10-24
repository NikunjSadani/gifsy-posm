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
