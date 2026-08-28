import { vendorScope, tenantScope, platformWide } from './tenant-scope';
import type { JwtPayload } from './decorators/current-user.decorator';

/**
 * vendorScope (audit finding 2) confines a vendor-role login to its OWN vendor's fleet.
 * Every vendor-facing query must AND this into its where-clause; these tests lock the
 * contract so the confinement can't silently regress.
 */
const mk = (over: Partial<JwtPayload>): JwtPayload => ({
  sub:      'u1',
  role:     'VENDOR_FIELD',
  clientId: 'c1',
  phone:    '9800000000',
  name:     'Test',
  ...over,
});

describe('vendorScope', () => {
  it('returns the vendorId for a VENDOR_FIELD login', () => {
    expect(vendorScope(mk({ role: 'VENDOR_FIELD', vendorId: 'v1' }))).toBe('v1');
  });

  it('returns the vendorId for a VENDOR_HO login', () => {
    expect(vendorScope(mk({ role: 'VENDOR_HO', vendorId: 'v2' }))).toBe('v2');
  });

  it('returns null for a vendor role with NO vendorId (fail-closed: match nothing, never unscoped)', () => {
    expect(vendorScope(mk({ role: 'VENDOR_FIELD', vendorId: undefined }))).toBeNull();
  });

  it('returns null for non-vendor roles (tenant scope governs instead)', () => {
    expect(vendorScope(mk({ role: 'CLIENT_ADMIN', vendorId: undefined }))).toBeNull();
    expect(vendorScope(mk({ role: 'ASM' }))).toBeNull();
    expect(vendorScope(mk({ role: 'AUDITOR' }))).toBeNull();
    expect(vendorScope(mk({ role: 'GIFSY_ADMIN' }))).toBeNull();
  });

  it('never leaks another vendor: a VENDOR_HO with vendorId v2 does not scope to v1', () => {
    expect(vendorScope(mk({ role: 'VENDOR_HO', vendorId: 'v2' }))).not.toBe('v1');
  });

  it('is orthogonal to tenantScope/platformWide (vendor scope narrows WITHIN a tenant read)', () => {
    const vendorUser = mk({ role: 'VENDOR_FIELD', vendorId: 'v1', clientId: 'c9' });
    expect(platformWide(vendorUser)).toBe(false);
    expect(tenantScope(vendorUser)).toBe('c9'); // still tenant-pinned
    expect(vendorScope(vendorUser)).toBe('v1'); // AND vendor-pinned
  });
});
