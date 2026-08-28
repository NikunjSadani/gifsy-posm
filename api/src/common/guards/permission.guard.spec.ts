import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import type { Permission } from '../rbac/permissions';

/**
 * PermissionGuard is FAIL-CLOSED (audit finding 1): a route carrying @RequirePermission is
 * ALWAYS enforced via can(role, permission) — there is no RBAC_ENFORCEMENT / per-tenant
 * fail-open bypass. These tests lock that behaviour so a future edit cannot re-introduce it.
 */
describe('PermissionGuard (fail-closed)', () => {
  let guard: PermissionGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  /** Build an ExecutionContext whose request carries `user`. */
  const ctxFor = (user: unknown): ExecutionContext =>
    ({
      getHandler: () => () => undefined,
      getClass:   () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  /** Program the reflector: first call → @RequirePermission value, second call → isPublic. */
  const program = (permission: Permission | undefined, isPublic = false) => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(permission) // PERMISSION_KEY
      .mockReturnValueOnce(isPublic);  // isPublic
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new PermissionGuard(reflector as unknown as Reflector);
  });

  it('allows a route with NO @RequirePermission (nothing to enforce)', () => {
    reflector.getAllAndOverride.mockReturnValueOnce(undefined); // no permission → early return
    expect(guard.canActivate(ctxFor({ role: 'VENDOR_FIELD' }))).toBe(true);
  });

  it('allows a @Public route even when it carries a permission', () => {
    program('users:write', true);
    expect(guard.canActivate(ctxFor(undefined))).toBe(true);
  });

  it('ALLOWS when the role satisfies the required permission', () => {
    program('users:write'); // CLIENT_ADMIN has users:write
    expect(guard.canActivate(ctxFor({ role: 'CLIENT_ADMIN' }))).toBe(true);
  });

  it('FORBIDS (403) when the role LACKS the required permission — no fail-open', () => {
    program('users:write'); // VENDOR_FIELD does NOT have users:write
    expect(() => guard.canActivate(ctxFor({ role: 'VENDOR_FIELD' }))).toThrow(ForbiddenException);
  });

  it('FORBIDS a role-manage permission for CLIENT_ADMIN (excluded from its default set)', () => {
    program('users:manage_roles'); // Gifsy-owned; CLIENT_ADMIN excluded
    expect(() => guard.canActivate(ctxFor({ role: 'CLIENT_ADMIN' }))).toThrow(ForbiddenException);
  });

  it('FORBIDS an unknown / empty role (deny-by-default)', () => {
    program('sites:read');
    expect(() => guard.canActivate(ctxFor({ role: 'NOT_A_ROLE' }))).toThrow(ForbiddenException);
  });

  it('401s a protected route with no authenticated user (belt-and-suspenders)', () => {
    program('sites:read');
    expect(() => guard.canActivate(ctxFor(undefined))).toThrow(UnauthorizedException);
  });

  it('does NOT fail open regardless of RBAC_ENFORCEMENT env (flag path removed)', () => {
    const prev = process.env.RBAC_ENFORCEMENT;
    process.env.RBAC_ENFORCEMENT = 'false'; // the old master switch — must have no effect now
    program('reports:export'); // VENDOR_FIELD lacks reports:export
    try {
      expect(() => guard.canActivate(ctxFor({ role: 'VENDOR_FIELD' }))).toThrow(ForbiddenException);
    } finally {
      if (prev === undefined) delete process.env.RBAC_ENFORCEMENT;
      else process.env.RBAC_ENFORCEMENT = prev;
    }
  });
});
