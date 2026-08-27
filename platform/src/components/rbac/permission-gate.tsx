'use client';

/* ─── RBAC Option-X P6 — action-level permission controls ──────────────────────
   Reusable primitives for gating individual operator actions (write/destructive
   controls) for a GIFSY_STAFF who lacks the permission. Both are INERT for every
   non-staff role (usePermissions().has() is always true for them), so dropping
   them into any admin page never changes behaviour for the owner or other roles.

   <PermissionGate>  — render children only when the permission is held; otherwise
                       render `fallback` (default: nothing). Use to hide/replace a
                       whole control or section.
   <PermissionButton> — a <button> that, for a staff lacking the permission, renders
                       DISABLED with a "You don't have permission" tooltip (title)
                       instead of firing. Use for prominent write/destructive
                       buttons where a visible-but-disabled control reads better
                       than a vanished one.
─────────────────────────────────────────────────────────────────────────────── */

import React from 'react';
import { usePermissions } from '@/lib/use-permissions';

const NO_PERMISSION_TITLE = "You don't have permission";

export interface PermissionGateProps {
  /** The permission key required to render `children` (e.g. "schemes:write"). */
  permission: string;
  children: React.ReactNode;
  /** Rendered instead of children when the permission is not held. Default: null. */
  fallback?: React.ReactNode;
}

/**
 * Renders `children` only when the current user holds `permission`. Always renders
 * children for non-staff roles (has() is true for them). For a GIFSY_STAFF the
 * decision waits until permissions have loaded (`ready`) so a permitted control is
 * never briefly hidden on first paint.
 */
export function PermissionGate({ permission, children, fallback = null }: PermissionGateProps) {
  const { has, ready, role } = usePermissions();
  // Staff whose permissions haven't resolved yet → render the fallback (usually a
  // disabled/absent control) rather than flashing the action, then re-render when ready.
  if (role === 'GIFSY_STAFF' && !ready) return <>{fallback}</>;
  return <>{has(permission) ? children : fallback}</>;
}

export interface PermissionButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** The permission key required to enable this button. */
  permission: string;
  /** Tooltip shown when the button is permission-disabled. */
  deniedTitle?: string;
}

/**
 * A native <button> that is permission-aware: for a GIFSY_STAFF lacking `permission`
 * it renders DISABLED with a tooltip and swallows clicks; for everyone else it is a
 * plain button. Own `disabled`/`title`/`onClick`/`className` are respected and merged
 * — a caller can style it exactly like any other button in the page.
 */
export function PermissionButton({
  permission,
  deniedTitle = NO_PERMISSION_TITLE,
  disabled,
  title,
  onClick,
  children,
  ...rest
}: PermissionButtonProps) {
  const { has, ready, role } = usePermissions();
  const staffPending = role === 'GIFSY_STAFF' && !ready;
  const denied = !has(permission) || staffPending;

  const button = (
    <button
      {...rest}
      disabled={disabled || denied}
      // When permission-denied the title lives on the wrapping span (below), not here — a
      // DISABLED button fires no hover events, so a title on it never shows (MED-2).
      title={denied ? undefined : title}
      aria-disabled={disabled || denied || undefined}
      onClick={denied ? undefined : onClick}
    >
      {children}
    </button>
  );

  // Permission-denied → wrap in a (non-disabled) span that DOES receive hover, so the
  // "You don't have permission" tooltip is actually discoverable. `inline-block` hugs the button.
  if (denied) {
    return (
      <span title={deniedTitle} aria-label={deniedTitle} className="inline-block cursor-not-allowed">
        {button}
      </span>
    );
  }
  return button;
}

export default PermissionGate;
