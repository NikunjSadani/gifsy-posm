import { isFixedOtpAllowed } from './fixed-otp';

const env = (o: Record<string, string | undefined>) => o as unknown as NodeJS.ProcessEnv;

describe('isFixedOtpAllowed — fail-closed prod guard', () => {
  it('ALLOWS an explicit development runtime', () => {
    expect(isFixedOtpAllowed(env({ NODE_ENV: 'development', DATABASE_URL: 'postgres://h/posm_dev' }))).toBe(true);
  });

  it('ALLOWS an explicit test runtime', () => {
    expect(isFixedOtpAllowed(env({ NODE_ENV: 'test' }))).toBe(true);
  });

  it('DENIES a production runtime with no opt-in', () => {
    expect(isFixedOtpAllowed(env({ NODE_ENV: 'production', DATABASE_URL: 'postgres://h/anything' }))).toBe(false);
  });

  it('DENIES when NODE_ENV is UNSET (the prod-misconfig hole) — even if the DB name is unknown', () => {
    // A prod box that forgot NODE_ENV must NOT fall through to "allowed".
    expect(isFixedOtpAllowed(env({ DATABASE_URL: 'postgres://h/whatever_prod_db' }))).toBe(false);
  });

  it('DENIES an unrecognized NODE_ENV value', () => {
    expect(isFixedOtpAllowed(env({ NODE_ENV: 'staging' }))).toBe(false);
    expect(isFixedOtpAllowed(env({ NODE_ENV: 'PRODUCTION' }))).toBe(false); // case-sensitive on purpose
  });

  it('ALLOWS the staging UAT box only with the opt-in AND a positive posm_staging match', () => {
    expect(isFixedOtpAllowed(env({ NODE_ENV: 'production', ALLOW_FIXED_OTP: 'true', DATABASE_URL: 'postgres://h/posm_staging' }))).toBe(true);
    // opt-in without the staging DB name → denied
    expect(isFixedOtpAllowed(env({ NODE_ENV: 'production', ALLOW_FIXED_OTP: 'true', DATABASE_URL: 'postgres://h/other' }))).toBe(false);
    // staging DB name without the opt-in → denied
    expect(isFixedOtpAllowed(env({ NODE_ENV: 'production', DATABASE_URL: 'postgres://h/posm_staging' }))).toBe(false);
  });

  it('layer-1: NEVER allowed on the known prod DB, whatever else says', () => {
    expect(isFixedOtpAllowed(env({ NODE_ENV: 'development', DATABASE_URL: 'postgres://h/posm_prod' }))).toBe(false);
    expect(isFixedOtpAllowed(env({ NODE_ENV: 'test', ALLOW_FIXED_OTP: 'true', DATABASE_URL: 'postgres://h/posm_prod' }))).toBe(false);
  });
});
