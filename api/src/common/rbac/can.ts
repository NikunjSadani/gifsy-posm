/**
 * RBAC Permission Engine (POSM) — pure, zero-dependency: no DB, no routes, no I/O.
 *
 * Exports:
 *   - DEFAULT_ROLE_PERMISSIONS  – the default role→permission map
 *   - TenantRoleOverrides       – shape for per-tenant overrides
 *   - permissionsForRole()      – effective set for a role (default ± overrides)
 *   - can()                     – boolean gate used by PermissionGuard
 *
 * UserRole source: the `UserRole` enum in prisma/schema.prisma. Defined locally as a
 * string union (mirroring the enum) so this pure lib has no @prisma/client dependency.
 * If the schema enum changes, update ROLES below and the Prisma enum together.
 */

import { ALL_PERMISSIONS, type Permission } from './permissions';

// ─────────────────────────────────────────────────────────────────────────────
// UserRole — mirrors prisma/schema.prisma enum UserRole.
// ─────────────────────────────────────────────────────────────────────────────

export type UserRole =
  | 'GIFSY_ADMIN'
  | 'CLIENT_ADMIN'
  | 'ASM'
  | 'AUDITOR'
  | 'VENDOR_HO'
  | 'VENDOR_FIELD';

// ── Derived permission sets ───────────────────────────────────────────────────

/** GIFSY_ADMIN: platform operator — every permission in the catalog. */
const GIFSY_ADMIN_PERMISSIONS: Permission[] = [...ALL_PERMISSIONS];

/**
 * CLIENT_ADMIN: full admin within the tenant. Tenancy platform-config is Gifsy-owned,
 * so the client admin does NOT get tenancy:write / tenancy:manage_flags / users:manage_roles.
 */
const _CLIENT_ADMIN_EXCLUDE = new Set<string>([
  'tenancy:write',
  'tenancy:manage_flags',
  'users:manage_roles',
]);
const CLIENT_ADMIN_PERMISSIONS: Permission[] = ALL_PERMISSIONS.filter(
  (p) => !_CLIENT_ADMIN_EXCLUDE.has(p),
);

/** ASM: approves recces for their territory; read-only on the rest of the pipeline. */
const ASM_PERMISSIONS: Permission[] = [
  'sites:read',
  'recce:read',
  'recce:approve',
  'install:read',
  'reports:read',
];

/** AUDITOR: audits installations; read-only on the rest of the pipeline. */
const AUDITOR_PERMISSIONS: Permission[] = [
  'sites:read',
  'recce:read',
  'install:read',
  'install:audit',
  'reports:read',
];

/** VENDOR_HO: vendor head-office — read-only over its fleet. */
const VENDOR_HO_PERMISSIONS: Permission[] = [
  'sites:read',
  'recce:read',
  'install:read',
  'manual:read',
  'reports:read',
];

/** VENDOR_FIELD: the on-ground login IDs — capture (submit) recce/install/manual. */
const VENDOR_FIELD_PERMISSIONS: Permission[] = [
  'sites:read',
  'recce:read',
  'recce:submit',
  'install:read',
  'install:submit',
  'manual:read',
  'manual:submit',
];

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT_ROLE_PERMISSIONS — the canonical default map
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  GIFSY_ADMIN:  GIFSY_ADMIN_PERMISSIONS,
  CLIENT_ADMIN: CLIENT_ADMIN_PERMISSIONS,
  ASM:          ASM_PERMISSIONS,
  AUDITOR:      AUDITOR_PERMISSIONS,
  VENDOR_HO:    VENDOR_HO_PERMISSIONS,
  VENDOR_FIELD: VENDOR_FIELD_PERMISSIONS,
};

// ─────────────────────────────────────────────────────────────────────────────
// Override shape
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-tenant role permission overrides — a partial replacement map. If a role key is
 * present, its value REPLACES the default set entirely (no additive/subtractive
 * arithmetic). Easy to store as a JSON column. Storage/UI is out of scope for the chassis.
 */
export type TenantRoleOverrides = Partial<Record<string, Permission[]>>;

// ─────────────────────────────────────────────────────────────────────────────
// permissionsForRole()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the effective permission set for `role`.
 *   1. If `overrides` provides a full replacement for this role → use it.
 *   2. Otherwise → DEFAULT_ROLE_PERMISSIONS[role].
 *   3. Unknown role → [].
 * Returns a COPY in every branch so a caller mutating the result can't corrupt shared constants.
 */
export function permissionsForRole(
  role: string,
  overrides?: TenantRoleOverrides,
): Permission[] {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, role)) {
    return [...(overrides[role] ?? [])];
  }
  if (Object.prototype.hasOwnProperty.call(DEFAULT_ROLE_PERMISSIONS, role)) {
    return [...DEFAULT_ROLE_PERMISSIONS[role as UserRole]];
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// can()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true iff the effective permission set for `role` includes `permission`.
 * Pure: no DB, no I/O, no side effects.
 */
export function can(
  role: string,
  permission: Permission,
  overrides?: TenantRoleOverrides,
): boolean {
  return permissionsForRole(role, overrides).includes(permission);
}
