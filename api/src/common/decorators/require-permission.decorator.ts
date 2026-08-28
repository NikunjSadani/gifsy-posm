import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../rbac/permissions';

export const PERMISSION_KEY = 'requiredPermission';

/**
 * Require an RBAC permission for a route. Enforced by PermissionGuard, which is ALWAYS
 * FAIL-CLOSED: a route carrying this decorator is enforced on every request — the caller's
 * role must satisfy `can(role, permission)` or the request is refused (403; 401 if
 * unauthenticated). There is NO env RBAC_ENFORCEMENT master switch and NO per-tenant
 * features.rbacEnforcement opt-in (the old fail-open path is removed). Only a route WITHOUT
 * this decorator, or a @Public route, is exempt.
 *
 * Usage: @RequirePermission('sites:write')
 */
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);
