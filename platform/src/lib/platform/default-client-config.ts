/**
 * DEFAULT_CLIENT_CONFIG — the single generic client config for the POSM chassis.
 *
 * The loyalty multi-tenant CLIENT_REGISTRY (Deoleo et al.) is stripped: Wave 0 ships one
 * generic client, themed to the Kwality palette the client liked. It is used wherever a
 * resolved per-tenant config isn't available:
 *   - the ClientConfigContext default (before a provider mounts),
 *   - the server-side getTenantConfig() fallback.
 *
 * Real per-tenant branding is layered on in a later wave (subdomain → backend tenant-config).
 */

import type { ClientConfig } from './client-config';

export const DEFAULT_CLIENT_CONFIG: ClientConfig = {
  slug: 'default',
  internalName: 'POSM Field Execution',
  status: 'ONBOARDING',
  onboardedAt: '1970-01-01',

  branding: {
    displayName: 'Field Rewards',
    primaryColor: '#E3000F',      // Kwality red
    primaryColorDark: '#c0000d',  // Kwality red hover/press
    accentColor: '#FFD200',       // Kwality yellow
    logoUrl: '/kwality-walls-logo.png',
    faviconUrl: '',
    supportEmail: '',
    supportPhone: '',
  },

  features: {
    nearbyOutlets: false,
    rbacEnforcement: false,
  },
};
