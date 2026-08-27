/**
 * Server-side tenant helpers.
 * Import these only in Server Components and API routes — not in client components.
 */

import { headers } from 'next/headers';
import { buildCssVariables } from './client-config';
import { DEFAULT_CLIENT_CONFIG } from './default-client-config';
import type { ClientConfig } from './client-config';

/**
 * Returns the ClientConfig for the current request.
 *
 * Chassis version: the loyalty multi-tenant registry + DB routing snapshot are stripped, so
 * this always returns the single generic DEFAULT_CLIENT_CONFIG. The x-tenant-slug header
 * (set by the proxy) is read so per-tenant resolution can be re-introduced in a later wave
 * without changing this call's signature or its callers.
 */
export async function getTenantConfig(): Promise<ClientConfig> {
  const hdrs = await headers();
  // Read (but do not yet branch on) the slug — reserved for per-tenant resolution later.
  void hdrs.get('x-tenant-slug');
  return DEFAULT_CLIENT_CONFIG;
}

/**
 * Returns the brand CSS-variable block to inject into <head> in the root layout.
 * <style dangerouslySetInnerHTML={{ __html: getBrandStyle(config) }} />
 */
export function getBrandStyle(config: ClientConfig): string {
  return buildCssVariables(config);
}
