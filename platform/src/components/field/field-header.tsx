'use client';

import Image from 'next/image';
import Link from 'next/link';
import { HelpCircle, LogOut } from 'lucide-react';
import { logout } from '@/lib/auth-client';

/**
 * Sticky red Kwality header for the field PWA — white logo pill on the left, program
 * wordmark, and a logout control. Mirrors the microsite's retailer header.
 */
export function FieldHeader() {
  return (
    <header className="bg-[var(--brand-primary)] shadow-lg sticky top-0 z-50">
      <div className="max-w-md mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="bg-white rounded-xl px-2 py-1 shadow-sm shrink-0">
            <Image src="/kwality-walls-logo.png" alt="Kwality Wall's" width={44} height={44} priority />
          </div>
          <div className="min-w-0">
            <p className="text-white font-black text-sm tracking-wide leading-tight truncate">
              Field Execution
            </p>
            <p className="text-[var(--brand-accent)] text-[10px] font-semibold tracking-widest uppercase">
              POSM Vendor App
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/help"
            aria-label="Help & guides"
            className="flex items-center gap-1.5 text-white/90 hover:text-white text-xs font-medium bg-white/10 hover:bg-white/20 rounded-xl px-2.5 py-2 active:scale-95 transition-all"
          >
            <HelpCircle className="h-4 w-4" />
          </Link>
          <button
            onClick={() => logout()}
            aria-label="Log out"
            className="flex items-center gap-1.5 text-white/90 hover:text-white text-xs font-medium bg-white/10 hover:bg-white/20 rounded-xl px-2.5 py-2 active:scale-95 transition-all"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

export default FieldHeader;
