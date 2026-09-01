'use client';

/**
 * UpdateNudge — an online-only "a new version is available" prompt.
 *
 * The app has NO service worker, so there is no cached bundle to invalidate — every full load is
 * fresh from the network. The one residual staleness case is a long-lived INSTALLED PWA tab left
 * open across a deploy: it keeps running the old client JS (and can drift from a newer API
 * contract). This component catches exactly that.
 *
 * It compares the build id baked into THIS client (`NEXT_PUBLIC_BUILD_ID`) against the build id
 * the live server reports at `/version`. On a mismatch it shows a non-blocking "Refresh" nudge —
 * it NEVER auto-reloads, so a field user is never interrupted mid-capture. Fail-quiet: any fetch
 * error (offline, transient) is ignored and retried on the next tick.
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

const LOADED_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';
const POLL_MS = 5 * 60 * 1000; // every 5 minutes + on tab focus

export function UpdateNudge() {
  const [stale, setStale] = useState(false);

  // Stable identity (no deps) so the effect below arms polling exactly once.
  const check = useCallback(async () => {
    try {
      const res = await fetch('/version', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { buildId?: string };
      const server = data?.buildId;
      // Only nudge on a real, different, non-"dev" server build id (dev has no stable id).
      if (server && server !== 'dev' && server !== LOADED_BUILD_ID) setStale(true);
    } catch {
      /* offline / transient — try again next tick */
    }
  }, []);

  useEffect(() => {
    if (stale) return; // decision made — tear the poller down and never re-arm it
    void check();
    const id = setInterval(() => void check(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [stale, check]);

  if (!stale) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex justify-center px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-gray-900 text-white shadow-lg px-4 py-2.5 max-w-md w-full sm:w-auto">
        <RefreshCw className="h-4 w-4 shrink-0" aria-hidden />
        <span className="text-sm flex-1">A new version is available.</span>
        <button
          onClick={() => window.location.reload()}
          className="shrink-0 text-sm font-semibold bg-white text-gray-900 rounded-xl px-3 py-1.5 active:scale-95 transition-transform"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}

export default UpdateNudge;
