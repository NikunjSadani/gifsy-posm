import {
  IsString,
  IsNotEmpty,
  IsMobilePhone,
  IsIn,
  IsOptional,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { MANAGED_ROLES, ManagedRole } from './create-user.dto';

/**
 * Partial update. When `role` and/or `vendorId` change, the service re-validates the
 * vendor-linkage invariant against the RESULTING role — a role flip to/from a vendor role
 * must keep vendorId consistent. Passing vendorId as null clears the link.
 */
export class UpdateUserDto {
  @IsOptional()
  @IsMobilePhone('en-IN', {}, { message: 'Must be a valid 10-digit Indian mobile number' })
  phone?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(MANAGED_ROLES, {
    message: `role must be one of: ${MANAGED_ROLES.join(', ')}`,
  })
  role?: ManagedRole;

  /** Set to a vendor id, or null to clear. Absence (undefined) leaves the link unchanged. */
  @IsOptional()
  @IsString()
  vendorId?: string | null;

  /** Promoter/employee code; "" clears it. Absence (undefined) leaves it unchanged. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  promoterCode?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
