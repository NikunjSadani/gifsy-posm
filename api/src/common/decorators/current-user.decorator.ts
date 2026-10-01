import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface JwtPayload {
  sub:      string;   // user ID
  role:     string;
  clientId: string;
  phone?:   string;   // optional contact (no longer the login id — email+password login)
  email?:   string;   // login id
  name:     string;
  /**
   * True when this is an OPERATOR-CONTEXT (assume-tenant) token: a GIFSY_ADMIN
   * working inside a tenant's context. `sub` stays the real operator (audit
   * attribution); `clientId` is the assumed tenant. A normal session omits it.
   */
  assumed?: boolean;
  /**
   * Session-binding claim: the id of the UserSession this token was minted against.
   * jwt.strategy matches the bearer token to THIS session row, so revoking/rotating
   * the session invalidates the access token on its next request (not after a 7-day
   * TTL).
   */
  sid?:     string;
  /**
   * For a VENDOR-role login (VENDOR_FIELD / VENDOR_HO), the id of the Vendor entity
   * this login belongs to. Carried on the token so vendor-fleet scoping rides the
   * existing RBAC without an extra user lookup. Present only for a vendor user.
   */
  vendorId?: string;
  iat?:     number;
  exp?:     number;
}

/** Injects the decoded JWT payload into a controller parameter */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

/** Injects the clientId from the JWT — shorthand for the common case */
export const ClientId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.user?.clientId;
  },
);
