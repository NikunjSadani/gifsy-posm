import { describe, it, expect } from 'vitest';
import {
  groupOutletColumns,
  displayOrder,
  subColumnLabel,
  PINNED_KEYS,
} from '../outlet-columns';

/** The owner's 36-column spec order (mirrors api OUTLET_REPORT_COLUMNS). */
const SPEC_COLUMNS = [
  'Vendor Name', 'Recce Promoter ID', 'Install Promoter ID', 'Region', 'State', 'Cluster',
  'Town', 'RS Code', 'Beat Name', 'Outlet Code', 'Outlet Name', 'Channel', 'Address',
  'Lat Long', 'Direct Installation',
  'Element 1', 'Element 1 Recce Status', 'Element 1 Recce Time and Date', 'Element 1 Recce Location',
  'Element 1 Installation Status', 'Element 1 Installation Time and Date', 'Element 1 Installation Location',
  'Element 1 Recce and Installation distance',
  'Element 2', 'Element 2 Recce Status', 'Element 2 Recce Time and Date', 'Element 2 Recce Location',
  'Element 2 Installation Status', 'Element 2 Installation Time and Date', 'Element 2 Installation Location',
  'Element 2 Recce and Installation distance',
  'Outlet Recce Status', 'ASM Approval Status', 'HO Approval Status', 'Installation Status', 'Audit Status',
];

describe('groupOutletColumns', () => {
  const groups = groupOutletColumns(SPEC_COLUMNS);

  it('produces the five groups in render order', () => {
    expect(groups.map((g) => g.label)).toEqual([
      'Outlet', 'Details', 'Element 1', 'Element 2', 'Overall status',
    ]);
  });

  it('pins only the identity group, in PINNED_KEYS order', () => {
    const outlet = groups[0];
    expect(outlet.pinned).toBe(true);
    expect(outlet.columns.map((c) => c.key)).toEqual([...PINNED_KEYS]);
    // no other group is pinned
    expect(groups.slice(1).every((g) => !g.pinned)).toBe(true);
  });

  it('puts the 8 columns of each element under its group', () => {
    const e1 = groups.find((g) => g.label === 'Element 1')!;
    const e2 = groups.find((g) => g.label === 'Element 2')!;
    expect(e1.columns).toHaveLength(8);
    expect(e2.columns).toHaveLength(8);
    expect(e1.columns.every((c) => c.key.startsWith('Element 1'))).toBe(true);
    expect(e2.columns.every((c) => c.key.startsWith('Element 2'))).toBe(true);
  });

  it('groups the 5 rollup statuses last', () => {
    const status = groups.find((g) => g.label === 'Overall status')!;
    expect(status.columns.map((c) => c.key)).toEqual([
      'Outlet Recce Status', 'ASM Approval Status', 'HO Approval Status', 'Installation Status', 'Audit Status',
    ]);
  });

  it('puts the remaining 13 meta columns in Details, in backend order', () => {
    const details = groups.find((g) => g.label === 'Details')!;
    expect(details.columns.map((c) => c.key)).toEqual([
      'Vendor Name', 'Recce Promoter ID', 'Install Promoter ID', 'Region', 'State', 'Cluster',
      'Town', 'RS Code', 'Beat Name', 'Channel', 'Address', 'Lat Long', 'Direct Installation',
    ]);
  });

  it('accounts for every column exactly once (nothing dropped or duplicated)', () => {
    const flat = displayOrder(groups);
    expect(flat).toHaveLength(SPEC_COLUMNS.length);
    expect(new Set(flat).size).toBe(SPEC_COLUMNS.length);
    expect([...flat].sort()).toEqual([...SPEC_COLUMNS].sort());
  });

  it('keeps an unknown future column (lands in Details, never dropped)', () => {
    const groups2 = groupOutletColumns([...SPEC_COLUMNS, 'Surprise Column']);
    const details = groups2.find((g) => g.label === 'Details')!;
    expect(details.columns.map((c) => c.key)).toContain('Surprise Column');
    expect(displayOrder(groups2)).toContain('Surprise Column');
  });
});

describe('subColumnLabel', () => {
  it('relabels the bare element-name column to "POSM type"', () => {
    expect(subColumnLabel('Element 1')).toBe('POSM type');
    expect(subColumnLabel('Element 2')).toBe('POSM type');
  });

  it('strips the "Element N" prefix from element sub-columns', () => {
    expect(subColumnLabel('Element 1 Recce Status')).toBe('Recce Status');
    expect(subColumnLabel('Element 2 Recce and Installation distance')).toBe('Recce and Installation distance');
  });

  it('leaves non-element columns verbatim', () => {
    expect(subColumnLabel('Outlet Code')).toBe('Outlet Code');
    expect(subColumnLabel('ASM Approval Status')).toBe('ASM Approval Status');
  });
});
