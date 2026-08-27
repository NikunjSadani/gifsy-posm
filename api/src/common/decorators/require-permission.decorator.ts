import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../rbac/permissions';

export const PERMISSION_KEY = 'requiredPermission';

/**
 * Require an RBAC permission for a route. Enforced by PermissionGuard, which is
 * flag-gated (env RBAC_ENFORCEMENT + per-tenant features.rbacEnforcement) and a
 * complete no-op by default.
 *
 * Usage: @RequirePermission('sites:write')
 */
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);
