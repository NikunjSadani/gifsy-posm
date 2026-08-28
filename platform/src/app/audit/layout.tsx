'use client';

/**
 * Auditor console shell.
 *
 * Guards the whole `/audit/*` tree to the audit roles (AUDITOR / CLIENT_ADMIN / GIFSY_ADMIN).
 * The edge proxy already role-gates the page navigation (ROLE_ROUTES `/audit`); this client
 * guard is the in-app mirror that bounces a wrong-role/no-session user before any audit UI
 * renders. Desktop/tablet layout: sticky Kwality header + a `max-w-5xl` review column.
 */

import { RequireAuth } from '@/components/auth/require-auth';
import { PORTAL_ROLES } from '@/lib/auth-client';
import { AuditHeader } from '@/components/audit/audit-header';

export default function AuditLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth allowedRoles={PORTAL_ROLES.audit}>
      <div className="min-h-screen flex flex-col bg-gray-50">
        <AuditHeader />
        <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-5">{children}</main>
      </div>
    </RequireAuth>
  );
}
