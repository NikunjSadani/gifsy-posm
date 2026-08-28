import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

/** Create a Vendor under the caller's tenant. `clientId` is pinned server-side (never client-supplied). */
export class CreateVendorDto {
  /** Tenant-unique short code (e.g. "VEN-01"). Enforced by @@unique([clientId, code]). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name: string;
}
