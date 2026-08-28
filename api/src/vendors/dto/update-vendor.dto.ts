import { IsString, IsNotEmpty, IsOptional, IsBoolean, MaxLength } from 'class-validator';

/** Partial update of a Vendor. Every field optional; `clientId` can never be changed. */
export class UpdateVendorDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name?: string;

  /** Reactivate (true) or deactivate (false). A dedicated DELETE endpoint also soft-deactivates. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
