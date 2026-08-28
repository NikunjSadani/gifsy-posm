'use client';

/**
 * Recce capture — STUB. The camera + ghost-overlay + geo-fenced capture flow is the next
 * slice; this page confirms the routing target from the site sheet's "Start recce" action.
 */

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Camera } from 'lucide-react';

export default function RecceStubPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = use(params);
  const router = useRouter();

  return (
    <div className="px-4 pt-4">
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 text-sm text-gray-600 mb-4 active:scale-95 transition-transform"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
        <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-[var(--brand-primary-light)] flex items-center justify-center">
          <Camera className="h-7 w-7 text-[var(--brand-primary)]" />
        </div>
        <h1 className="text-base font-bold text-gray-900">Recce capture coming soon</h1>
        <p className="text-sm text-gray-500 mt-1.5">
          The guided photo capture with geo-fencing and ghost-overlay will open here for this site.
        </p>
        <p className="text-[11px] font-mono text-gray-400 mt-4 break-all">Site: {siteId}</p>
      </div>
    </div>
  );
}
