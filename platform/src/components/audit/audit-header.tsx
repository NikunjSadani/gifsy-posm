'use client';

/**
 * Kwality-themed header for the desktop/tablet Auditor console. Red sticky bar with the
 * white logo pill, a wordmark, top nav (Dashboard · Queue), and a logout control. Content
 * columns are `max-w-5xl` — this is a review desk, not the mobile field app.
 */

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, ListChecks, HelpCircle, LogOut } from 'lucide-react';
import { logout } from '@/lib/auth-client';

const NAV = [
  { href: '/audit', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/audit/installations', label: 'Review queue', icon: ListChecks, exact: false },
];

export function AuditHeader() {
  const pathname = usePathname();

  return (
    <header className="bg-[var(--brand-primary)] shadow-lg sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/audit" className="bg-white rounded-xl px-2 py-1 shadow-sm shrink-0" aria-label="Audit home">
            <Image src="/kwality-walls-logo.png" alt="Kwality Wall's" width={40} height={40} priority />
          </Link>
          <div className="min-w-0">
            <p className="text-white font-black text-sm tracking-wide leading-tight truncate">Audit Console</p>
            <p className="text-[var(--brand-accent)] text-[10px] font-semibold tracking-widest uppercase">
              POSM Installation QA
            </p>
          </div>
        </div>

        <nav className="flex items-center gap-1">
          {NAV.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 rounded-xl px-2.5 sm:px-3 py-2 text-xs sm:text-sm font-medium active:scale-95 transition-all ${
                  active ? 'bg-white text-[var(--brand-primary)]' : 'text-white/90 hover:text-white hover:bg-white/15'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
          <Link
            href="/help"
            aria-label="Help & guides"
            className="flex items-center gap-1.5 text-white/90 hover:text-white text-xs sm:text-sm font-medium bg-white/10 hover:bg-white/20 rounded-xl px-2.5 py-2 active:scale-95 transition-all ml-1"
          >
            <HelpCircle className="h-4 w-4" />
            <span className="hidden sm:inline">Help</span>
          </Link>
          <button
            onClick={() => logout()}
            aria-label="Log out"
            className="flex items-center gap-1.5 text-white/90 hover:text-white text-xs sm:text-sm font-medium bg-white/10 hover:bg-white/20 rounded-xl px-2.5 py-2 active:scale-95 transition-all ml-1"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Log out</span>
          </button>
        </nav>
      </div>
    </header>
  );
}

export default AuditHeader;
