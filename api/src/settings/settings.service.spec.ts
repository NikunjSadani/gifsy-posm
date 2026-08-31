import { SettingsService } from './settings.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { UpdateCaptureConfigDto } from './dto/update-capture-config.dto';

function makePrisma(settings: unknown) {
  const fns: Record<string, any> = {
    client: {
      findUnique: jest.fn().mockResolvedValue({ settings }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  fns.$transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(fns) : Promise.all(arg as Promise<unknown>[]),
  );
  return { prisma: fns as unknown as PrismaService, fns };
}

const user = (over: Partial<JwtPayload> = {}): JwtPayload => ({
  sub: 'u1', role: 'CLIENT_ADMIN', clientId: 'c1', phone: '9800000000', name: 'Admin', ...over,
});

const cfg = (over: Partial<{ enabled: boolean; radiusMeters: number; maxAccuracyMeters: number; nearbyOutletsEnabled: boolean }> = {}): UpdateCaptureConfigDto => ({
  geoFence: {
    enabled: over.enabled ?? true,
    radiusMeters: over.radiusMeters ?? 500,
    ...(over.maxAccuracyMeters !== undefined ? { maxAccuracyMeters: over.maxAccuracyMeters } : {}),
  },
  ...(over.nearbyOutletsEnabled !== undefined ? { nearbyOutletsEnabled: over.nearbyOutletsEnabled } : {}),
});

describe('SettingsService.getCaptureConfig', () => {
  it('returns SAFE defaults when settings are empty (fence off, 100 m, nearby off)', async () => {
    const { prisma } = makePrisma({});
    const res = await new SettingsService(prisma).getCaptureConfig(user());
    expect(res).toEqual({
      geoFence: { enabled: false, radiusMeters: 100, maxAccuracyMeters: 100 },
      nearbyOutletsEnabled: false,
    });
  });

  it('reads an existing posmCapture config', async () => {
    const { prisma } = makePrisma({
      posmCapture: { geoFence: { enabled: true, radiusMeters: 500, maxAccuracyMeters: 60 }, nearbyOutletsEnabled: true },
    });
    const res = await new SettingsService(prisma).getCaptureConfig(user());
    expect(res.geoFence).toEqual({ enabled: true, radiusMeters: 500, maxAccuracyMeters: 60 });
    expect(res.nearbyOutletsEnabled).toBe(true);
  });

  it('is tenant-scoped (findUnique pins the caller clientId)', async () => {
    const { prisma, fns } = makePrisma({});
    await new SettingsService(prisma).getCaptureConfig(user({ clientId: 'cX' }));
    expect(fns.client.findUnique.mock.calls[0][0].where).toEqual({ id: 'cX' });
  });
});

describe('SettingsService.putCaptureConfig', () => {
  it('merges geoFence WITHOUT clobbering sibling settings (emailReports survives)', async () => {
    const { prisma, fns } = makePrisma({
      emailReports: { enabled: true, recipients: ['ops@x.com'] },
      posmCapture: { nearbyOutletsEnabled: true },
    });
    const res = await new SettingsService(prisma).putCaptureConfig(user(), cfg({ radiusMeters: 500 }));
    const written = fns.client.update.mock.calls[0][0].data.settings;
    // sibling key preserved
    expect(written.emailReports).toEqual({ enabled: true, recipients: ['ops@x.com'] });
    // geoFence written; the pre-existing nearbyOutletsEnabled preserved (not in the DTO)
    expect(written.posmCapture.geoFence).toMatchObject({ enabled: true, radiusMeters: 500 });
    expect(written.posmCapture.nearbyOutletsEnabled).toBe(true);
    // effective response reflects the saved radius
    expect(res.geoFence.radiusMeters).toBe(500);
  });

  it('writes the tenant scope and returns the effective config', async () => {
    const { prisma, fns } = makePrisma({});
    const res = await new SettingsService(prisma).putCaptureConfig(user({ clientId: 'c9' }), cfg({ enabled: true, radiusMeters: 250, maxAccuracyMeters: 40 }));
    expect(fns.client.update.mock.calls[0][0].where).toEqual({ id: 'c9' });
    expect(res).toEqual({
      geoFence: { enabled: true, radiusMeters: 250, maxAccuracyMeters: 40 },
      nearbyOutletsEnabled: false,
    });
  });
});
