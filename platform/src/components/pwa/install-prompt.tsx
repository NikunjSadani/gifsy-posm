'use client';

/**
 * InstallPrompt — a dismissible floating "install this app" banner for the field PWA.
 *
 * Detection + the install trigger come from the shared {@link usePwaInstall} hook (the SAME logic
 * the login-screen InstallButton uses, so the two never drift); this component owns only the
 * floating-banner UI and the per-browser "dismissed" memory. Renders nothing when already installed,
 * when install isn't available, or once the user dismisses it.
 *
 * This is INSTALL polish only — the app stays online-only with NO service worker (see app/layout.tsx).
 */

import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePwaInstall } from './use-pwa-install';

const DISMISS_KEY = 'posm.pwa.install.dismissed';

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function InstallPrompt() {
  const { status, install } = usePwaInstall();
  const [dismissed, setDismissed] = useState(false);

  // Read the persisted dismissal on the client (avoids a hydration mismatch).
  useEffect(() => {
    setDismissed(wasDismissed());
  }, []);

  if (dismissed || status === 'installed' || status === 'unavailable') return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode — dismissal just won't persist */
    }
    setDismissed(true);
  };

  const doInstall = async () => {
    await install();
    setDismissed(true); // whatever the choice, stop offering this session
  };

  return (
    <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 px-3 pointer-events-none">
      <div className="max-w-md mx-auto pointer-events-auto rounded-2xl bg-white shadow-[0_6px_24px_rgba(0,0,0,0.14)] border border-gray-100 p-3 flex items-center gap-3">
        <div className="shrink-0 h-10 w-10 rounded-xl bg-[var(--brand-primary)]/10 flex items-center justify-center">
          <Download className="h-5 w-5 text-[var(--brand-primary)]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 leading-tight">Install the field app</p>
          {status === 'android' ? (
            <p className="text-xs text-gray-500 leading-snug">Add it to your home screen for one-tap access.</p>
          ) : (
            <p className="text-xs text-gray-500 leading-snug inline-flex items-center gap-1 flex-wrap">
              Tap <Share className="h-3.5 w-3.5 inline" aria-hidden /> Share, then “Add to Home Screen”.
            </p>
          )}
        </div>
        {status === 'android' && (
          <button
            onClick={doInstall}
            className="shrink-0 text-xs font-semibold text-white bg-[var(--brand-primary)] rounded-xl px-3 py-2 active:scale-95 transition-transform"
          >
            Install
          </button>
        )}
        <button
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="shrink-0 text-gray-400 hover:text-gray-600 p-1"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default InstallPrompt;
