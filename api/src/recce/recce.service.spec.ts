// Unit tests — RecceService (POSM Wave 2 capture lane).
// Proves: max-2-POSM guard, vendor-scope fail-closed on a foreign site (404), geo-fence
// outside → 403, and a happy submit → SUBMITTED + CREATE audit.

import { BadRequestException, ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { RecceService } from './recce.service';

const mockPrisma = {
  site: { findFirst: jest.fn() },
  recce: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), count: jest.fn(), findMany: jest.fn() },
  posmType: { findMany: jest.fn() },
  client: { findUnique: jest.fn() },
  reccePosm: { deleteMany: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn(),
};
const mockMedia = { recordImageHashes: jest.fn(), computeImageHash: jest.fn() };
const mockIntegrity = { fetchImageBytes: jest.fn(), hash: jest.fn() };

const vendorField = {
  sub: 'u1', role: 'VENDOR_FIELD', clientId: 'kwality', vendorId: 'vA', phone: '9', name: 'Field',
} as any;

const KEY = 'posm-media/kwality/photo.jpg';
const line = (geo: { lat: number; lng: number }) => ({
  posmTypeId: 'pt1',
  dimensions: { width: 2, height: 3, unit: 'ft' },
  photo: { key: KEY, geo },
});

const activeSite = {
  id: 's1', clientId: 'kwality', vendorId: 'vA', status: 'ACTIVE', lat: 19.076, lng: 72.877,
};

describe('RecceService', () => {
  let service: RecceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RecceService(mockPrisma as any, mockMedia as any, mockIntegrity as any);
    mockIntegrity.fetchImageBytes.mockResolvedValue(null);
  });

  it('rejects more than 2 POSM lines (400) before any recce write', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    await expect(
      service.create(vendorField, { siteId: 's1', posms: [line({ lat: 19.076, lng: 72.877 }), line({ lat: 19.076, lng: 72.877 }), line({ lat: 19.076, lng: 72.877 })] as any }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('FAIL-CLOSED: a foreign / other-vendor site is invisible (404), query carries the vendor pin', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(null);
    await expect(
      service.create(vendorField, { siteId: 'foreign', posms: [line({ lat: 19.076, lng: 72.877 })] }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockPrisma.site.findFirst.mock.calls[0][0].where).toEqual({
      id: 'foreign', clientId: 'kwality', vendorId: 'vA',
    });
  });

  it('HARD-BLOCKS a photo captured outside the geo-fence (403) when the fence is enabled', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findUnique.mockResolvedValue(null);
    mockPrisma.posmType.findMany.mockResolvedValue([{ id: 'pt1', isActive: true }]);
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: true, radiusMeters: 100 } } });
    await expect(
      service.create(vendorField, { siteId: 's1', posms: [line({ lat: 19.5, lng: 72.9 })] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('409s when a site already has a live (submitted) recce (immutable)', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findUnique.mockResolvedValue({ id: 'r1', status: 'SUBMITTED' });
    await expect(
      service.create(vendorField, { siteId: 's1', posms: [line({ lat: 19.076, lng: 72.877 })] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('happy path: submits → SUBMITTED, records hashes, writes a CREATE audit', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findUnique.mockResolvedValue(null);
    mockPrisma.posmType.findMany.mockResolvedValue([{ id: 'pt1', isActive: true }]);
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: true, radiusMeters: 100 } } });
    mockIntegrity.fetchImageBytes.mockResolvedValue(Buffer.alloc(16, 1));
    mockIntegrity.hash.mockReturnValue('hash-1');

    const createdRow = {
      id: 'r1', status: 'SUBMITTED', version: 1,
      captureLat: 19.076, captureLng: 72.877, captureAccuracy: null, distanceMeters: 0,
      geoFenceOk: true, capturedAt: null, receivedAt: new Date(),
      rejectionReasonCode: null, rejectionReason: null,
      site: { id: 's1', code: 'S1', name: 'Store', town: 'Mumbai', lat: 19.076, lng: 72.877 },
      submittedBy: { id: 'u1', name: 'Field' },
      posms: [{ id: 'rp1', slotNo: 1, posmTypeId: 'pt1', dimensions: { width: 2, height: 3, unit: 'ft' }, photo: { key: KEY }, markup: null, posmType: { id: 'pt1', code: 'PT1', name: 'Board' } }],
    };
    const tx = {
      recce: { create: jest.fn().mockResolvedValue(createdRow) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      reccePosm: { deleteMany: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    mockMedia.recordImageHashes.mockResolvedValue({ dupHashes: [] });

    const res = await service.create(vendorField, { siteId: 's1', posms: [line({ lat: 19.0761, lng: 72.8771 })] });

    expect(tx.recce.create.mock.calls[0][0].data.status).toBe('SUBMITTED');
    expect(tx.recce.create.mock.calls[0][0].data.submittedById).toBe('u1');
    expect(mockMedia.recordImageHashes).toHaveBeenCalledWith(
      tx, 'kwality', { ownerKind: 'RECCE', ownerId: 'r1' }, ['hash-1'],
    );
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'CREATE', entityType: 'RECCE', entityId: 'r1', actorId: 'u1',
    });
    expect(res.status).toBe('SUBMITTED');
    expect(res.posms[0].photo?.viewPath).toContain('/v1/media/view?key=');
  });
});
