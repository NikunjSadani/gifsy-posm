import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '@/lib/api-client';
import { fetchAnalyticsDrilldown } from '@/lib/analytics/api';

// Mock the shared client so we assert the exact URL the drill-down call builds.
vi.mock('@/lib/api-client', () => ({ api: { get: vi.fn() } }));

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockGet.mockReset();
  mockGet.mockResolvedValue({
    success: true,
    data: { items: [], byElementType: [], total: 0, limit: 200 },
  });
});

describe('fetchAnalyticsDrilldown', () => {
  it('builds the drill-down URL with the metric only', async () => {
    await fetchAnalyticsDrilldown('total-outlets');
    expect(mockGet).toHaveBeenCalledWith('/api/analytics/drilldown?metric=total-outlets');
  });

  it('includes a vendorId when provided (admin scorecard-row drill-down, scoped server-side)', async () => {
    await fetchAnalyticsDrilldown('recce', { vendorId: 'v-9', limit: 200 });
    expect(mockGet).toHaveBeenCalledWith('/api/analytics/drilldown?metric=recce&vendorId=v-9&limit=200');
  });

  it('resolves the HO-approved metric (previously a dead stage) through the dedicated endpoint', async () => {
    await fetchAnalyticsDrilldown('ho-approved', { limit: 200 });
    expect(mockGet).toHaveBeenCalledWith('/api/analytics/drilldown?metric=ho-approved&limit=200');
  });

  it('serialises the keyset afterId cursor for a subsequent page', async () => {
    await fetchAnalyticsDrilldown('installed', { afterId: 'id-42', limit: 200 });
    expect(mockGet).toHaveBeenCalledWith('/api/analytics/drilldown?metric=installed&afterId=id-42&limit=200');
  });

  it('passes the API response straight through', async () => {
    const res = await fetchAnalyticsDrilldown('pending-asm-review');
    expect(res.success).toBe(true);
  });
});
