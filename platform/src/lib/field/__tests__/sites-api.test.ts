import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the network edge so we can assert the exact URLs the fetch helpers build.
const { get } = vi.hoisted(() => ({
  get: vi.fn((_url: string): Promise<unknown> => Promise.resolve({ success: true, data: {} })),
}));
vi.mock('@/lib/api-client', () => ({ api: { get, post: vi.fn() } }));

import { fetchSites, fetchRsCodes, fetchBeats, fetchAllSites, SITES_PAGE_SIZE } from '@/lib/field/sites';

describe('fetchSites — query building', () => {
  beforeEach(() => get.mockClear());
  const urlOf = () => get.mock.calls[0][0] as string;

  it('sends each selected beat as a repeated beatNames param', () => {
    void fetchSites({ rsCode: 'RS1', beatNames: ['Beat A', 'Beat B'], pendingRecce: true });
    const url = urlOf();
    expect(url).toContain('rsCode=RS1');
    expect(url).toContain('beatNames=Beat+A');
    expect(url).toContain('beatNames=Beat+B');
    expect(url).toContain('pendingRecce=true');
  });

  it('omits beatNames when none set (empty or absent)', () => {
    void fetchSites({ rsCode: 'RS1', beatNames: [] });
    expect(urlOf()).not.toContain('beatNames=');
    get.mockClear();
    void fetchSites({ rsCode: 'RS1' });
    expect(urlOf()).not.toContain('beatNames=');
  });

  it('no longer sends the legacy single beatName param', () => {
    void fetchSites({ rsCode: 'RS1', beatNames: ['Beat A'] });
    expect(urlOf()).not.toContain('beatName=Beat');
  });
});

describe('fetchAllSites — drains every page before returning', () => {
  beforeEach(() => get.mockReset());

  const fakeSite = (id: string) => ({ id, code: id, name: id, lat: null, lng: null });

  it('pages through until the server runs out, merging all rows', async () => {
    // Page 1 is full (SITES_PAGE_SIZE rows) → another fetch; page 2 is short → stop.
    const pageFull = Array.from({ length: SITES_PAGE_SIZE }, (_, i) => fakeSite(`p1-${i}`));
    const pageTail = [fakeSite('p2-0'), fakeSite('p2-1')];
    const total = SITES_PAGE_SIZE + pageTail.length;
    get.mockImplementation((url: string) => {
      const page = Number(new URL(url, 'http://x').searchParams.get('page'));
      const sites = page === 1 ? pageFull : pageTail;
      return Promise.resolve({ success: true, data: { sites, total, page, limit: SITES_PAGE_SIZE } });
    });

    const res = await fetchAllSites({ rsCode: 'RS1' });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.sites).toHaveLength(total);
      expect(res.data.total).toBe(total);
    }
    expect(get).toHaveBeenCalledTimes(2); // page 1 (full) + page 2 (short → stop)
  });

  it('stops after one page when the first page already covers the total', async () => {
    const sites = [fakeSite('a'), fakeSite('b')];
    get.mockResolvedValue({ success: true, data: { sites, total: 2, page: 1, limit: SITES_PAGE_SIZE } });
    const res = await fetchAllSites({ rsCode: 'RS1' });
    expect(get).toHaveBeenCalledTimes(1);
    if (res.success) expect(res.data.sites).toHaveLength(2);
  });

  it('short-circuits to the error when a page fails (no partial sort)', async () => {
    get.mockResolvedValue({ success: false, error: 'boom', status: 500 });
    const res = await fetchAllSites({ rsCode: 'RS1' });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe('boom');
  });
});

describe('fetchRsCodes / fetchBeats — filter-option endpoints', () => {
  beforeEach(() => get.mockClear());

  it('fetchRsCodes hits the rs-codes endpoint', () => {
    void fetchRsCodes();
    expect(get).toHaveBeenCalledWith('/api/sites/filter-options/rs-codes');
  });

  it('fetchBeats url-encodes the rsCode', () => {
    void fetchBeats('RS/1 A');
    expect(get).toHaveBeenCalledWith('/api/sites/filter-options/beats?rsCode=RS%2F1%20A');
  });
});
