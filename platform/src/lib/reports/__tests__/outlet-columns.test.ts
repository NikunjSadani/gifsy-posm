import { describe, it, expect } from 'vitest';
import {
  groupOutletColumns,
  flatColumns,
  displayOrder,
  GROUP_LABELS,
} from '../outlet-columns';
import type { Column, ColumnGroup } from '../outlet-execution';

/** The curated server column set (mirrors the BE contract). The audit-trail columns are
 *  `excelOnly` — present in the payload for the .xlsx export, omitted from the on-screen table. */
const SPEC_COLUMNS: Column[] = [
  { key: 'outletCode', label: 'Outlet Code', group: 'outlet', pinned: true },
  { key: 'outletName', label: 'Outlet Name', group: 'outlet', pinned: true },
  { key: 'town', label: 'Town', group: 'location' },
  { key: 'state', label: 'State', group: 'location' },
  { key: 'rs', label: 'RS Code', group: 'location' },
  { key: 'outletType', label: 'Outlet Type', group: 'profile' },
  { key: 'source', label: 'Source', group: 'profile' },
  { key: 'recceDate', label: 'Recce Date', group: 'profile' },
  { key: 'promoter', label: 'Promoter', group: 'profile' },
  { key: 'el1Type', label: 'Type', group: 'element1' },
  { key: 'el1Dims', label: 'Dimensions', group: 'element1' },
  { key: 'el1RecceStatus', label: 'Recce Status', group: 'element1' },
  { key: 'el1Photo', label: 'Photo', group: 'element1' },
  { key: 'el2Type', label: 'Type', group: 'element2' },
  { key: 'el2Dims', label: 'Dimensions', group: 'element2' },
  { key: 'el2RecceStatus', label: 'Recce Status', group: 'element2' },
  { key: 'el2Photo', label: 'Photo', group: 'element2' },
  { key: 'recceStatus', label: 'Recce Status', group: 'overall' },
  { key: 'asmApprover', label: 'ASM Approver', group: 'audit', excelOnly: true },
  { key: 'asmApprovedAt', label: 'ASM Approved At', group: 'audit', excelOnly: true },
  { key: 'hoApprover', label: 'HO Approver', group: 'audit', excelOnly: true },
];

describe('groupOutletColumns (server-driven grouping)', () => {
  const groups = groupOutletColumns(SPEC_COLUMNS);

  it('emits the visible groups in canonical order, labelled', () => {
    expect(groups.map((g) => g.group)).toEqual([
      'outlet', 'location', 'profile', 'element1', 'element2', 'overall',
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      GROUP_LABELS.outlet, GROUP_LABELS.location, GROUP_LABELS.profile,
      GROUP_LABELS.element1, GROUP_LABELS.element2, GROUP_LABELS.overall,
    ]);
  });

  it('drops the all-excelOnly audit group from the on-screen view', () => {
    expect(groups.find((g) => g.group === 'audit')).toBeUndefined();
    expect(displayOrder(groups)).not.toContain('asmApprover');
  });

  it('marks only the all-pinned identity group as pinned', () => {
    const outlet = groups.find((g) => g.group === 'outlet')!;
    expect(outlet.pinned).toBe(true);
    expect(outlet.columns.map((c) => c.key)).toEqual(['outletCode', 'outletName']);
    expect(groups.filter((g) => g.group !== 'outlet').every((g) => !g.pinned)).toBe(true);
  });

  it('preserves the server order within a group', () => {
    const el1 = groups.find((g) => g.group === 'element1')!;
    expect(el1.columns.map((c) => c.key)).toEqual(['el1Type', 'el1Dims', 'el1RecceStatus', 'el1Photo']);
  });

  it('keeps every visible column exactly once (nothing dropped/duplicated)', () => {
    const flat = displayOrder(groups);
    const visibleKeys = SPEC_COLUMNS.filter((c) => !c.excelOnly).map((c) => c.key);
    expect([...flat].sort()).toEqual([...visibleKeys].sort());
    expect(new Set(flat).size).toBe(flat.length);
  });

  it('keeps an unknown/future group — appended after the known ones, never dropped', () => {
    const extra: Column = { key: 'future', label: 'Future', group: 'mystery' as ColumnGroup };
    const groups2 = groupOutletColumns([...SPEC_COLUMNS, extra]);
    const last = groups2[groups2.length - 1];
    expect(last.group).toBe('mystery');
    expect(last.columns.map((c) => c.key)).toEqual(['future']);
    expect(displayOrder(groups2)).toContain('future');
  });

  it('omits groups that have only excelOnly columns but keeps partially-visible ones', () => {
    const mixed: Column[] = [
      { key: 'a', label: 'A', group: 'overall' },
      { key: 'b', label: 'B', group: 'overall', excelOnly: true },
    ];
    const g = groupOutletColumns(mixed);
    const overall = g.find((x) => x.group === 'overall')!;
    expect(overall.columns.map((c) => c.key)).toEqual(['a']);
  });
});

describe('flatColumns', () => {
  const flat = flatColumns(groupOutletColumns(SPEC_COLUMNS));

  it('assigns a 0-based pinIndex to pinned columns and -1 to the rest', () => {
    expect(flat.find((c) => c.column.key === 'outletCode')!.pinIndex).toBe(0);
    expect(flat.find((c) => c.column.key === 'outletName')!.pinIndex).toBe(1);
    expect(flat.find((c) => c.column.key === 'town')!.pinIndex).toBe(-1);
  });

  it('flags the first column of each non-first group as a group boundary', () => {
    expect(flat.find((c) => c.column.key === 'outletCode')!.groupStart).toBe(false); // first group
    expect(flat.find((c) => c.column.key === 'town')!.groupStart).toBe(true); // location starts
    expect(flat.find((c) => c.column.key === 'state')!.groupStart).toBe(false); // mid-group
    expect(flat.find((c) => c.column.key === 'el1Type')!.groupStart).toBe(true); // element1 starts
  });
});
