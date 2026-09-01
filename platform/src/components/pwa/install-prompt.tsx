'use client';

/**
 * InstallPrompt — a dismissible "install this app" affordance for the field PWA.
 *
 * This is INSTALL polish only — the app stays online-only with NO service worker (see
 * app/layout.tsx). Two native install paths, neither of which the browser surfaces prominently
 * on its own:
 *   - Android / Chromium: the `beforeinstallprompt` event is captured and re-offered as an
 *     in-app "Install app" button that calls the browser's own install dialog.
 *   - iOS Safari: there is NO `beforeinstallprompt`; install is manual (Share → Add to Home
 *     Screen), so we show a short instruction instead.
 * Renders nothing when the app is already installed (running in standalone display mode) or when
 * the user has dismissed it (remembered per-browser in localStorage).
 */

import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

/** The non-standard beforeinstallprompt event (not in lib.dom) — minimal shape we use. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'posm.pwa.install.dismissed';

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // Chromium reports via matchMedia; iOS Safari via the legacy navigator.standalone flag.
  const mm = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return mm || iosStandalone;
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iDevice = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ reports as Mac; disambiguate by touch support.
  const iPadOs = /macintosh/i.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document;
  return iDevice || iPadOs;
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function InstallPrompt() {
  // `null` while we decide on the client (avoids a hydration flash); then a concrete state.
  const [mode, setMode] = useState<'hidden' | 'android' | 'ios'>('hidden');
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone() || wasDismissed()) return; // already installed or muted → never show

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // stop Chrome's mini-infobar; we re-offer it in-app
      if (wasDismissed()) return; // Chromium may re-fire this — honor an earlier dismissal
      setDeferred(e as BeforeInstallPromptEvent);
      setMode('android');
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // Once installed, drop the banner immediately.
    const onInstalled = () => {
      setMode('hidden');
      setDeferred(null);
    };
    window.addEventListener('appinstalled', onInstalled);

    // iOS never fires beforeinstallprompt — offer the manual instruction instead.
    if (isIos()) setMode('ios');

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (mode === 'hidden') return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode — dismissal just won't persist */
    }
    setMode('hidden');
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    setDeferred(null);
    setMode('hidden'); // whatever the choice, stop offering this session
  };

  return (
    <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 px-3 pointer-events-none">
      <div className="max-w-md mx-auto pointer-events-auto rounded-2xl bg-white shadow-[0_6px_24px_rgba(0,0,0,0.14)] border border-gray-100 p-3 flex items-center gap-3">
        <div className="shrink-0 h-10 w-10 rounded-xl bg-[var(--brand-primary)]/10 flex items-center justify-center">
          <Download className="h-5 w-5 text-[var(--brand-primary)]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 leading-tight">Install the field app</p>
          {mode === 'android' ? (
            <p className="text-xs text-gray-500 leading-snug">Add it to your home screen for one-tap access.</p>
          ) : (
            <p className="text-xs text-gray-500 leading-snug inline-flex items-center gap-1 flex-wrap">
              Tap <Share className="h-3.5 w-3.5 inline" aria-hidden /> Share, then “Add to Home Screen”.
            </p>
          )}
        </div>
        {mode === 'android' && (
          <button
            onClick={install}
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
