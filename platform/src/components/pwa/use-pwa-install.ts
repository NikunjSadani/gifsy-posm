'use client';

/**
 * Shared PWA-install detection + trigger, used by both the field app's floating InstallPrompt
 * banner and the login-screen install button so the two never drift.
 *
 * Status:
 *  - 'android'      — Chromium fired `beforeinstallprompt` (captured + deferred); call install().
 *  - 'ios'          — iOS Safari never fires it; install is manual (Share → Add to Home Screen).
 *  - 'installed'    — already running standalone (or just installed this session).
 *  - 'unavailable'  — no install affordance yet (unsupported browser / event not fired).
 */

import { useEffect, useState } from 'react';

/** The non-standard beforeinstallprompt event (not in lib.dom) — the minimal shape we use. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type PwaInstallStatus = 'unavailable' | 'android' | 'ios' | 'installed';

/** True when the app is already running as an installed PWA (Chromium matchMedia / iOS legacy flag). */
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const mm = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return mm || iosStandalone;
}

/** True on iPhone/iPad (incl. iPadOS 13+ which reports as Mac — disambiguated by touch). */
export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iDevice = /iphone|ipad|ipod/i.test(ua);
  const iPadOs = /macintosh/i.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document;
  return iDevice || iPadOs;
}

export function usePwaInstall(): { status: PwaInstallStatus; install: () => Promise<void> } {
  // Starts 'unavailable' (no SSR flash); resolves to a concrete state on the client.
  const [status, setStatus] = useState<PwaInstallStatus>('unavailable');
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandaloneDisplay()) {
      setStatus('installed');
      return;
    }
    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // stop Chrome's mini-infobar; we re-offer it in-app
      setDeferred(e as BeforeInstallPromptEvent);
      setStatus('android');
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    const onInstalled = () => {
      setStatus('installed');
      setDeferred(null);
    };
    window.addEventListener('appinstalled', onInstalled);

    // iOS never fires beforeinstallprompt — offer the manual instruction instead.
    if (isIosDevice()) setStatus('ios');

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    setDeferred(null);
    setStatus('installed'); // whatever the choice, stop offering this session
  };

  return { status, install };
}
