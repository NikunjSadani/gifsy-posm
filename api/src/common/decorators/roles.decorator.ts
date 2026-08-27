import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Restrict an endpoint to specific roles.
 * Usage: @Roles('GIFSY_ADMIN', 'CLIENT_ADMIN')
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/** Allow endpoint without authentication (public route) */
export const Public = () => SetMetadata('isPublic', true);
