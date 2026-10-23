import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '@/lib/api-client';
import { fetchRecords } from '@/lib/review/api';

// Mock the shared client so we assert the exact URL the records call builds.
vi.mock('@/lib/api-client', () => ({ api: { get: vi.fn() } }));

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockGet.mockReset();
  mockGet.mockResolvedValue({
    success: true,
    data: { items: [], byElementType: [], total: 0, page: 1, limit: 200 },
  });
});

describe('fetchRecords', () => {
  it('builds the records URL with the stage only', async () => {
    await fetchRecords('outlets');
    expect(mockGet).toHaveBeenCalledWith('/api/approval/records?stage=outlets');
  });

  it('includes page and limit when provided (stage always first)', async () => {
    await fetchRecords('pending-install', { page: 2, limit: 50 });
    expect(mockGet).toHaveBeenCalledWith('/api/approval/records?stage=pending-install&page=2&limit=50');
  });

  it('includes only limit when page is omitted', async () => {
    await fetchRecords('recce', { limit: 200 });
    expect(mockGet).toHaveBeenCalledWith('/api/approval/records?stage=recce&limit=200');
  });

  it('serialises page 0 (does not treat 0 as absent)', async () => {
    await fetchRecords('installed', { page: 0 });
    expect(mockGet).toHaveBeenCalledWith('/api/approval/records?stage=installed&page=0');
  });

  it('passes the API response straight through', async () => {
    const res = await fetchRecords('asm-approved');
    expect(res.success).toBe(true);
  });
});
