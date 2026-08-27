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
import { TenantService } from '../../tenant/tenant.service';

/**
 * RBAC permission enforcement.
 *
 * Flag-gated (the common OFF case costs nothing — no DB read):
 *   Level 1 — env RBAC_ENFORCEMENT === 'true'            (global master switch)
 *   Level 2 — tenant features.rbacEnforcement === true   (per-tenant opt-in)
 * Enforcement applies only when BOTH are active. Fail-open: unknown tenant / flag off →
 * allow (the per-route @Roles checks still gate access).
 *
 * @Public routes and routes without @RequirePermission are never permission-gated.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenant: TenantService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    // No @RequirePermission on this route → nothing to enforce.
    if (!permission) return true;

    // @Public routes are intentionally open — never permission-gate them.
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const user = ctx.switchToHttp().getRequest().user as
      | { role?: string; clientId?: string }
      | undefined;

    // ── Flag-gated (the common OFF case costs nothing — no DB read) ──────────────
    // Level 1 — env master switch OFF (default) → no-op.
    if (process.env.RBAC_ENFORCEMENT !== 'true') return true;
    if (!user) throw new UnauthorizedException('Authentication required.');
    // Level 2 — per-tenant opt-in (fail-open if not enabled / unknown tenant).
    const enabled = await this.tenant.isFeatureEnabled(user.clientId ?? '', 'rbacEnforcement');
    if (!enabled) return true;

    if (can(user.role ?? '', permission)) return true;
    throw new ForbiddenException(`Forbidden: missing permission ${permission}`);
  }
}
