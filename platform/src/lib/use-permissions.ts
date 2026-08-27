/* ─── RBAC Option-X P6 — permission-aware access (UX layer) ────────────────────
   A GIFSY_STAFF operator carries a limited role whose granted permission keys
   come from the backend. This hook exposes those keys to the frontend so the UI
   can show a CLEAR "you don't have permission" message (page-level AccessDenied +
   action-level gating) instead of a raw backend 403 — WITHOUT hiding nav items.

   CRITICAL SEMANTICS (the whole feature is INERT for everyone except staff):
     - GIFSY_STAFF        → has(p) === permissions.includes(p)   (gated)
     - every OTHER role   → has(p) === true                      (never gated)
   GIFSY_ADMIN (owner) and all other roles keep their exact current behaviour.
   This is a UX layer only — the backend still enforces (403s) and is the real
   security boundary.

   Source of truth:
     - role        → the stored JWT user (localStorage, synchronous — same source
                     admin-session / require-auth already trust). Available on the
                     first client paint so has() is correct for non-staff instantly.
     - permissions → GET /api/auth/me `permissions: string[]` (fetched once per
                     session, module-cached; ONLY fetched for GIFSY_STAFF so the
                     feature costs a non-staff user zero extra requests).
─────────────────────────────────────────────────────────────────────────────── */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { getStoredUser } from '@/lib/auth-client';

/** The only role this feature gates. */
export const STAFF_ROLE = 'GIFSY_STAFF';

export interface UsePermissions {
  /** The signed-in user's role (from the stored JWT user), or null before hydration. */
  role: string | null;
  /** The staff role's granted permission keys. Empty for every non-staff role. */
  permissions: string[];
  /**
   * True when a permission DECISION can be made:
   *  - non-staff: always true (never gated, no fetch needed),
   *  - staff:     true only once GET /api/auth/me has resolved.
   * Guard page-level/action-level rendering on this to avoid a flash.
   */
  ready: boolean;
  /**
   * TRUE for every non-staff role (owner + all others are NOT gated by this).
   * For GIFSY_STAFF, TRUE only when the permission is in their granted set.
   */
  has: (permission: string) => boolean;
  /**
   * True when the staff permission fetch FAILED (transient) and no set is cached — the caller
   * should show a "couldn't load your permissions — retry" state, NOT a genuine access denial.
   * Always false for non-staff. (MED-1: never conflate a network blip with "no permission".)
   */
  error: boolean;
  /** Re-attempt the staff permission fetch (clears the transient error). No-op for non-staff. */
  retry: () => void;
}

/**
 * Pure permission check — the load-bearing semantic, exported for direct testing.
 *
 * Non-staff (owner + every other role) ALWAYS get true: the feature is inert for
 * them by construction, so a mis-mapped route or an un-fetched permission list can
 * never wrongly block them. Only GIFSY_STAFF is checked against its granted keys.
 */
export function hasPermissionFor(
  role: string | null,
  permissions: string[],
  permission: string,
): boolean {
  if (role !== STAFF_ROLE) return true;
  return permissions.includes(permission);
}

// ── module-level cache (fetched once per session, like gifsy-settings) ────────
let cache: { permissions: string[] } | null = null;
// MED-1: a FAILED fetch is a TRANSIENT error, NOT "no permissions" — we do NOT cache it as a
// terminal empty set (which would strand a legit staff on AccessDenied for the whole session).
// It stays retryable (cache null) and surfaces `error` so the UI shows a retry state, not a denial.
let loadError = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

interface Snapshot {
  role: string | null;
  permissions: string[];
  ready: boolean;
  error: boolean;
}

/** Synchronous snapshot: role from localStorage, permissions from the cache. */
function readSnapshot(): Snapshot {
  const role = getStoredUser()?.role ?? null;
  if (role !== STAFF_ROLE) {
    // Non-staff: inert — always ready, never in error, no permissions consulted.
    return { role, permissions: [], ready: true, error: false };
  }
  // Staff: a decision needs the granted keys, so ready only once loaded. `error` is true when
  // the fetch failed and nothing is cached → the caller shows a retry state (not AccessDenied).
  return {
    role,
    permissions: cache?.permissions ?? [],
    ready: cache !== null,
    error: loadError && cache === null,
  };
}

/**
 * Ensure the staff permission list is loaded (idempotent, single-flight). No-ops for non-staff —
 * they never trigger the fetch, keeping the feature free for them. On a fetch failure we set the
 * transient `loadError` flag but DO NOT cache a result, so the next mount / an explicit retry()
 * re-attempts (MED-1) — a network blip never becomes a permanent, misdiagnosed access denial.
 * The backend remains the real enforcement boundary either way.
 */
function ensureLoaded(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  const role = getStoredUser()?.role ?? null;
  if (role !== STAFF_ROLE) return Promise.resolve();
  if (cache !== null) return Promise.resolve();
  if (inflight) return inflight;

  loadError = false; // fresh attempt
  inflight = api
    .get<{ permissions?: unknown }>('/api/auth/me')
    .then((res) => {
      // NOTE: api.get NEVER rejects — a network error OR a non-2xx both resolve as
      // { success:false } (api-client.ts). So a FAILURE must be handled HERE, not only in
      // .catch: treat !success as a TRANSIENT error (retryable, uncached) — caching an empty
      // set here was the real MED-1 bug (a blip → permanent AccessDenied for the whole session).
      if (!res.success) {
        loadError = true;
        notify();
        return;
      }
      const raw = res.data?.permissions as unknown;
      const perms = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : [];
      cache = { permissions: perms };
      loadError = false;
      notify();
    })
    .catch(() => {
      // Defensive (api.get shouldn't reach here) — same transient, retryable, uncached handling.
      loadError = true;
      notify();
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Re-attempt the staff permission fetch after a transient failure. No-op for non-staff. */
function retryLoad(): void {
  if (getStoredUser()?.role !== STAFF_ROLE) return;
  loadError = false;
  void ensureLoaded();
}

/**
 * usePermissions — cached, reactive permission access for the admin UI.
 *
 * Fetches GET /api/auth/me at most once per session (only for GIFSY_STAFF) and
 * re-renders subscribers when it resolves or when the session changes (login /
 * logout / cross-tab). Returns a stable-shaped { role, permissions, ready, has }.
 */
export function usePermissions(): UsePermissions {
  const [snap, setSnap] = useState<Snapshot>(() => readSnapshot());

  useEffect(() => {
    const sync = () => setSnap(readSnapshot());
    listeners.add(sync);
    // Re-read synchronously on mount (localStorage is now available), then load perms.
    sync();
    void ensureLoaded();
    // A login/logout in this or another tab changes role → re-decide.
    window.addEventListener('storage', sync);
    window.addEventListener('admin-session-change', sync);
    return () => {
      listeners.delete(sync);
      window.removeEventListener('storage', sync);
      window.removeEventListener('admin-session-change', sync);
    };
  }, []);

  const has = useCallback(
    (permission: string) => hasPermissionFor(snap.role, snap.permissions, permission),
    [snap.role, snap.permissions],
  );
  const retry = useCallback(() => retryLoad(), []);

  return { role: snap.role, permissions: snap.permissions, ready: snap.ready, error: snap.error, has, retry };
}

/** Test-only: reset the module cache + subscribers between test cases. */
export function __resetPermissionsForTests(): void {
  cache = null;
  loadError = false;
  inflight = null;
  listeners.clear();
}
