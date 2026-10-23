'use client';

/**
 * Legacy outlet-filter landing — the RS + Beat filter now lives INLINE at the top of the recce
 * list (/field/sites). This route is kept only so old links/bookmarks keep working: it redirects
 * to /field/sites, which hosts the picker. (Client component → router.replace, not next/redirect.)
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui/spinner';

export default function OutletFilterRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/field/sites');
  }, [router]);

  return (
    <div className="flex justify-center py-16">
      <Spinner size="lg" />
    </div>
  );
}
