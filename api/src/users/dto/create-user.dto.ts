import {
  IsString,
  IsNotEmpty,
  IsMobilePhone,
  IsIn,
  IsOptional,
  IsEmail,
  MinLength,
  MaxLength,
} from 'class-validator';
import { MIN_PASSWORD_LENGTH } from '../../common/password';

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
  /** Login id — REQUIRED, unique per tenant (replaced phone+OTP, 2026-10-01). */
  @IsEmail({}, { message: 'A valid email is required' })
  @MaxLength(254)
  email: string;

  /**
   * Optional at create — when omitted the account has no password and cannot log in until an
   * admin sets one (admin-managed). Minimum length enforced when supplied.
   */
  @IsOptional()
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, { message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` })
  @MaxLength(200)
  password?: string;

  /** Optional contact number (no longer the login id). */
  @IsOptional()
  @IsMobilePhone('en-IN', {}, { message: 'Must be a valid 10-digit Indian mobile number' })
  phone?: string;

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

  /**
   * Field-user promoter/employee code (the report's "Promoter ID" column). Optional and owner-
   * supplied; unique per tenant when set. An empty string is treated as "no code" by the service.
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  promoterCode?: string;
}
