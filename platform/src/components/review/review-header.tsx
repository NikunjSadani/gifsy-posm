'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, ClipboardCheck, HelpCircle, LogOut } from 'lucide-react';
import { logout } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

/**
 * Sticky red Kwality header for the ASM approval console. Desktop/tablet-first: white logo
 * pill, program wordmark, an inline nav (Dashboard · Approval Queue) that highlights the
 * active section, and a logout control. Mirrors the field header's brand treatment on a wider
 * `max-w-5xl` rail.
 */
const NAV = [
  { href: '/review', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/review/recces', label: 'Approval Pending', icon: ClipboardCheck, exact: false },
];

export function ReviewHeader() {
  const pathname = usePathname();

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <header className="bg-[var(--brand-primary)] shadow-lg sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="bg-white rounded-xl px-2 py-1 shadow-sm shrink-0">
            <Image src="/kwality-walls-logo.png" alt="Kwality Wall's" width={44} height={44} priority />
          </div>
          <div className="min-w-0">
            <p className="text-white font-black text-base tracking-wide leading-tight truncate">
              Field Execution
            </p>
            <p className="text-[var(--brand-accent)] text-[10px] font-semibold tracking-widest uppercase">
              ASM Approval Console
            </p>
          </div>
        </div>

        <nav className="hidden sm:flex items-center gap-1">
          {NAV.map(({ href, label, icon: Icon, exact }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-1.5 text-sm font-medium rounded-xl px-3 py-2 transition-all active:scale-95',
                isActive(href, exact)
                  ? 'bg-white text-[var(--brand-primary)] shadow-sm'
                  : 'text-white/90 hover:text-white bg-white/10 hover:bg-white/20',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>

        <div className="shrink-0 flex items-center gap-2">
          <Link
            href="/help"
            aria-label="Help & guides"
            className="flex items-center gap-1.5 text-white/90 hover:text-white text-xs font-medium bg-white/10 hover:bg-white/20 rounded-xl px-2.5 py-2 active:scale-95 transition-all"
          >
            <HelpCircle className="h-4 w-4" />
            <span className="hidden md:inline">Help</span>
          </Link>
          <button
            onClick={() => logout()}
            aria-label="Log out"
            className="flex items-center gap-1.5 text-white/90 hover:text-white text-xs font-medium bg-white/10 hover:bg-white/20 rounded-xl px-2.5 py-2 active:scale-95 transition-all"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden md:inline">Log out</span>
          </button>
        </div>
      </div>

      {/* Mobile nav row */}
      <nav className="sm:hidden max-w-5xl mx-auto px-4 pb-2 flex items-center gap-1">
        {NAV.map(({ href, label, icon: Icon, exact }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 text-xs font-medium rounded-lg px-2 py-1.5 transition-all active:scale-95',
              isActive(href, exact)
                ? 'bg-white text-[var(--brand-primary)]'
                : 'text-white/90 bg-white/10',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export default ReviewHeader;
