'use client';

/**
 * ASM approval console shell (`/review/*`).
 *
 * - Guards the whole tree to the review roles (ASM / CLIENT_ADMIN / GIFSY_ADMIN). The edge
 *   proxy already role-gates `/review` navigation (proxy.ts ROLE_ROUTES); this client guard is
 *   the in-app mirror that bounces a wrong-role / no-session user before any console UI renders.
 * - Sticky red Kwality header + a comfortable desktop/tablet `max-w-5xl` rail.
 * - Toasts render via the single app-wide react-hot-toast <Toaster/> in the root layout.
 */

import { RequireAuth } from '@/components/auth/require-auth';
import { PORTAL_ROLES } from '@/lib/auth-client';
import { ReviewHeader } from '@/components/review/review-header';

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth allowedRoles={PORTAL_ROLES.review}>
      <div className="min-h-screen flex flex-col bg-gray-50">
        <ReviewHeader />
        <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6">{children}</main>
      </div>
    </RequireAuth>
  );
}
