// Unit tests — InstallationService (POSM Wave 2 capture lane).
// Proves: install-before-approval → 409, vendor-scope fail-closed foreign site → 404,
// missing-photo (1:1 incompleteness) hard block, and a happy submit → SUBMITTED + integrity.

import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InstallationService } from './installation.service';

const mockPrisma = {
  site: { findFirst: jest.fn() },
  recce: { findUnique: jest.fn() },
  installation: { findFirst: jest.fn(), create: jest.fn() },
  imageHash: { findMany: jest.fn() },
  client: { findUnique: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn(),
};
const mockMedia = { recordImageHashes: jest.fn(), computeImageHash: jest.fn() };
const mockIntegrity = {
  fetchImageBytes: jest.fn(),
  hash: jest.fn(),
  beforeAfterDiffOk: jest.fn(),
  qualityFlags: jest.fn(),
  isLowAccuracy: jest.fn(),
  isClockSkewed: jest.fn(),
};

const vendorField = {
  sub: 'u1', role: 'VENDOR_FIELD', clientId: 'kwality', vendorId: 'vA', phone: '9', name: 'Field',
} as any;

const KEY = 'posm-media/kwality/install.jpg';
const activeSite = { id: 's1', clientId: 'kwality', vendorId: 'vA', status: 'ACTIVE', lat: 19.076, lng: 72.877 };
const geo = { lat: 19.0761, lng: 72.8771 };

describe('InstallationService', () => {
  let service: InstallationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InstallationService(mockPrisma as any, mockMedia as any, mockIntegrity as any);
    mockIntegrity.fetchImageBytes.mockResolvedValue(null);
    mockIntegrity.beforeAfterDiffOk.mockReturnValue(null);
    mockIntegrity.qualityFlags.mockReturnValue({ blur: false, blank: false, lowLight: false, overexposed: false, duplicate: false, lowAccuracy: false });
    mockIntegrity.isClockSkewed.mockReturnValue(false);
  });

  it('409s when the site recce is NOT APPROVED (install-before-approval)', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findUnique.mockResolvedValue({ id: 'r1', status: 'SUBMITTED', posms: [{ id: 'rp1', photo: { key: 'k' } }], installation: null });
    await expect(
      service.create(vendorField, { siteId: 's1', posms: [{ reccePosmId: 'rp1', photo: { key: KEY, geo } }] }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('409s when no recce exists for the site', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findUnique.mockResolvedValue(null);
    await expect(
      service.create(vendorField, { siteId: 's1', posms: [{ reccePosmId: 'rp1', photo: { key: KEY, geo } }] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('409s when the recce already has an installation', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findUnique.mockResolvedValue({ id: 'r1', status: 'APPROVED', posms: [{ id: 'rp1', photo: { key: 'k' } }], installation: { id: 'i0' } });
    await expect(
      service.create(vendorField, { siteId: 's1', posms: [{ reccePosmId: 'rp1', photo: { key: KEY, geo } }] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('FAIL-CLOSED: a foreign / other-vendor site is invisible (404)', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(null);
    await expect(
      service.create(vendorField, { siteId: 'foreign', posms: [{ reccePosmId: 'rp1', photo: { key: KEY, geo } }] }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockPrisma.site.findFirst.mock.calls[0][0].where).toEqual({ id: 'foreign', clientId: 'kwality', vendorId: 'vA' });
  });

  it('HARD-BLOCKS a missing photo — every recce POSM must be fulfilled (400)', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findUnique.mockResolvedValue({
      id: 'r1', status: 'APPROVED',
      posms: [{ id: 'rp1', photo: { key: 'k1' } }, { id: 'rp2', photo: { key: 'k2' } }],
      installation: null,
    });
    // Only rp1 supplied → rp2 missing → hard block.
    await expect(
      service.create(vendorField, { siteId: 's1', posms: [{ reccePosmId: 'rp1', photo: { key: KEY, geo } }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('happy path: submits → SUBMITTED, persists integrity signals, writes a CREATE audit', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findUnique.mockResolvedValue({
      id: 'r1', status: 'APPROVED',
      posms: [{ id: 'rp1', photo: { key: 'posm-media/kwality/recce.jpg', geo } }],
      installation: null,
    });
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: true, radiusMeters: 100 } } });
    mockPrisma.imageHash.findMany.mockResolvedValue([]);
    mockIntegrity.fetchImageBytes.mockResolvedValue(Buffer.alloc(16, 2));
    mockIntegrity.hash.mockReturnValue('ihash-1');
    mockIntegrity.beforeAfterDiffOk.mockReturnValue(true);
    mockIntegrity.qualityFlags.mockReturnValue({ blur: false, blank: false, lowLight: false, overexposed: false, duplicate: false, lowAccuracy: false });

    const createdRow = {
      id: 'i1', status: 'SUBMITTED', version: 1, capturedAt: null, receivedAt: new Date(),
      auditedAt: null, rejectionReasonCode: null, rejectionReason: null,
      site: { id: 's1', code: 'S1', name: 'Store', town: 'Mumbai', lat: 19.076, lng: 72.877 },
      submittedBy: { id: 'u1', name: 'Field' },
      recce: { id: 'r1', status: 'APPROVED', version: 1 },
      posms: [{
        id: 'ip1', reccePosmId: 'rp1', photo: { key: KEY }, captureLat: 19.0761, captureLng: 72.8771,
        geoFenceOk: true, distanceFromRecce: 5, beforeAfterDiffOk: true,
        qualityFlags: { blur: false, lowLight: false, overexposed: false, duplicate: false, lowAccuracy: false },
        reccePosm: { id: 'rp1', slotNo: 1, dimensions: { width: 2, height: 3, unit: 'ft' }, photo: { key: 'posm-media/kwality/recce.jpg' }, markup: null, posmType: { id: 'pt1', code: 'PT1', name: 'Board' } },
      }],
    };
    const tx = {
      installation: { create: jest.fn().mockResolvedValue(createdRow) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    mockMedia.recordImageHashes.mockResolvedValue({ dupHashes: [] });

    const res = await service.create(vendorField, { siteId: 's1', posms: [{ reccePosmId: 'rp1', photo: { key: KEY, geo } }] });

    const created = tx.installation.create.mock.calls[0][0].data;
    expect(created.status).toBe('SUBMITTED');
    expect(created.recceId).toBe('r1');
    expect(created.posms.create[0]).toMatchObject({ reccePosmId: 'rp1', beforeAfterDiffOk: true, geoFenceOk: true });
    expect(mockMedia.recordImageHashes).toHaveBeenCalledWith(tx, 'kwality', { ownerKind: 'INSTALL', ownerId: 'i1' }, ['ihash-1'], { hardBlock: true });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'CREATE', entityType: 'INSTALLATION', entityId: 'i1' });
    expect(res.status).toBe('SUBMITTED');
    expect(res.posms[0].installPhoto?.viewPath).toContain('/v1/media/view?key=');
    expect(res.posms[0].reccePhoto?.viewPath).toContain('/v1/media/view?key=');
  });

  const approvedRecce = () => ({
    id: 'r1', status: 'APPROVED',
    posms: [{ id: 'rp1', photo: { key: 'posm-media/kwality/recce.jpg', geo } }],
    installation: null,
  });

  // ── B1 fail-CLOSED on unverifiable geo ─────────────────────────────────────────
  it('B1: fence enabled + a MISSING-geo install photo → hard 403 (unverifiable)', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findUnique.mockResolvedValue(approvedRecce());
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: true, radiusMeters: 100 } } });
    mockPrisma.imageHash.findMany.mockResolvedValue([]);
    await expect(
      service.create(vendorField, { siteId: 's1', posms: [{ reccePosmId: 'rp1', photo: { key: KEY } as any }] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('B8→B1: fence enabled + an over-accuracy-cap install fix → hard 403', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findUnique.mockResolvedValue(approvedRecce());
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: true, radiusMeters: 100 } } });
    mockPrisma.imageHash.findMany.mockResolvedValue([]);
    await expect(
      service.create(vendorField, {
        siteId: 's1',
        posms: [{ reccePosmId: 'rp1', photo: { key: KEY, geo: { lat: 19.0761, lng: 72.8771, accuracy: 500 } } }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  // ── B3 hard-block install-photo reuse ──────────────────────────────────────────
  it('B3: an install photo IDENTICAL to its recce photo (beforeAfterDiffOk false) → 409, no write', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findUnique.mockResolvedValue(approvedRecce());
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: true, radiusMeters: 100 } } });
    mockPrisma.imageHash.findMany.mockResolvedValue([]);
    mockIntegrity.fetchImageBytes.mockResolvedValue(Buffer.alloc(16, 2));
    mockIntegrity.hash.mockReturnValue('ihash-1');
    mockIntegrity.beforeAfterDiffOk.mockReturnValue(false); // ≈identical → reuse
    await expect(
      service.create(vendorField, { siteId: 's1', posms: [{ reccePosmId: 'rp1', photo: { key: KEY, geo } }] }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('B3: an install photo whose exact hash was already seen (duplicate) → 409, no write', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findUnique.mockResolvedValue(approvedRecce());
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: true, radiusMeters: 100 } } });
    mockPrisma.imageHash.findMany.mockResolvedValue([{ hash: 'ihash-dup' }]); // seen elsewhere
    mockIntegrity.fetchImageBytes.mockResolvedValue(Buffer.alloc(16, 2));
    mockIntegrity.hash.mockReturnValue('ihash-dup');
    mockIntegrity.beforeAfterDiffOk.mockReturnValue(true);
    await expect(
      service.create(vendorField, { siteId: 's1', posms: [{ reccePosmId: 'rp1', photo: { key: KEY, geo } }] }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  // ── Fix 1: one photo must not fulfil multiple install POSM lines ───────────────
  it('Fix 1: the SAME photo key on two POSM lines → 400, no write ("install one, get paid for two")', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findUnique.mockResolvedValue({
      id: 'r1', status: 'APPROVED',
      posms: [{ id: 'rp1', photo: { key: 'posm-media/kwality/recce1.jpg' } }, { id: 'rp2', photo: { key: 'posm-media/kwality/recce2.jpg' } }],
      installation: null,
    });
    // PX reused on BOTH lines: differs from each recce photo (before≠after ok) and is absent from
    // the pre-existing dup store — so ONLY the in-submission key guard can catch it.
    await expect(
      service.create(vendorField, {
        siteId: 's1',
        posms: [
          { reccePosmId: 'rp1', photo: { key: KEY, geo } },
          { reccePosmId: 'rp2', photo: { key: KEY, geo } },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  // ── Fix 2: cross-submission duplicate race closed by the DB unique (P2002 → 409) ──
  it('Fix 2: a P2002 on the ImageHash (clientId, hash) unique → 409 duplicate-photo hard block', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findUnique.mockResolvedValue(approvedRecce());
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: false, radiusMeters: 100 } } });
    mockPrisma.imageHash.findMany.mockResolvedValue([]); // pre-read dup-set empty (the race window)
    mockIntegrity.fetchImageBytes.mockResolvedValue(Buffer.alloc(16, 2));
    mockIntegrity.hash.mockReturnValue('ihash-1');
    mockIntegrity.beforeAfterDiffOk.mockReturnValue(true);

    const tx = {
      installation: { create: jest.fn().mockResolvedValue({ id: 'i1' }) },
      auditLog: { create: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    // The concurrent duplicate loses the (clientId, hash) unique race on the hash insert.
    mockMedia.recordImageHashes.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: ['clientId', 'hash'] },
      } as never),
    );

    await expect(
      service.create(vendorField, { siteId: 's1', posms: [{ reccePosmId: 'rp1', photo: { key: KEY, geo } }] }),
    ).rejects.toBeInstanceOf(ConflictException);
    // hardBlock:true is what makes the duplicate insert throw rather than silently skip.
    expect(mockMedia.recordImageHashes.mock.calls[0][4]).toEqual({ hardBlock: true });
  });

  // ── A4 clean 409 on a create race ──────────────────────────────────────────────
  it('A4: a P2002 unique-violation race (one-install-per-recce) surfaces a 409, not a raw 500', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findUnique.mockResolvedValue(approvedRecce());
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: false, radiusMeters: 100 } } });
    mockPrisma.imageHash.findMany.mockResolvedValue([]);
    mockIntegrity.fetchImageBytes.mockResolvedValue(Buffer.alloc(16, 2));
    mockIntegrity.hash.mockReturnValue('ihash-1');
    mockIntegrity.beforeAfterDiffOk.mockReturnValue(true);
    mockPrisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(
      service.create(vendorField, { siteId: 's1', posms: [{ reccePosmId: 'rp1', photo: { key: KEY, geo } }] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
