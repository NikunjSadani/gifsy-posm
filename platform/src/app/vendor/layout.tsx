'use client';

/**
 * VENDOR-HO console shell (`/vendor/*`).
 *
 * - Guards the whole tree to the vendor role (VENDOR_HO). The edge proxy already role-gates
 *   `/vendor` navigation (proxy.ts ROLE_ROUTES); this client guard is the in-app mirror that
 *   bounces a wrong-role / no-session user before any console UI renders.
 * - Sticky red Kwality header + a `max-w-6xl` content rail (same width as the admin dashboard,
 *   since it reuses the same analytics widgets).
 */

import { RequireAuth } from '@/components/auth/require-auth';
import { PORTAL_ROLES } from '@/lib/auth-client';
import { VendorHeader } from '@/components/vendor/vendor-header';

export default function VendorLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth allowedRoles={PORTAL_ROLES.vendor}>
      <div className="min-h-screen flex flex-col bg-gray-50">
        <VendorHeader />
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6">{children}</main>
      </div>
    </RequireAuth>
  );
}
