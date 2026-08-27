/**
 * POSM Permission Catalog — the SINGLE SOURCE OF TRUTH for every permission key.
 *
 * Pure, zero-dependency module: no DB, no routes, no I/O. This is the POSM-minimal
 * replacement for the loyalty permission catalog (KYC/SCHEMES/CREDITS/PAYOUTS/TDS…).
 * The RBAC engine (can.ts) and PermissionGuard consume this generically.
 *
 * Naming convention: "<group>:<action>" — lower-snake for both sides.
 *   - "read"    = view/list/export
 *   - "write"   = create/update
 *   - "submit"  = field submission (recce / installation / manual task)
 *   - "approve" = ASM recce-approval gate
 *   - "audit"   = auditor installation-audit gate
 */

// ── Identity & Access (RBAC) ──────────────────────────────────────────────────
const USERS = {
  READ:         'users:read',
  WRITE:        'users:write',
  MANAGE_ROLES: 'users:manage_roles',
} as const;

// ── Tenancy & Platform Configuration (Gifsy-owned) ────────────────────────────
const TENANCY = {
  READ:         'tenancy:read',
  WRITE:        'tenancy:write',
  MANAGE_FLAGS: 'tenancy:manage_flags',
} as const;

// ── Masters: Vendors ──────────────────────────────────────────────────────────
const VENDORS = {
  READ:  'vendors:read',
  WRITE: 'vendors:write',
} as const;

// ── Masters: Sites ────────────────────────────────────────────────────────────
const SITES = {
  READ:   'sites:read',
  WRITE:  'sites:write',
  IMPORT: 'sites:import',
} as const;

// ── Masters: POSM Types ───────────────────────────────────────────────────────
const POSM_TYPES = {
  READ:  'posm_types:read',
  WRITE: 'posm_types:write',
} as const;

// ── Pipeline: Recce (field capture + ASM approval) ────────────────────────────
const RECCE = {
  READ:    'recce:read',
  SUBMIT:  'recce:submit',
  APPROVE: 'recce:approve',
} as const;

// ── Pipeline: Installation (field capture + auditor audit) ────────────────────
const INSTALL = {
  READ:   'install:read',
  SUBMIT: 'install:submit',
  AUDIT:  'install:audit',
} as const;

// ── Manual workflow (ad-hoc admin tasks) ──────────────────────────────────────
const MANUAL = {
  READ:    'manual:read',
  WRITE:   'manual:write',
  SUBMIT:  'manual:submit',
  APPROVE: 'manual:approve',
} as const;

// ── Reporting & Analytics ─────────────────────────────────────────────────────
const REPORTS = {
  READ:   'reports:read',
  EXPORT: 'reports:export',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// PERMISSIONS — the root catalog object (exported for runtime enumeration)
// ─────────────────────────────────────────────────────────────────────────────

export const PERMISSIONS = {
  USERS,
  TENANCY,
  VENDORS,
  SITES,
  POSM_TYPES,
  RECCE,
  INSTALL,
  MANUAL,
  REPORTS,
} as const;

// ── Permission — string-literal union derived exhaustively from the const ─────

type LeafValues<T> = T extends Record<string, infer V>
  ? V extends Record<string, infer W>
    ? W
    : V
  : never;

export type Permission = LeafValues<typeof PERMISSIONS>;

export type PermissionGroup = keyof typeof PERMISSIONS;

// ── ALL_PERMISSIONS — flat array, no duplicates; derived from the const ───────

export const ALL_PERMISSIONS: Permission[] = (
  Object.values(PERMISSIONS) as Record<string, string>[]
).flatMap((group) => Object.values(group)) as Permission[];

// ── Group metadata (for an admin role-config UI) ──────────────────────────────

export interface PermissionGroupMeta {
  key: PermissionGroup;
  label: string;
}

export const PERMISSION_GROUPS: PermissionGroupMeta[] = [
  { key: 'USERS',      label: 'User Management' },
  { key: 'TENANCY',    label: 'Tenancy & Platform Configuration' },
  { key: 'VENDORS',    label: 'Vendors' },
  { key: 'SITES',      label: 'Sites' },
  { key: 'POSM_TYPES', label: 'POSM Types' },
  { key: 'RECCE',      label: 'Recce (capture + approval)' },
  { key: 'INSTALL',    label: 'Installation (capture + audit)' },
  { key: 'MANUAL',     label: 'Manual Tasks' },
  { key: 'REPORTS',    label: 'Reporting & Analytics' },
];

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Returns all permissions that belong to the given group ([] for unknown). */
export function permissionsForGroup(group: PermissionGroup): Permission[] {
  const groupObj = PERMISSIONS[group];
  if (!groupObj) return [];
  return Object.values(groupObj) as Permission[];
}

/** Type guard — narrows an unknown value to Permission. */
export function isPermission(x: unknown): x is Permission {
  if (typeof x !== 'string') return false;
  return (ALL_PERMISSIONS as string[]).includes(x);
}
