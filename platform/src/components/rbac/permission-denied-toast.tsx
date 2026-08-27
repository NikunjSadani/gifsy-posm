'use client';

/* ─── RBAC Option-X P6 — global 403 fallback toast ─────────────────────────────
   Last-line UX over the backend's enforcement: when an authenticated /api/* call
   returns 403 (Forbidden), the global fetch patch in SessionExpiryGuard dispatches
   an `api:forbidden` CustomEvent. This listener turns that into a clear toast —
   "You don't have permission to do that" — instead of leaving a raw error on screen.

   Scoped to GIFSY_STAFF ONLY (per the P6 owner decision): a 403 that reaches a
   non-staff user is not part of this feature, so no toast fires for them. Mounted
   once, app-wide, inside ToastProvider.
─────────────────────────────────────────────────────────────────────────────── */

import { useEffect } from 'react';
import { useToast } from '@/components/ui/toast';
import { getStoredUser } from '@/lib/auth-client';
import { STAFF_ROLE } from '@/lib/use-permissions';

export default function PermissionDeniedToast() {
  const { error } = useToast();

  useEffect(() => {
    // Coalesce a burst of concurrent 403s into a single toast.
    let lastShown = 0;
    const onForbidden = () => {
      if (getStoredUser()?.role !== STAFF_ROLE) return; // staff-only, per P6
      const now = Date.now();
      if (now - lastShown < 1500) return;
      lastShown = now;
      error(
        "You don't have permission to do that",
        'Your role doesn’t include this action. Ask your admin to grant it.',
      );
    };
    window.addEventListener('api:forbidden', onForbidden);
    return () => window.removeEventListener('api:forbidden', onForbidden);
  }, [error]);

  return null;
}
