'use client';

/**
 * My Work — placeholder for the vendor's recce/install task list. The capture + workflow
 * surfaces land in the next slice; this tab keeps the bottom-nav complete meanwhile.
 */

import Link from 'next/link';
import { ClipboardList, MapPin } from 'lucide-react';

export default function MyWorkPage() {
  return (
    <div className="px-4 pt-4">
      <h1 className="text-lg font-bold text-gray-900 mb-4">My Work</h1>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
        <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-[var(--brand-primary-light)] flex items-center justify-center">
          <ClipboardList className="h-7 w-7 text-[var(--brand-primary)]" />
        </div>
        <h2 className="text-base font-bold text-gray-900">Your tasks will appear here</h2>
        <p className="text-sm text-gray-500 mt-1.5">
          Recce and installation jobs, their status, and history are coming in the next update.
        </p>
        <Link
          href="/field/sites"
          className="inline-flex items-center gap-2 mt-5 bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] text-white font-bold px-5 py-3 rounded-2xl active:scale-95 transition-all"
        >
          <MapPin className="h-4 w-4" />
          Browse my sites
        </Link>
      </div>
    </div>
  );
}
