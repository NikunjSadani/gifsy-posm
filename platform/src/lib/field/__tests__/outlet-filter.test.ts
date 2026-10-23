import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getOutletFilter,
  setOutletFilter,
  clearOutletFilter,
  beatSummary,
} from '@/lib/field/outlet-filter';

const KEY = 'kwality.field.outletFilter';

describe('outlet-filter (per-device RS code + optional multi-Beat store)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('round-trips a set filter with multiple beats', () => {
    setOutletFilter({ rsCode: 'RS1', beatNames: ['Beat A', 'Beat B'] });
    expect(getOutletFilter()).toEqual({ rsCode: 'RS1', beatNames: ['Beat A', 'Beat B'] });
  });

  it('round-trips a set filter with no beats (beats optional)', () => {
    setOutletFilter({ rsCode: 'RS1', beatNames: [] });
    expect(getOutletFilter()).toEqual({ rsCode: 'RS1', beatNames: [] });
  });

  it('is null when unset', () => {
    expect(getOutletFilter()).toBeNull();
  });

  it('clears the stored filter', () => {
    setOutletFilter({ rsCode: 'RS1', beatNames: ['Beat A'] });
    clearOutletFilter();
    expect(getOutletFilter()).toBeNull();
  });

  it('treats a blank/missing rsCode as unset (beats no longer required)', () => {
    localStorage.setItem(KEY, JSON.stringify({ rsCode: '', beatNames: ['Beat A'] }));
    expect(getOutletFilter()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ rsCode: '   ', beatNames: [] }));
    expect(getOutletFilter()).toBeNull();
    // rsCode set but no beats → valid (beats optional).
    localStorage.setItem(KEY, JSON.stringify({ rsCode: 'RS1' }));
    expect(getOutletFilter()).toEqual({ rsCode: 'RS1', beatNames: [] });
  });

  it('drops non-string / blank beat entries and defaults a bad beatNames to []', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ rsCode: 'RS1', beatNames: ['Beat A', '', '   ', 7, null, 'Beat B'] }),
    );
    expect(getOutletFilter()).toEqual({ rsCode: 'RS1', beatNames: ['Beat A', 'Beat B'] });
    localStorage.setItem(KEY, JSON.stringify({ rsCode: 'RS1', beatNames: 'not-an-array' }));
    expect(getOutletFilter()).toEqual({ rsCode: 'RS1', beatNames: [] });
  });

  it('migrates a legacy { rsCode, beatName } value to { rsCode, beatNames: [beatName] }', () => {
    localStorage.setItem(KEY, JSON.stringify({ rsCode: 'RS1', beatName: 'Beat A' }));
    expect(getOutletFilter()).toEqual({ rsCode: 'RS1', beatNames: ['Beat A'] });
    // Legacy blank beatName → empty beats (still valid, rsCode present).
    localStorage.setItem(KEY, JSON.stringify({ rsCode: 'RS1', beatName: '  ' }));
    expect(getOutletFilter()).toEqual({ rsCode: 'RS1', beatNames: [] });
  });

  it('is null for malformed / non-object JSON', () => {
    localStorage.setItem(KEY, 'not json');
    expect(getOutletFilter()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify(['array']));
    expect(getOutletFilter()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ rsCode: 1, beatNames: [] }));
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
    expect(() => setOutletFilter({ rsCode: 'RS1', beatNames: ['B'] })).not.toThrow();

    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => clearOutletFilter()).not.toThrow();
  });
});

describe('beatSummary', () => {
  it('is "All beats" when none selected', () => {
    expect(beatSummary([])).toBe('All beats');
  });
  it('is the single beat name when one selected', () => {
    expect(beatSummary(['Beat A'])).toBe('Beat A');
  });
  it('is "N beats" when several selected', () => {
    expect(beatSummary(['Beat A', 'Beat B', 'Beat C'])).toBe('3 beats');
  });
});
