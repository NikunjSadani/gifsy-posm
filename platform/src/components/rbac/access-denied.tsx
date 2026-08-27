'use client';

/* ─── RBAC Option-X P6 — AccessDenied / PermissionsLoadError panels ─────────────
   Page-level fallbacks shown to a GIFSY_STAFF operator inside the admin shell:
     - <AccessDenied/>          → the route's permission is genuinely NOT in their role.
     - <PermissionsLoadError/>  → their permissions couldn't be LOADED (transient) — a retry
                                   state, NEVER misdiagnosed as a denial (MED-1).
   The nav item stays visible; accessing it lands here with a CLEAR message (not a raw error).

   Light idiom — these render in the admin MAIN content region (bg-gray-50, white cards), so
   they match the content surface, not the dark sidebar (LOW-2).
─────────────────────────────────────────────────────────────────────────────── */

import { ShieldAlert, RefreshCw } from 'lucide-react';

export interface AccessDeniedProps {
  /** Optional override for the body copy (defaults to the standard staff message). */
  message?: string;
}

export function AccessDenied({ message }: AccessDeniedProps) {
  return (
    <div role="alert" className="flex flex-1 items-center justify-center py-16 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white border border-gray-200 shadow-sm px-8 py-10 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50">
          <ShieldAlert className="h-7 w-7 text-amber-500" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900">
          You don&apos;t have permission to access this
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          {message ?? "Your role doesn't include access to this page. Ask your admin to grant it."}
        </p>
      </div>
    </div>
  );
}

/**
 * Shown when a staff member's permissions could not be fetched (network/transient) — distinct
 * from a genuine denial so we never tell a legitimate operator "ask your admin" for a blip.
 */
export function PermissionsLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-1 items-center justify-center py-16 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white border border-gray-200 shadow-sm px-8 py-10 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
          <RefreshCw className="h-7 w-7 text-gray-500" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900">Couldn&apos;t load your permissions</h2>
        <p className="mt-2 text-sm text-gray-500">
          This is a temporary problem, not a permissions issue. Please try again.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
        >
          <RefreshCw className="h-4 w-4" /> Retry
        </button>
      </div>
    </div>
  );
}

export default AccessDenied;
