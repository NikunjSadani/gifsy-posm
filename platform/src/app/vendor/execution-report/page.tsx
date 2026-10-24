'use client';

/**
 * Vendor Recce Report (`/vendor/execution-report`) — the VENDOR_HO-facing mount of the shared
 * {@link RecceReportScreen}. The vendor sees the SAME recce/installed toggle, table, Excel + PPT as
 * the admin, but the backend confines every endpoint (JSON / .xlsx / .pptx) to THIS vendor's own
 * fleet (fail-closed), so the data returned is only their outlets. The vendor filter is hidden (a
 * single fleet has nothing to pick, and the vendors-master list is admin-only); this is purely
 * cosmetic — the server scoping holds regardless.
 *
 * Guarded by the `/vendor` layout (RequireAuth → PORTAL_ROLES.vendor = [VENDOR_HO]) + the edge
 * proxy (ROLE_ROUTES['/vendor'] matches this sub-route by prefix).
 */

import { RecceReportScreen } from '@/components/reports/recce-report-screen';

export default function VendorExecutionReportPage() {
  return <RecceReportScreen showVendorFilter={false} />;
}
