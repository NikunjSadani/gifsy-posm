import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getOutletFilter,
  setOutletFilter,
  clearOutletFilter,
} from '@/lib/field/outlet-filter';

const KEY = 'kwality.field.outletFilter';

describe('outlet-filter (per-device RS code + Beat store)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('round-trips a set filter', () => {
    setOutletFilter({ rsCode: 'RS1', beatName: 'Beat A' });
    expect(getOutletFilter()).toEqual({ rsCode: 'RS1', beatName: 'Beat A' });
  });

  it('is null when unset', () => {
    expect(getOutletFilter()).toBeNull();
  });

  it('clears the stored filter', () => {
    setOutletFilter({ rsCode: 'RS1', beatName: 'Beat A' });
    clearOutletFilter();
    expect(getOutletFilter()).toBeNull();
  });

  it('treats a blank rsCode or beatName as unset', () => {
    localStorage.setItem(KEY, JSON.stringify({ rsCode: '', beatName: 'Beat A' }));
    expect(getOutletFilter()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ rsCode: 'RS1', beatName: '   ' }));
    expect(getOutletFilter()).toBeNull();
  });

  it('is null for malformed / non-object JSON', () => {
    localStorage.setItem(KEY, 'not json');
    expect(getOutletFilter()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify(['array']));
    expect(getOutletFilter()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ rsCode: 1, beatName: 2 }));
    expect(getOutletFilter()).toBeNull();
  });

  it('never throws when storage access throws (private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => getOutletFilter()).not.toThrow();
    expect(getOutletFilter()).toBeNull();

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => setOutletFilter({ rsCode: 'RS1', beatName: 'B' })).not.toThrow();

    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => clearOutletFilter()).not.toThrow();
  });
});
