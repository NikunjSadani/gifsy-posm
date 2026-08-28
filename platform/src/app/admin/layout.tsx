'use client';

/**
 * Admin masters shell (desktop-first).
 *
 * - Guards the whole `/admin/*` tree to the admin roles (GIFSY_ADMIN / CLIENT_ADMIN). The
 *   edge proxy already role-gates page navigation (ROLE_ROUTES['/admin']); this client guard
 *   is the in-app mirror that bounces a wrong-role/no-session user before any masters UI renders.
 * - Sticky red Kwality header + a horizontal tab bar (Overview · Vendors · Users · POSM Types ·
 *   Sites) + a max-w-6xl content column.
 */

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, LayoutGrid, Building2, Users, Tags, MapPin, ClipboardList, BarChart3 } from 'lucide-react';
import { RequireAuth } from '@/components/auth/require-auth';
import { logout } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

const ADMIN_ROLES = ['GIFSY_ADMIN', 'CLIENT_ADMIN'];

const TABS = [
  { href: '/admin', label: 'Overview', icon: LayoutGrid, exact: true },
  { href: '/admin/vendors', label: 'Vendors', icon: Building2 },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/posm-types', label: 'POSM Types', icon: Tags },
  { href: '/admin/sites', label: 'Sites', icon: MapPin },
  { href: '/admin/manual', label: 'Manual tasks', icon: ClipboardList },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <RequireAuth allowedRoles={ADMIN_ROLES}>
      <div className="min-h-screen flex flex-col bg-gray-50">
        {/* Sticky red header */}
        <header className="bg-[var(--brand-primary)] shadow-lg sticky top-0 z-40">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="bg-white rounded-xl px-2 py-1 shadow-sm shrink-0">
                <Image src="/kwality-walls-logo.png" alt="Kwality Wall's" width={44} height={44} priority />
              </div>
              <div className="min-w-0">
                <p className="text-white font-black text-sm tracking-wide leading-tight truncate">
                  Field Execution — Admin
                </p>
                <p className="text-[var(--brand-accent)] text-[10px] font-semibold tracking-widest uppercase">
                  Masters &amp; Configuration
                </p>
              </div>
            </div>
            <button
              onClick={() => logout()}
              className="shrink-0 flex items-center gap-1.5 text-white/90 hover:text-white text-xs font-medium bg-white/10 hover:bg-white/20 rounded-xl px-2.5 py-2 active:scale-95 transition-all"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </header>

        {/* Tab bar */}
        <nav className="bg-white border-b border-gray-200 sticky top-[57px] z-30">
          <div className="max-w-6xl mx-auto px-2 sm:px-6 flex items-center gap-1 overflow-x-auto">
            {TABS.map((t) => {
              const active = isActive(t.href, t.exact);
              const Icon = t.icon;
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-3 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
                    active
                      ? 'border-[var(--brand-primary)] text-[var(--brand-primary)]'
                      : 'border-transparent text-gray-500 hover:text-gray-800',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6">{children}</main>
      </div>
    </RequireAuth>
  );
}
