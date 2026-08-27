'use client';

/**
 * ClientConfigContext — provides the resolved ClientConfig to all client components.
 *
 * Usage:
 *   // In a server layout — resolve config, pass to the provider
 *   <ClientConfigProvider config={resolvedConfig}>{children}</ClientConfigProvider>
 *
 *   // In any client component
 *   const config = useClientConfig();
 *   const color  = config.branding.primaryColor;
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { ClientConfig } from './client-config';
import { DEFAULT_CLIENT_CONFIG } from './default-client-config';

const ClientConfigContext = createContext<ClientConfig>(DEFAULT_CLIENT_CONFIG);

export function ClientConfigProvider({
  config,
  children,
}: {
  config: ClientConfig;
  children: ReactNode;
}) {
  return (
    <ClientConfigContext.Provider value={config}>
      {children}
    </ClientConfigContext.Provider>
  );
}

/** Returns the ClientConfig for the current tenant. */
export function useClientConfig(): ClientConfig {
  return useContext(ClientConfigContext);
}

/** Returns true if a feature flag is enabled for the current tenant. */
export function useFeatureFlag(key: keyof ClientConfig['features']): boolean {
  const config = useClientConfig();
  return !!(config.features as unknown as Record<string, boolean>)[key];
}
