/* ─── Admin route → required-permission map (chassis) ─────────────────────────
   Each admin route (and its child paths) maps to the permission key the backend catalog
   requires. A user who lacks the mapped permission for the route they land on is shown
   <AccessDenied/> by the AdminRouteGuard — the nav item stays visible; accessing it lands
   on a clear message rather than a raw 403.

   The loyalty catalog (KYC/SCHEMES/CREDITS/PAYOUTS/TDS…) is stripped. This ships with a
   minimal POSM placeholder; add routes here as the admin surfaces land in later waves.
   A route omitted from the map is ungated (fail-open to the page — the backend still 403s).
─────────────────────────────────────────────────────────────────────────────── */

/**
 * Route-prefix → permission. Keys are matched most-specific-first: a pathname matches a key
 * when it equals the key OR starts with `key + '/'`, and the LONGEST matching key wins.
 */
export const ROUTE_PERMISSIONS: Record<string, string> = {
  // Masters (vendors / sites / POSM types) — Wave 1.
  '/admin/vendors': 'vendors:read',
  '/admin/sites': 'sites:read',
  '/admin/posm-types': 'posm_types:read',
  // Reporting & analytics — later waves.
  '/admin/reports': 'reports:read',
};

/**
 * Resolve the permission required to VIEW the given admin path, or null when the path is
 * intentionally ungated (fail-open) or unknown. Most-specific (longest) matching key wins;
 * matching uses an exact hit or a '/'-boundary prefix so a deep sub-path inherits its
 * section's permission.
 */
export function requiredPermissionForPath(pathname: string): string | null {
  let bestKey: string | null = null;
  for (const key of Object.keys(ROUTE_PERMISSIONS)) {
    if (pathname === key || pathname.startsWith(key + '/')) {
      if (bestKey === null || key.length > bestKey.length) bestKey = key;
    }
  }
  return bestKey ? ROUTE_PERMISSIONS[bestKey] : null;
}
