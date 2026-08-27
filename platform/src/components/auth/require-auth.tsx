'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredUser, getRoleHome } from '@/lib/auth-client';

/**
 * Client-side route guard. Renders its children only when (a) a session token is present and
 * (b) — when `allowedRoles` is given — the logged-in user's role is admitted by this portal.
 * Otherwise it redirects: no token → /auth/login; wrong role → the user's OWN home (keeping the
 * session, so it's an authz bounce, not a logout). Wrap each portal layout's content with it and
 * pass that portal's roles (gap #41 — a role must not load another portal).
 *
 * Auth is an httpOnly `token` cookie (AF-6) — not JS-readable — so this guard checks the
 * NON-sensitive stored `user` for presence/role. The real enforcement is the edge proxy +
 * backend; a guard that passes here without a valid cookie still gets bounced on the first 401.
 */
export function RequireAuth({
  children,
  allowedRoles,
}: {
  children: React.ReactNode;
  allowedRoles?: string[];
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  // Stable dep so an inline array prop doesn't churn the effect.
  const rolesKey = allowedRoles ? allowedRoles.join(',') : '';

  useEffect(() => {
    const user = getStoredUser();
    if (!user) {
      router.replace('/auth/login');
      return;
    }
    if (rolesKey) {
      const role = user.role;
      if (!role || !rolesKey.split(',').includes(role)) {
        router.replace(getRoleHome(role));
        return;
      }
    }
    setReady(true);
  }, [router, rolesKey]);

  if (!ready) return null;
  return <>{children}</>;
}
