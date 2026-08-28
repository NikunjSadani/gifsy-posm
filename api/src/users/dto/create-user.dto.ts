import {
  IsString,
  IsNotEmpty,
  IsMobilePhone,
  IsIn,
  IsOptional,
  MaxLength,
} from 'class-validator';

/**
 * Roles an admin may provision here. GIFSY_ADMIN (platform operator) is intentionally NOT
 * provisionable through this tenant-admin API.
 */
export const MANAGED_ROLES = [
  'CLIENT_ADMIN',
  'ASM',
  'AUDITOR',
  'VENDOR_HO',
  'VENDOR_FIELD',
] as const;
export type ManagedRole = (typeof MANAGED_ROLES)[number];

export class CreateUserDto {
  @IsMobilePhone('en-IN', {}, { message: 'Must be a valid 10-digit Indian mobile number' })
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsIn(MANAGED_ROLES, {
    message: `role must be one of: ${MANAGED_ROLES.join(', ')}`,
  })
  role: ManagedRole;

  /**
   * REQUIRED for VENDOR_FIELD / VENDOR_HO (the vendor whose fleet this login belongs to);
   * MUST be absent for every non-vendor role. Enforced in the service (not just here) so the
   * update path shares the same invariant.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  vendorId?: string;
}
