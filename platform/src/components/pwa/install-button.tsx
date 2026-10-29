'use client';

/**
 * Inline "Install app" affordance for the LOGIN screen (below the Sign in button). Unlike the
 * floating {@link InstallPrompt} banner, this renders in the page flow. Shows:
 *  - Android/Chromium: a tappable "Install app" button that opens the browser's install dialog.
 *  - iOS Safari: a short Share → Add to Home Screen hint (no programmatic install there).
 *  - already installed / unsupported: nothing.
 */

import { Download, Share } from 'lucide-react';
import { usePwaInstall } from './use-pwa-install';

export function InstallButton({ className }: { className?: string }) {
  const { status, install } = usePwaInstall();

  if (status === 'android') {
    return (
      <button
        type="button"
        onClick={install}
        data-testid="login-install-button"
        className={
          className ??
          'w-full mt-3 inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-[var(--brand-primary)] text-[var(--brand-primary)] font-semibold py-3 active:scale-95 transition-all'
        }
      >
        <Download className="h-4 w-4" aria-hidden />
        Install app
      </button>
    );
  }

  if (status === 'ios') {
    return (
      <p
        data-testid="login-install-ios-hint"
        className="mt-3 text-center text-xs text-gray-500 inline-flex items-center justify-center gap-1 flex-wrap w-full"
      >
        <Download className="h-3.5 w-3.5" aria-hidden />
        Install: tap <Share className="h-3.5 w-3.5 inline" aria-hidden /> Share, then “Add to Home Screen”.
      </p>
    );
  }

  return null; // installed or unavailable
}

export default InstallButton;
