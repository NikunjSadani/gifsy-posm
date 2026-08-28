import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { can } from '../rbac/can';
import type { Permission } from '../rbac/permissions';

/**
 * RBAC permission enforcement — FAIL-CLOSED.
 *
 * A route carrying @RequirePermission(p) is ALWAYS enforced: the caller's role must satisfy
 * `can(role, p)` or the request is refused with 403. POSM is greenfield — there are no legacy
 * routes to protect, so there is no env `RBAC_ENFORCEMENT` master switch and no per-tenant
 * `features.rbacEnforcement` opt-in; the former two-level FAIL-OPEN path (which let an unknown
 * tenant / flag-off silently bypass the permission) has been removed. The permission engine
 * itself (can() / permissions.ts) is unchanged.
 *
 * Only two routes are ever exempt, both intentionally:
 *   - a route WITHOUT @RequirePermission (nothing to enforce), and
 *   - a @Public route (JwtAuthGuard already skipped auth; a tokenless hit must pass — the
 *     handler is open by design).
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    // No @RequirePermission on this route → nothing to enforce.
    if (!permission) return true;

    // @Public routes are intentionally open — never permission-gate them (matches the
    // 'isPublic' short-circuit in JwtAuthGuard / TenantGuard).
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const user = ctx.switchToHttp().getRequest().user as
      | { role?: string }
      | undefined;

    // FAIL-CLOSED: a protected route with no authenticated user cannot pass. On a
    // non-@Public route the upstream JwtAuthGuard already guarantees `user`; this is the
    // belt-and-suspenders refusal if the guard chain is ever reordered.
    if (!user) throw new UnauthorizedException('Authentication required.');

    if (can(user.role ?? '', permission)) return true;
    throw new ForbiddenException(`Forbidden: missing permission ${permission}`);
  }
}
