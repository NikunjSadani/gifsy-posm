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
    data: { items: [], byElementType: [], total: 0, limit: 200 },
  });
});

describe('fetchRecords', () => {
  it('builds the records URL with the stage only', async () => {
    await fetchRecords('outlets');
    expect(mockGet).toHaveBeenCalledWith('/api/approval/records?stage=outlets');
  });

  it('includes the keyset afterId cursor and limit when provided (stage always first)', async () => {
    await fetchRecords('pending-install', { afterId: 'id-7', limit: 50 });
    expect(mockGet).toHaveBeenCalledWith('/api/approval/records?stage=pending-install&afterId=id-7&limit=50');
  });

  it('includes only limit when afterId is omitted (first page)', async () => {
    await fetchRecords('recce', { limit: 200 });
    expect(mockGet).toHaveBeenCalledWith('/api/approval/records?stage=recce&limit=200');
  });

  it('drops a blank afterId', async () => {
    await fetchRecords('installed', { afterId: '  ' });
    expect(mockGet).toHaveBeenCalledWith('/api/approval/records?stage=installed');
  });

  it('passes the API response straight through', async () => {
    const res = await fetchRecords('asm-approved');
    expect(res.success).toBe(true);
  });
});
