import { describe, it, expect } from 'vitest';
import {
  validateVendor,
  validatePosmType,
  validateUser,
  validateSite,
  isValidIndianMobile,
  isValid,
} from '@/lib/admin/validation';

describe('isValidIndianMobile', () => {
  it('accepts a 10-digit number starting 6–9', () => {
    expect(isValidIndianMobile('9830011252')).toBe(true);
    expect(isValidIndianMobile('6289864191')).toBe(true);
  });
  it('rejects wrong length, wrong lead digit, or non-digits', () => {
    expect(isValidIndianMobile('12345')).toBe(false);
    expect(isValidIndianMobile('1234567890')).toBe(false); // leads with 1
    expect(isValidIndianMobile('98300112521')).toBe(false); // 11 digits
    expect(isValidIndianMobile('98300a1252')).toBe(false);
  });
});

describe('validateVendor', () => {
  it('passes a good vendor', () => {
    expect(isValid(validateVendor({ code: 'VEN-01', name: 'Acme' }))).toBe(true);
  });
  it('requires code and name', () => {
    const e = validateVendor({ code: '  ', name: '' });
    expect(e.code).toBeDefined();
    expect(e.name).toBeDefined();
  });
  it('enforces max lengths', () => {
    expect(validateVendor({ code: 'x'.repeat(51), name: 'ok' }).code).toBeDefined();
    expect(validateVendor({ code: 'ok', name: 'y'.repeat(161) }).name).toBeDefined();
  });
});

describe('validatePosmType', () => {
  it('passes with no dimensions', () => {
    expect(isValid(validatePosmType({ code: 'GB', name: 'Glow board' }))).toBe(true);
  });
  it('passes with a full valid dimension set', () => {
    const e = validatePosmType({ code: 'GB', name: 'Glow', width: '10', height: '20', unit: 'cm' });
    expect(isValid(e)).toBe(true);
  });
  it('requires all three dims together when any is present', () => {
    const e = validatePosmType({ code: 'GB', name: 'Glow', width: '10', height: '', unit: '' });
    expect(e.height).toBeDefined();
    expect(e.unit).toBeDefined();
  });
  it('rejects non-positive dimensions', () => {
    const e = validatePosmType({ code: 'GB', name: 'Glow', width: '0', height: '-3', unit: 'cm' });
    expect(e.width).toBeDefined();
    expect(e.height).toBeDefined();
  });
});

describe('validateUser (email login + role ↔ vendor invariant)', () => {
  it('passes an ASM with an email and no vendor/phone', () => {
    expect(isValid(validateUser({ name: 'A', email: 'a@kw.in', role: 'ASM' }))).toBe(true);
  });
  it('requires an email', () => {
    const e = validateUser({ name: 'A', email: '', role: 'ASM' });
    expect(e.email).toBeDefined();
  });
  it('rejects a malformed email', () => {
    const e = validateUser({ name: 'A', email: 'not-an-email', role: 'ASM' });
    expect(e.email).toBeDefined();
  });
  it('phone is OPTIONAL but validated when present', () => {
    expect(isValid(validateUser({ name: 'A', email: 'a@kw.in', role: 'ASM', phone: '' }))).toBe(true);
    const e = validateUser({ name: 'A', email: 'a@kw.in', role: 'ASM', phone: '123' });
    expect(e.phone).toBeDefined();
  });
  it('rejects a too-short password when supplied', () => {
    const e = validateUser({ name: 'A', email: 'a@kw.in', role: 'ASM', password: 'abc' });
    expect(e.password).toBeDefined();
  });
  it('requires a vendorId for a vendor role', () => {
    const e = validateUser({ name: 'V', email: 'v@kw.in', role: 'VENDOR_FIELD' });
    expect(e.vendorId).toBeDefined();
  });
  it('accepts a vendor role WITH a vendorId', () => {
    const e = validateUser({ name: 'V', email: 'v@kw.in', role: 'VENDOR_HO', vendorId: 'ven_1' });
    expect(isValid(e)).toBe(true);
  });
  it('forbids a vendorId on a non-vendor role', () => {
    const e = validateUser({ name: 'A', email: 'a@kw.in', role: 'CLIENT_ADMIN', vendorId: 'ven_1' });
    expect(e.vendorId).toBeDefined();
  });
  it('rejects an unknown role', () => {
    const e = validateUser({ name: 'A', email: 'a@kw.in', role: 'SUPERUSER' });
    expect(e.role).toBeDefined();
  });
});

describe('validateSite (lat/lng pairing + range)', () => {
  it('passes with no coords', () => {
    expect(isValid(validateSite({ code: 'S1', name: 'Store' }))).toBe(true);
  });
  it('passes with a valid coord pair', () => {
    expect(isValid(validateSite({ code: 'S1', name: 'Store', lat: '22.5', lng: '88.3' }))).toBe(true);
  });
  it('rejects only-one-of lat/lng', () => {
    const e = validateSite({ code: 'S1', name: 'Store', lat: '22.5' });
    expect(e.lat).toBeDefined();
  });
  it('rejects out-of-range coords', () => {
    const e = validateSite({ code: 'S1', name: 'Store', lat: '99', lng: '200' });
    expect(e.lat).toBeDefined();
    expect(e.lng).toBeDefined();
  });
});
