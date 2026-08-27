'use client';

/* ─── RBAC Option-X P6 — admin page-level guard ────────────────────────────────
   Wraps the admin shell's page content. For a GIFSY_STAFF who lands on a route
   whose mapped permission (route-permissions.ts) they lack, it renders
   <AccessDenied/> INSTEAD of the page. The nav item stays visible — this only
   changes what the PAGE shows.

   INERT for every non-staff role: usePermissions().has() returns true for the
   owner and all other roles, so this guard always renders children for them
   (the top risk — non-staff being wrongly blocked — cannot occur here).
─────────────────────────────────────────────────────────────────────────────── */

import { usePathname } from 'next/navigation';
import { usePermissions } from '@/lib/use-permissions';
import { requiredPermissionForPath } from '@/lib/rbac/route-permissions';
import { AccessDenied } from '@/components/rbac/access-denied';
import { PermissionsLoadError } from '@/components/rbac/access-denied';

export function AdminRouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { has, ready, error, retry } = usePermissions();
  const required = requiredPermissionForPath(pathname);

  // has() is true for every non-staff role, so this branch only ever engages for a
  // GIFSY_STAFF who lacks the mapped permission. Ungated routes (required === null)
  // always fall through to the page.
  if (required && !has(required)) {
    // MED-1: a TRANSIENT permission-load failure is NOT a denial — offer a retry, don't
    // misdiagnose it as "ask your admin". (error is only ever true for a staff whose /me failed.)
    if (error) return <PermissionsLoadError onRetry={retry} />;
    // Staff permissions still resolving → render nothing (avoid a flash of the page
    // or of AccessDenied) until we can make a real decision.
    if (!ready) return null;
    return <AccessDenied />;
  }

  return <>{children}</>;
}

export default AdminRouteGuard;
