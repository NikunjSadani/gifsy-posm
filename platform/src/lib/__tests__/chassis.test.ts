import { describe, it, expect } from 'vitest';
import { buildCssVariables, validateClientConfig, isFeatureEnabled } from '@/lib/platform/client-config';
import { DEFAULT_CLIENT_CONFIG } from '@/lib/platform/default-client-config';
import { requiredPermissionForPath } from '@/lib/rbac/route-permissions';
import { hasPermissionFor } from '@/lib/use-permissions';
import { getRoleHome, PORTAL_ROLES } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

describe('Kwality brand theming (buildCssVariables)', () => {
  it('emits the exact Kwality tokens from the default client config', () => {
    const css = buildCssVariables(DEFAULT_CLIENT_CONFIG);
    expect(css).toContain('--brand-primary: #E3000F');       // Kwality red
    expect(css).toContain('--brand-primary-dark: #c0000d');  // Kwality red hover
    expect(css).toContain('--brand-accent: #FFD200');        // Kwality yellow
  });

  it('sanitises a malformed primary colour to the safe fallback (CSS-injection guard)', () => {
    const css = buildCssVariables({
      ...DEFAULT_CLIENT_CONFIG,
      branding: { ...DEFAULT_CLIENT_CONFIG.branding, primaryColor: 'red}</style><script>' },
    });
    expect(css).not.toContain('<script>');
    expect(css).toContain('--brand-primary: #E3000F');
  });
});

describe('client config validation + features', () => {
  it('accepts the default config', () => {
    expect(validateClientConfig(DEFAULT_CLIENT_CONFIG)).toEqual([]);
  });
  it('reads a feature flag', () => {
    expect(isFeatureEnabled(DEFAULT_CLIENT_CONFIG, 'nearbyOutlets')).toBe(false);
  });
});

describe('RBAC route → permission resolver (most-specific wins)', () => {
  it('maps a masters route to its permission', () => {
    expect(requiredPermissionForPath('/admin/vendors')).toBe('vendors:read');
    expect(requiredPermissionForPath('/admin/sites/123/edit')).toBe('sites:read');
  });
  it('leaves an unmapped route ungated (fail-open)', () => {
    expect(requiredPermissionForPath('/admin/dashboard')).toBeNull();
  });
});

describe('permission UX layer is inert for non-staff roles', () => {
  it('always grants for a non-GIFSY_STAFF role', () => {
    expect(hasPermissionFor('ASM', [], 'anything:write')).toBe(true);
  });
  it('gates a GIFSY_STAFF role by its granted set', () => {
    expect(hasPermissionFor('GIFSY_STAFF', ['sites:read'], 'sites:read')).toBe(true);
    expect(hasPermissionFor('GIFSY_STAFF', [], 'sites:read')).toBe(false);
  });
});

describe('POSM role homes', () => {
  it('routes each portal role to its home', () => {
    expect(getRoleHome('VENDOR_FIELD')).toBe('/field');
    expect(getRoleHome('AUDITOR')).toBe('/audit');
    expect(getRoleHome(null)).toBe('/auth/login');
  });
  it('has the POSM role set', () => {
    expect(PORTAL_ROLES.vendor).toContain('VENDOR_HO');
  });
});

describe('cn class merge', () => {
  it('merges + dedupes tailwind classes', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });
});
