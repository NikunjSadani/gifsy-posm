import { can, permissionsForRole, DEFAULT_ROLE_PERMISSIONS } from './can';
import { ALL_PERMISSIONS } from './permissions';

describe('RBAC engine (POSM)', () => {
  it('grants GIFSY_ADMIN every permission in the catalog', () => {
    for (const p of ALL_PERMISSIONS) {
      expect(can('GIFSY_ADMIN', p)).toBe(true);
    }
  });

  it('lets VENDOR_FIELD submit a recce but not approve one', () => {
    expect(can('VENDOR_FIELD', 'recce:submit')).toBe(true);
    expect(can('VENDOR_FIELD', 'recce:approve')).toBe(false);
  });

  it('lets ASM approve a recce but not audit an installation', () => {
    expect(can('ASM', 'recce:approve')).toBe(true);
    expect(can('ASM', 'install:audit')).toBe(false);
  });

  it('lets AUDITOR audit an installation but not approve a recce', () => {
    expect(can('AUDITOR', 'install:audit')).toBe(true);
    expect(can('AUDITOR', 'recce:approve')).toBe(false);
  });

  it('denies everything to an unknown role', () => {
    expect(permissionsForRole('NOT_A_ROLE')).toEqual([]);
    expect(can('NOT_A_ROLE', 'sites:read')).toBe(false);
  });

  it('applies a per-tenant override as a full replacement', () => {
    expect(can('VENDOR_HO', 'sites:write', { VENDOR_HO: ['sites:write'] })).toBe(true);
    // The override replaces the whole set → a default perm not in the override is gone.
    expect(can('VENDOR_HO', 'sites:read', { VENDOR_HO: ['sites:write'] })).toBe(false);
  });

  it('never lets CLIENT_ADMIN manage roles or write tenancy config', () => {
    expect(can('CLIENT_ADMIN', 'users:manage_roles')).toBe(false);
    expect(can('CLIENT_ADMIN', 'tenancy:write')).toBe(false);
    expect(can('CLIENT_ADMIN', 'sites:write')).toBe(true);
  });

  it('returns a defensive copy from permissionsForRole', () => {
    const a = permissionsForRole('ASM');
    a.push('sites:write');
    expect(DEFAULT_ROLE_PERMISSIONS.ASM).not.toContain('sites:write');
  });
});
