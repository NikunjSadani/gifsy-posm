import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import {
  readPosmCaptureConfig,
  readGpsAccuracyCapMeters,
} from '../capture-integrity/posm-config.helper';
import { UpdateCaptureConfigDto } from './dto/update-capture-config.dto';

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

export interface CaptureConfigResponse {
  geoFence: { enabled: boolean; radiusMeters: number; maxAccuracyMeters: number };
  nearbyOutletsEnabled: boolean;
}

/**
 * SettingsService — the per-tenant POSM capture config (geo-fence) behind the admin Settings
 * page. Reads through the SAME `posm-config.helper` the recce/installation lanes use, so what
 * the admin sees and edits is exactly what the capture pipeline enforces. Writes are
 * tenant-scoped and merge into `Client.settings.posmCapture` WITHOUT clobbering sibling
 * settings (emailReports, etc.).
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /v1/settings/capture — the effective config for the caller's tenant. */
  async getCaptureConfig(user: JwtPayload): Promise<CaptureConfigResponse> {
    const client = await this.prisma.client.findUnique({
      where: { id: user.clientId },
      select: { settings: true },
    });
    return this.effective(client?.settings);
  }

  /** PUT /v1/settings/capture — validate + merge into Client.settings.posmCapture, return effective. */
  async putCaptureConfig(user: JwtPayload, dto: UpdateCaptureConfigDto): Promise<CaptureConfigResponse> {
    // Interactive transaction (re-read + merge + write on one connection) to shrink the
    // lost-update window against a concurrent settings writer (same pattern as reports config).
    const merged = await this.prisma.$transaction(async (tx) => {
      const client = await tx.client.findUnique({
        where: { id: user.clientId },
        select: { settings: true },
      });
      const settings = isObject(client?.settings) ? { ...client!.settings } : {};
      const prevCapture = isObject(settings.posmCapture) ? settings.posmCapture : {};
      const prevGeo = isObject(prevCapture.geoFence) ? prevCapture.geoFence : {};

      const geoFence: Record<string, unknown> = {
        ...prevGeo,
        enabled: dto.geoFence.enabled,
        radiusMeters: dto.geoFence.radiusMeters,
      };
      if (dto.geoFence.maxAccuracyMeters !== undefined) {
        geoFence.maxAccuracyMeters = dto.geoFence.maxAccuracyMeters;
      }

      const posmCapture: Record<string, unknown> = { ...prevCapture, geoFence };
      if (dto.nearbyOutletsEnabled !== undefined) {
        posmCapture.nearbyOutletsEnabled = dto.nearbyOutletsEnabled;
      }

      const next = { ...settings, posmCapture } as Prisma.InputJsonValue;
      await tx.client.update({ where: { id: user.clientId }, data: { settings: next } });
      return next;
    });
    // Resolve through the SAME reader the capture lanes use, so the response reflects exactly
    // what will be enforced (incl. any clamping/defaults the resolver applies).
    return this.effective(merged);
  }

  private effective(settings: unknown): CaptureConfigResponse {
    const cfg = readPosmCaptureConfig(settings);
    return {
      geoFence: {
        enabled: cfg.geoFence.enabled,
        radiusMeters: cfg.geoFence.radiusMeters,
        maxAccuracyMeters: readGpsAccuracyCapMeters(settings),
      },
      nearbyOutletsEnabled: cfg.nearbyOutletsEnabled ?? false,
    };
  }
}
