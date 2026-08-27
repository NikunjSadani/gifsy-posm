import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Minimal per-tenant config resolver (chassis).
 *
 * POSM stores per-tenant flags on `Client.features` (Json) and per-tenant settings on
 * `Client.settings` (Json — where PosmConfig lives). This service is the read seam the
 * PermissionGuard uses for the `rbacEnforcement` opt-in; domain waves extend it.
 */
@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  // Short-lived in-memory cache of the features blob, keyed by clientId.
  private cache = new Map<string, { features: Record<string, unknown>; cachedAt: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly prisma: PrismaService) {}

  /** The raw `features` JSON blob for a tenant ({} when unknown / on read error). */
  async getFeatures(clientId: string): Promise<Record<string, unknown>> {
    const cached = this.cache.get(clientId);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL_MS) {
      return cached.features;
    }
    try {
      const client = await this.prisma.client.findUnique({
        where: { id: clientId },
        select: { features: true },
      });
      const features = (client?.features ?? {}) as Record<string, unknown>;
      this.cache.set(clientId, { features, cachedAt: Date.now() });
      return features;
    } catch {
      return {};
    }
  }

  /** Check if a specific feature flag is enabled for a client (false on any miss). */
  async isFeatureEnabled(clientId: string, feature: string): Promise<boolean> {
    if (!clientId) return false;
    const features = await this.getFeatures(clientId);
    return Boolean(features[feature] ?? false);
  }

  /** Invalidate the cached features for a client (call after a config write). */
  invalidateCache(clientId: string): void {
    this.cache.delete(clientId);
    this.logger.log(`Tenant feature cache invalidated for: ${clientId}`);
  }
}
