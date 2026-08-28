'use client';

import Image from 'next/image';
import { LayoutDashboard, LogOut } from 'lucide-react';
import { logout } from '@/lib/auth-client';

/**
 * Sticky red Kwality header for the read-only VENDOR-HO console. Mirrors the ASM console's
 * brand treatment. The vendor head-office sees only their own fleet's execution analytics —
 * no admin actions — so the header carries just a dashboard marker and logout.
 */
export function VendorHeader() {
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
          <span className="hidden sm:inline-flex items-center gap-1.5 text-white/90 text-xs font-medium bg-white/10 rounded-xl px-2.5 py-2">
            <LayoutDashboard className="h-4 w-4" />
            Fleet analytics
          </span>
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
