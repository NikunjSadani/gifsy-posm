'use client';

/**
 * Field PWA shell — the vendor's mobile app frame.
 *
 * - Guards the whole `/field/*` tree to the vendor roles (VENDOR_FIELD / VENDOR_HO). The
 *   edge proxy already role-gates the page navigation; this client guard is the in-app
 *   mirror that bounces a wrong-role/no-session user before any field UI renders.
 * - Sticky red Kwality header + a mobile `max-w-md` column + a bottom nav (Recce to do · Nearby ·
 *   Tasks · Installation). Content is padded to clear the fixed bottom nav + iOS safe-area.
 */

import { MapPin, Compass, Wrench, ListChecks } from 'lucide-react';
import { RequireAuth } from '@/components/auth/require-auth';
import { NavBottom, type NavItem } from '@/components/layout/nav-bottom';
import { FieldHeader } from '@/components/field/field-header';
import { InstallPrompt } from '@/components/pwa/install-prompt';
import { FIELD_ROLES } from '@/lib/field/config';

const NAV: NavItem[] = [
  { href: '/field/sites', label: 'Recce to do', icon: MapPin },
  { href: '/field/nearby', label: 'Nearby', icon: Compass },
  { href: '/field/tasks', label: 'Tasks', icon: ListChecks },
  { href: '/field/work', label: 'Installation', icon: Wrench },
];

export default function FieldLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth allowedRoles={[...FIELD_ROLES]}>
      <div className="min-h-screen flex flex-col bg-gray-50">
        <FieldHeader />
        <main
          className="flex-1 w-full max-w-md mx-auto"
          style={{ paddingBottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
        >
          {children}
        </main>
        <NavBottom items={NAV} />
        <InstallPrompt />
      </div>
    </RequireAuth>
  );
}
