import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the network edge so we can assert the exact URLs the fetch helpers build.
const { get } = vi.hoisted(() => ({
  get: vi.fn((_url: string) => Promise.resolve({ success: true, data: {} })),
}));
vi.mock('@/lib/api-client', () => ({ api: { get, post: vi.fn() } }));

import { fetchSites, fetchRsCodes, fetchBeats } from '@/lib/field/sites';

describe('fetchSites — query building', () => {
  beforeEach(() => get.mockClear());
  const urlOf = () => get.mock.calls[0][0] as string;

  it('sends beatName (exact filter) when set', () => {
    void fetchSites({ rsCode: 'RS1', beatName: 'Beat A', pendingRecce: true });
    const url = urlOf();
    expect(url).toContain('rsCode=RS1');
    expect(url).toContain('beatName=Beat+A');
    expect(url).toContain('pendingRecce=true');
  });

  it('omits beatName when not set', () => {
    void fetchSites({ rsCode: 'RS1' });
    expect(urlOf()).not.toContain('beatName=');
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
