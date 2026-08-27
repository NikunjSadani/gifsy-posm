import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * TenantGuard — the application-layer tenant chokepoint.
 *
 * clientId is already in the SIGNED JWT, so the tenant binding is tamper-proof, and every
 * service query filters by `req.user.clientId`. This guard is defense-in-depth:
 *   1. asserts a tenant is RESOLVED on every authenticated request → converts a silent
 *      "clientId === undefined → unscoped query" failure mode into a loud 403;
 *   2. stamps `req.tenantId` as the single named tenant seam (for audit/logging).
 *
 * Runs after JwtAuthGuard (so `req.user` is populated). @Public() routes are skipped.
 * GIFSY_ADMIN is unaffected: it carries a clientId too.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Public routes have no authenticated user → nothing to scope.
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const clientId = request.user?.clientId;

    if (typeof clientId !== 'string' || clientId.trim() === '') {
      // A token that reached here (JWT verified + session valid) but carries no tenant
      // must not run a single query — every downstream filter depends on this value.
      throw new ForbiddenException('No tenant context on this request.');
    }

    request.tenantId = clientId;
    return true;
  }
}
