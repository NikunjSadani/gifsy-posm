import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

// Mock the report API so the screen mounts without a network call. One empty page keeps the
// table in its empty state while the filter row still renders (what we assert on).
const fetchOutletReport = vi.fn();
const downloadOutletReportXlsx = vi.fn();
const downloadOutletReportPptx = vi.fn();
vi.mock('@/lib/reports/outlet-execution', () => ({
  fetchOutletReport: (...a: unknown[]) => fetchOutletReport(...a),
  downloadOutletReportXlsx: (...a: unknown[]) => downloadOutletReportXlsx(...a),
  downloadOutletReportPptx: (...a: unknown[]) => downloadOutletReportPptx(...a),
  PPTX_MAX_OUTLETS: 3,
}));

// The vendors-master list is admin-only — assert it is fetched for the admin mount and NOT for
// the vendor mount.
const vendorsList = vi.fn();
vi.mock('@/lib/admin/api', () => ({
  vendorsApi: { list: (...a: unknown[]) => vendorsList(...a) },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { RecceReportScreen } from '../recce-report-screen';

beforeEach(() => {
  fetchOutletReport.mockResolvedValue({
    success: true,
    data: { columns: [], rows: [], total: 0, page: 1, limit: 50 },
  });
  vendorsList.mockResolvedValue({ success: true, data: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RecceReportScreen (shared, role-agnostic)', () => {
  it('admin mount shows the vendor filter and fetches the vendors-master list', async () => {
    render(<RecceReportScreen />);
    // Shared heading renders for both mounts.
    expect(screen.getByRole('heading', { name: 'Recce Report' })).toBeInTheDocument();
    // The vendor filter dropdown is present (its "All vendors" option).
    expect(screen.getByText('All vendors')).toBeInTheDocument();
    await waitFor(() => expect(vendorsList).toHaveBeenCalledTimes(1));
    // The report itself is fetched (server-scoped).
    await waitFor(() => expect(fetchOutletReport).toHaveBeenCalled());
  });

  it('vendor mount (showVendorFilter=false) hides the vendor filter and never fetches the vendors-master list', async () => {
    render(<RecceReportScreen showVendorFilter={false} />);
    expect(screen.getByRole('heading', { name: 'Recce Report' })).toBeInTheDocument();
    // No vendor dropdown for a single-fleet vendor.
    expect(screen.queryByText('All vendors')).toBeNull();
    // The admin-only vendors-master endpoint is never called.
    await waitFor(() => expect(fetchOutletReport).toHaveBeenCalled());
    expect(vendorsList).not.toHaveBeenCalled();
  });
});
