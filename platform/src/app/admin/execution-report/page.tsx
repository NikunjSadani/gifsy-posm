'use client';

/**
 * Admin Recce Report (`/admin/execution-report`) — the admin-facing mount of the shared
 * {@link RecceReportScreen}. Behavior is unchanged from when this screen lived inline here: the
 * vendor filter is shown (admin default) and the backend tenant-scopes the admin caller. The whole
 * screen is now a shared component so the vendor portal (`/vendor/execution-report`) can reuse it
 * verbatim, with scoping enforced server-side for each role.
 */

import { RecceReportScreen } from '@/components/reports/recce-report-screen';

export default function ExecutionReportPage() {
  return <RecceReportScreen />;
}
