'use client';

/**
 * Admin masters shell (desktop-first).
 *
 * - Guards the whole `/admin/*` tree to the admin roles (GIFSY_ADMIN / CLIENT_ADMIN). The
 *   edge proxy already role-gates page navigation (ROLE_ROUTES['/admin']); this client guard
 *   is the in-app mirror that bounces a wrong-role/no-session user before any masters UI renders.
 * - Sticky red Kwality header + a grouped LEFT sidebar (Overview · Masters · Operations · Reports,
 *   Settings pinned at the foot). The nav outgrew a horizontal tab bar at 11 items (the last tabs
 *   scrolled off-screen, hiding Settings); a grouped sidebar keeps every destination visible and
 *   gives the sections meaning. On < lg screens the sidebar collapses into a hamburger drawer.
 */

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LogOut, LayoutGrid, Building2, Users, Tags, MapPin, ClipboardList, BarChart3,
  Mail, Settings, HelpCircle, ShieldCheck, ClipboardCheck, FileSpreadsheet, Menu, X, type LucideIcon,
} from 'lucide-react';
import { RequireAuth } from '@/components/auth/require-auth';
import { logout } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

const ADMIN_ROLES = ['GIFSY_ADMIN', 'CLIENT_ADMIN'];

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}
interface NavSection {
  title?: string;
  items: NavItem[];
}

/** Grouped by the KIND of thing each destination is: a quick-glance home, reference data you set
 *  up once, the day-to-day work queues, then the read-outs. Settings lives in its own foot block. */
const SECTIONS: NavSection[] = [
  { items: [{ href: '/admin', label: 'Overview', icon: LayoutGrid, exact: true }] },
  {
    title: 'Masters',
    items: [
      { href: '/admin/vendors', label: 'Vendors', icon: Building2 },
      { href: '/admin/users', label: 'Users', icon: Users },
      { href: '/admin/posm-types', label: 'Element Types', icon: Tags },
      { href: '/admin/sites', label: 'Sites', icon: MapPin },
    ],
  },
  {
    title: 'Operations',
    items: [
      { href: '/admin/manual', label: 'Manual tasks', icon: ClipboardList },
      { href: '/admin/recce-ho-review', label: 'HO recce review', icon: ClipboardCheck },
      { href: '/admin/ho-review', label: 'HO review', icon: ShieldCheck },
    ],
  },
  {
    title: 'Reports',
    items: [
      { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/admin/execution-report', label: 'Execution report', icon: FileSpreadsheet },
      { href: '/admin/reports', label: 'Email reports', icon: Mail },
    ],
  },
];

const SETTINGS_ITEM: NavItem = { href: '/admin/settings', label: 'Settings', icon: Settings };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  // Close the mobile drawer whenever the route changes (a nav tap should not leave it open).
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const NavLink = ({ item }: { item: NavItem }) => {
    const active = isActive(item.href, item.exact);
    const Icon = item.icon;
    return (
      <Link
        href={item.href}
        className={cn(
          'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
          active
            ? 'bg-[var(--brand-primary)]/10 text-[var(--brand-primary)]'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
        )}
      >
        <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-[var(--brand-primary)]' : 'text-gray-400')} />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  };

  // The nav body — reused by the desktop rail and the mobile drawer so they never drift.
  const NavBody = () => (
    <>
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {SECTIONS.map((section, si) => (
          <div key={si} className="space-y-1">
            {section.title && (
              <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                {section.title}
              </p>
            )}
            {section.items.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </div>
        ))}
      </nav>
      {/* Settings pinned at the foot — a destination you visit occasionally, not part of the flow. */}
      <div className="border-t border-gray-200 px-3 py-3">
        <NavLink item={SETTINGS_ITEM} />
      </div>
    </>
  );

  return (
    <RequireAuth allowedRoles={ADMIN_ROLES}>
      <div className="min-h-screen flex flex-col bg-gray-50">
        {/* Sticky red header */}
        <header className="bg-[var(--brand-primary)] shadow-lg sticky top-0 z-40">
          <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {/* Hamburger — only < lg, where the rail is hidden. */}
              <button
                onClick={() => setMobileOpen((o) => !o)}
                aria-label="Toggle navigation menu"
                aria-expanded={mobileOpen}
                className="lg:hidden text-white/90 hover:text-white bg-white/10 hover:bg-white/20 rounded-xl p-2 active:scale-95 transition-all"
              >
                {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
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
            <div className="shrink-0 flex items-center gap-2">
              <Link
                href="/help"
                aria-label="Help & guides"
                className="flex items-center gap-1.5 text-white/90 hover:text-white text-xs font-medium bg-white/10 hover:bg-white/20 rounded-xl px-2.5 py-2 active:scale-95 transition-all"
              >
                <HelpCircle className="h-4 w-4" />
                <span className="hidden sm:inline">Help</span>
              </Link>
              <button
                onClick={() => logout()}
                className="flex items-center gap-1.5 text-white/90 hover:text-white text-xs font-medium bg-white/10 hover:bg-white/20 rounded-xl px-2.5 py-2 active:scale-95 transition-all"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Log out</span>
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 w-full max-w-screen-2xl mx-auto flex">
          {/* Desktop rail — sticky under the header, full remaining height. */}
          <aside className="hidden lg:flex flex-col w-60 shrink-0 bg-white border-r border-gray-200 sticky top-[57px] h-[calc(100vh-57px)]">
            <NavBody />
          </aside>

          {/* Mobile drawer + backdrop */}
          {mobileOpen && (
            <div className="lg:hidden fixed inset-0 top-[57px] z-30">
              <div
                className="absolute inset-0 bg-black/30"
                onClick={() => setMobileOpen(false)}
                aria-hidden="true"
              />
              <aside className="absolute left-0 top-0 bottom-0 w-64 bg-white border-r border-gray-200 shadow-xl flex flex-col slide-in-left">
                <NavBody />
              </aside>
            </div>
          )}

          <main className="flex-1 min-w-0 px-4 sm:px-6 py-6">
            <div className="max-w-6xl mx-auto">{children}</div>
          </main>
        </div>
      </div>
    </RequireAuth>
  );
}
