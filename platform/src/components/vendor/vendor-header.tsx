'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FileSpreadsheet, HelpCircle, LogOut, type LucideIcon } from 'lucide-react';
import { logout } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

/** The VENDOR-HO console destinations. `exact` pins the dashboard so the report route isn't
 *  highlighted as "Fleet analytics" too. Both are fleet-scoped server-side. */
const NAV: { href: string; label: string; icon: LucideIcon; exact?: boolean }[] = [
  { href: '/vendor', label: 'Fleet analytics', icon: LayoutDashboard, exact: true },
  { href: '/vendor/execution-report', label: 'Recce Report', icon: FileSpreadsheet },
];

/**
 * Sticky red Kwality header for the read-only VENDOR-HO console. Mirrors the ASM console's
 * brand treatment. The vendor head-office sees only their own fleet's execution — no admin
 * actions — across two destinations (fleet analytics + the Recce Report), both fleet-scoped by
 * the backend.
 */
export function VendorHeader() {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="bg-[var(--brand-primary)] shadow-lg sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="bg-white rounded-xl px-2 py-1 shadow-sm shrink-0">
            <Image src="/kwality-walls-logo.png" alt="Kwality Wall's" width={44} height={44} priority />
          </div>
          <div className="min-w-0">
            <p className="text-white font-black text-sm tracking-wide leading-tight truncate">
              Field Execution
            </p>
            <p className="text-[var(--brand-accent)] text-[10px] font-semibold tracking-widest uppercase">
              Vendor Console
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <nav className="flex items-center gap-1.5">
            {NAV.map((item) => {
              const active = isActive(item.href, item.exact);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-medium active:scale-95 transition-all',
                    active ? 'bg-white text-[var(--brand-primary)] shadow-sm' : 'text-white/90 hover:text-white bg-white/10 hover:bg-white/20',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <Link
            href="/help"
            aria-label="Help & guides"
            className="shrink-0 flex items-center gap-1.5 text-white/90 hover:text-white text-xs font-medium bg-white/10 hover:bg-white/20 rounded-xl px-2.5 py-2 active:scale-95 transition-all"
          >
            <HelpCircle className="h-4 w-4" />
            <span className="hidden md:inline">Help</span>
          </Link>
          <button
            onClick={() => logout()}
            aria-label="Log out"
            className="shrink-0 flex items-center gap-1.5 text-white/90 hover:text-white text-xs font-medium bg-white/10 hover:bg-white/20 rounded-xl px-2.5 py-2 active:scale-95 transition-all"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden md:inline">Log out</span>
          </button>
        </div>
      </div>
    </header>
  );
}

export default VendorHeader;
