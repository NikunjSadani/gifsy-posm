import { IsString, IsNotEmpty, IsMobilePhone, IsIn, Length } from 'class-validator';

export class SendOtpDto {
  @IsMobilePhone('en-IN', {}, { message: 'Must be a valid 10-digit Indian mobile number' })
  @IsNotEmpty()
  phone: string;

  @IsIn(['SMS', 'WHATSAPP'], { message: 'channel must be SMS or WHATSAPP' })
  channel: 'SMS' | 'WHATSAPP';

  /**
   * The tenant the OTP is for (the FE resolves it from the request Host, pre-auth). REQUIRED:
   * it gates the "no account" check, binds the minted OTP to this tenant (so it can't redeem
   * against another), and closes the unbranded path that would otherwise send an SMS to ANY
   * number (SMS-cost / harassment abuse) and skip the account gate. verify-otp already requires
   * clientId, so a legit branded login always supplies it.
   */
  @IsString()
  @IsNotEmpty()
  clientId: string;
}

export class VerifyOtpDto {
  @IsMobilePhone('en-IN', {}, { message: 'Must be a valid 10-digit Indian mobile number' })
  @IsNotEmpty()
  phone: string;

  @IsString()
  @Length(4, 6, { message: 'OTP must be 4–6 digits' })
  otp: string;

  /** The subdomain slug resolved by the proxy — passed from the frontend. */
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
