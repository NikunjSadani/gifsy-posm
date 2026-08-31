import { describe, it, expect } from 'vitest';
import {
  groupRecces,
  findSiteRecce,
  rejectionLabel,
  RECCE_STATUS_ORDER,
  type RecceListRow,
  type RecceStatus,
} from '@/lib/field/recce-api';

/** Minimal recce-row factory for the grouping/lookup fixtures. */
function row(partial: Partial<RecceListRow> & Pick<RecceListRow, 'id' | 'status'>): RecceListRow {
  return {
    version: 1,
    site: { id: `site-${partial.id}`, code: `C${partial.id}`, name: `Site ${partial.id}`, town: null },
    posmCount: 1,
    geoFenceOk: true,
    distanceMeters: 0,
    capturedAt: null,
    receivedAt: '2026-01-01T00:00:00.000Z',
    rejectionReasonCode: null,
    ...partial,
  };
}

describe('groupRecces', () => {
  it('returns no groups for an empty list', () => {
    expect(groupRecces([])).toEqual([]);
  });

  it('orders groups by action priority (REJECTED → APPROVED → SUBMITTED) and drops empties', () => {
    const recces = [
      row({ id: '1', status: 'SUBMITTED' }),
      row({ id: '2', status: 'APPROVED' }),
      row({ id: '3', status: 'REJECTED' }),
    ];
    const groups = groupRecces(recces);
    expect(groups.map((g) => g.status)).toEqual(['REJECTED', 'APPROVED', 'SUBMITTED']);
  });

  it('only includes statuses that are present', () => {
    const groups = groupRecces([row({ id: '1', status: 'SUBMITTED' }), row({ id: '2', status: 'SUBMITTED' })]);
    expect(groups.map((g) => g.status)).toEqual(['SUBMITTED']);
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

  it('covers every RecceStatus in the order constant', () => {
    const all: RecceStatus[] = ['SUBMITTED', 'APPROVED', 'REJECTED'];
    expect([...RECCE_STATUS_ORDER].sort()).toEqual([...all].sort());
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
