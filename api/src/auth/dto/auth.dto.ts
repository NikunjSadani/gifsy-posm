import { IsString, IsNotEmpty, IsEmail, MaxLength } from 'class-validator';

/**
 * POST /v1/auth/login — email + password (replaced phone + OTP, 2026-10-01). `clientId` is the
 * tenant (the FE supplies it, resolved from NEXT_PUBLIC_CLIENT_ID / host); it scopes the lookup so
 * an email in tenant A can never authenticate against tenant B.
 */
export class LoginDto {
  @IsEmail({}, { message: 'A valid email is required' })
  @MaxLength(254)
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MaxLength(200)
  password: string;

  @IsString()
  @IsNotEmpty()
  clientId: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

/** POST /v1/auth/assume-tenant — the GIFSY operator-context switcher. */
export class AssumeTenantDto {
  /** The target tenant's clientId to work inside. */
  @IsString()
  @IsNotEmpty()
  clientId: string;
}
