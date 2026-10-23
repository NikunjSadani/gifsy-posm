// Unit tests — RecceService (POSM Wave 2 capture lane).
// Proves: max-2-POSM guard, vendor-scope fail-closed on a foreign site (404), geo-fence
// outside → 403, and a happy submit → SUBMITTED + CREATE audit.

import { BadRequestException, ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RecceService } from './recce.service';

const mockPrisma = {
  site: { findFirst: jest.fn() },
  recce: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), count: jest.fn(), findMany: jest.fn() },
  posmType: { findMany: jest.fn() },
  client: { findUnique: jest.fn() },
  reccePosm: { deleteMany: jest.fn() },
  imageHash: { findMany: jest.fn(), findFirst: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn(),
};
const mockMedia = { recordImageHashes: jest.fn(), computeImageHash: jest.fn() };
// isLowAccuracy / isClockSkewed use REAL logic so present()'s computed reviewer flags are
// exercised (B5/B6), not stubbed away.
const mockIntegrity = {
  fetchImageBytes: jest.fn(),
  hash: jest.fn(),
  isLowAccuracy: (a: unknown) => typeof a === 'number' && a > 100,
  isClockSkewed: (c: unknown, r: Date) => {
    if (!c) return false;
    const t = c instanceof Date ? c.getTime() : Date.parse(String(c));
    return !Number.isNaN(t) && Math.abs(t - r.getTime()) > 10 * 60 * 1000;
  },
  // qualityFlags uses REAL-shaped logic so prepare()'s per-POSM stored flags are exercised:
  // blur/lowLight/overexposed are false on our synthetic buffers (undecodable → neutral), and
  // lowAccuracy is driven off the photo's own geo accuracy. `duplicate` is dropped by the recce
  // lane before persist, so it never lands on the per-POSM object.
  qualityFlags: async (
    _bytes: Buffer | null,
    signals: { duplicate: boolean; accuracy: number | null | undefined },
  ) => ({
    blur: false,
    blank: false,
    lowLight: false,
    overexposed: false,
    duplicate: signals.duplicate,
    lowAccuracy: typeof signals.accuracy === 'number' && signals.accuracy > 100,
  }),
};

const vendorField = {
  sub: 'u1', role: 'VENDOR_FIELD', clientId: 'kwality', vendorId: 'vA', phone: '9', name: 'Field',
} as any;

const KEY = 'posm-media/kwality/photo.jpg';
const line = (geo: { lat: number; lng: number }) => ({
  posmTypeId: 'pt1',
  dimensions: { width: 2, height: 3, unit: 'ft' },
  photo: { key: KEY, geo },
  // Marking is compulsory — every recce line carries a markup (>= 1 shape).
  markup: { version: 1 as const, shapes: [{ type: 'rect' as const, x: 0.2, y: 0.3, w: 0.4, h: 0.25 }] },
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

  it('rejects (400) two POSM lines that reuse the SAME photo — no write (parity with install lane)', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findFirst.mockResolvedValue(null);
    mockPrisma.posmType.findMany.mockResolvedValue([{ id: 'pt1', isActive: true }]);
    // Both lines carry the same hardcoded KEY → one photo can't fill two distinct POSM slots.
    await expect(
      service.create(vendorField, {
        siteId: 's1',
        posms: [line({ lat: 19.076, lng: 72.877 }), line({ lat: 19.076, lng: 72.877 })],
      }),
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
    mockPrisma.recce.findFirst.mockResolvedValue(null);
    mockPrisma.posmType.findMany.mockResolvedValue([{ id: 'pt1', isActive: true }]);
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: true, radiusMeters: 100 } } });
    await expect(
      service.create(vendorField, { siteId: 's1', posms: [line({ lat: 19.5, lng: 72.9 })] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('409s when a site already has a live (submitted) recce (immutable)', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findFirst.mockResolvedValue({ id: 'r1', status: 'SUBMITTED' });
    await expect(
      service.create(vendorField, { siteId: 's1', posms: [line({ lat: 19.076, lng: 72.877 })] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('happy path: submits → SUBMITTED, records hashes, writes a CREATE audit', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findFirst.mockResolvedValue(null);
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

  // ── B1 fail-CLOSED on unverifiable geo ─────────────────────────────────────────
  it('B1: fence enabled + a MISSING-geo photo → hard 403 (unverifiable no longer passes)', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findFirst.mockResolvedValue(null);
    mockPrisma.posmType.findMany.mockResolvedValue([{ id: 'pt1', isActive: true }]);
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: true, radiusMeters: 100 } } });
    // A photo with NO geo at all — previously fell through as a soft null and PASSED.
    const noGeoLine = { posmTypeId: 'pt1', dimensions: { width: 2, height: 3, unit: 'ft' }, photo: { key: KEY } };
    await expect(
      service.create(vendorField, { siteId: 's1', posms: [noGeoLine as any] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('B8→B1: fence enabled + an over-accuracy-cap fix → hard 403 (unverifiable)', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findFirst.mockResolvedValue(null);
    mockPrisma.posmType.findMany.mockResolvedValue([{ id: 'pt1', isActive: true }]);
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: true, radiusMeters: 100 } } });
    const poorFix = { posmTypeId: 'pt1', dimensions: { width: 2, height: 3, unit: 'ft' }, photo: { key: KEY, geo: { lat: 19.0761, lng: 72.8771, accuracy: 500 } } };
    await expect(
      service.create(vendorField, { siteId: 's1', posms: [poorFix as any] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  // ── A1 resubmit scope fail-closed ──────────────────────────────────────────────
  it('A1: resubmit with a NULL vendor scope is DENIED (404) BEFORE any findFirst', async () => {
    const vendorNoId = { sub: 'u1', role: 'VENDOR_FIELD', clientId: 'kwality', phone: '9', name: 'F' } as any; // no vendorId
    await expect(
      service.resubmit(vendorNoId, 'r1', { posms: [line({ lat: 19.076, lng: 72.877 })] }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // The where must NEVER collapse to `{ id }` — the scoped query is not even issued.
    expect(mockPrisma.recce.findFirst).not.toHaveBeenCalled();
  });

  // ── Resubmit sends the recce straight to HO (hoReviewStatus PENDING for ALL modes) ──────────
  it('resubmit: a REJECTED recce → SUBMITTED, clears the stale HO reviewer fields, re-enters HO (hoReviewStatus PENDING)', async () => {
    mockPrisma.posmType.findMany.mockResolvedValue([{ id: 'pt1', isActive: true }]);
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: false, radiusMeters: 100 } } });
    mockIntegrity.fetchImageBytes.mockResolvedValue(Buffer.alloc(16, 1));
    mockIntegrity.hash.mockReturnValue('hash-1');
    // The scoped findFirst returns a REJECTED recce whose HO stage was previously stamped.
    mockPrisma.recce.findFirst.mockResolvedValue({
      id: 'r1', status: 'REJECTED', version: 2,
      hoReviewStatus: 'REJECTED', hoReviewedById: 'ho-9', hoReviewedAt: new Date(),
      hoRejectionReasonCode: 'BLURRY', hoRejectionReason: 'HO said redo',
      site: { ...activeSite },
    });

    const updatedRow = {
      id: 'r1', status: 'SUBMITTED', version: 3,
      captureLat: 19.076, captureLng: 72.877, captureAccuracy: null, distanceMeters: 0, geoFenceOk: null,
      capturedAt: null, receivedAt: new Date(),
      rejectionReasonCode: null, rejectionReason: null,
      hoReviewStatus: 'PENDING', hoRejectionReasonCode: null, hoRejectionReason: null,
      site: { id: 's1', code: 'S1', name: 'Store', town: 'Mumbai', lat: 19.076, lng: 72.877 },
      submittedBy: { id: 'u1', name: 'Field' },
      posms: [{ id: 'rp1', slotNo: 1, posmTypeId: 'pt1', dimensions: {}, photo: { key: KEY }, markup: null, qualityFlags: null, posmType: { id: 'pt1', code: 'PT1', name: 'Board' } }],
    };
    const tx = {
      recce: { update: jest.fn().mockResolvedValue(updatedRow) },
      reccePosm: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    mockMedia.recordImageHashes.mockResolvedValue({ dupHashes: [] });

    await service.resubmit(vendorField, 'r1', { posms: [line({ lat: 19.0761, lng: 72.8771 })] });

    const data = tx.recce.update.mock.calls[0][0].data;
    expect(data.status).toBe('SUBMITTED');
    // ASM-review fields cleared (pre-existing contract)...
    expect(data.approvedById).toBeNull();
    expect(data.reviewedAt).toBeNull();
    expect(data.rejectionReasonCode).toBeNull();
    expect(data.rejectionReason).toBeNull();
    // ...AND the recce re-enters the pipeline STRAIGHT at HO (hoReviewStatus PENDING), skipping ASM
    // — for an APP recce too (previously an app resubmit returned to NONE / re-entered the ASM queue).
    expect(data.hoReviewStatus).toBe('PENDING');
    // The stale HO reviewer fields are still cleared so the fresh HO review starts clean.
    expect(data.hoReviewedById).toBeNull();
    expect(data.hoReviewedAt).toBeNull();
    expect(data.hoRejectionReasonCode).toBeNull();
    expect(data.hoRejectionReason).toBeNull();
  });

  it('resubmit: a MANUAL recce ALSO re-enters at HO (hoReviewStatus PENDING) — unchanged behaviour', async () => {
    mockPrisma.posmType.findMany.mockResolvedValue([{ id: 'pt1', isActive: true }]);
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: false, radiusMeters: 100 } } });
    mockIntegrity.fetchImageBytes.mockResolvedValue(null);
    mockPrisma.recce.findFirst.mockResolvedValue({
      id: 'rM', status: 'REJECTED', version: 2, recceMode: 'MANUAL',
      hoReviewStatus: 'REJECTED', hoReviewedById: 'ho-9', hoReviewedAt: new Date(),
      hoRejectionReasonCode: 'BLURRY', hoRejectionReason: 'HO said redo',
      site: { ...activeSite },
    });
    const updatedRow = {
      id: 'rM', status: 'SUBMITTED', recceMode: 'MANUAL', version: 3,
      captureLat: null, captureLng: null, captureAccuracy: null, distanceMeters: null, geoFenceOk: null,
      capturedAt: null, receivedAt: new Date(),
      rejectionReasonCode: null, rejectionReason: null,
      hoReviewStatus: 'PENDING', hoRejectionReasonCode: null, hoRejectionReason: null,
      site: { id: 's1', code: 'S1', name: 'Store', town: 'Mumbai', lat: 19.076, lng: 72.877 },
      submittedBy: { id: 'u1', name: 'Field' },
      posms: [{ id: 'rp1', slotNo: 1, posmTypeId: 'pt1', dimensions: {}, photo: { key: KEY }, markup: null, qualityFlags: null, posmType: { id: 'pt1', code: 'PT1', name: 'Board' } }],
    };
    const tx = {
      recce: { update: jest.fn().mockResolvedValue(updatedRow) },
      reccePosm: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    mockMedia.recordImageHashes.mockResolvedValue({ dupHashes: [] });

    await service.resubmit(vendorField, 'rM', { posms: [line({ lat: 19.0761, lng: 72.8771 })] });
    expect(tx.recce.update.mock.calls[0][0].data.hoReviewStatus).toBe('PENDING');
  });

  // ── A4 clean 409 on a create race ──────────────────────────────────────────────
  it('A4: a P2002 unique-violation race on create surfaces a 409, not a raw 500', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findFirst.mockResolvedValue(null);
    mockPrisma.posmType.findMany.mockResolvedValue([{ id: 'pt1', isActive: true }]);
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: false, radiusMeters: 100 } } });
    mockPrisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(
      service.create(vendorField, { siteId: 's1', posms: [line({ lat: 19.0761, lng: 72.8771 })] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // ── B5/B6 computed reviewer flags surfaced on the recce response ────────────────
  it('B5/B6: present() surfaces lowAccuracy + clockSkew reviewer flags from stored signals', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findFirst.mockResolvedValue(null);
    mockPrisma.posmType.findMany.mockResolvedValue([{ id: 'pt1', isActive: true }]);
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: false, radiusMeters: 100 } } });
    mockIntegrity.fetchImageBytes.mockResolvedValue(null);

    const received = new Date('2026-08-28T12:00:00.000Z');
    const createdRow = {
      id: 'r1', status: 'SUBMITTED', version: 1,
      captureLat: 19.076, captureLng: 72.877, captureAccuracy: 250, // > 100m cap → lowAccuracy
      distanceMeters: 0, geoFenceOk: null,
      capturedAt: new Date('2026-08-28T12:30:00.000Z'), // +30 min → clockSkew
      receivedAt: received,
      rejectionReasonCode: null, rejectionReason: null,
      site: { id: 's1', code: 'S1', name: 'Store', town: 'Mumbai', lat: 19.076, lng: 72.877 },
      submittedBy: { id: 'u1', name: 'Field' },
      posms: [{ id: 'rp1', slotNo: 1, posmTypeId: 'pt1', dimensions: {}, photo: { key: KEY }, markup: null, posmType: { id: 'pt1', code: 'PT1', name: 'Board' } }],
    };
    const tx = {
      recce: { create: jest.fn().mockResolvedValue(createdRow) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      reccePosm: { deleteMany: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    mockMedia.recordImageHashes.mockResolvedValue({ dupHashes: [] });

    const res = await service.create(vendorField, { siteId: 's1', posms: [line({ lat: 19.0761, lng: 72.8771 })] });
    expect(res.integrity.qualityFlags).toEqual({ lowAccuracy: true, clockSkew: true, duplicate: false });
  });

  it('B8: a duplicate hash reported by recordImageHashes surfaces duplicate=true', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findFirst.mockResolvedValue(null);
    mockPrisma.posmType.findMany.mockResolvedValue([{ id: 'pt1', isActive: true }]);
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: false, radiusMeters: 100 } } });
    mockIntegrity.fetchImageBytes.mockResolvedValue(Buffer.alloc(16, 1));
    mockIntegrity.hash.mockReturnValue('hash-dup');

    const createdRow = {
      id: 'r1', status: 'SUBMITTED', version: 1,
      captureLat: 19.076, captureLng: 72.877, captureAccuracy: null, distanceMeters: 0, geoFenceOk: null,
      capturedAt: null, receivedAt: new Date(),
      rejectionReasonCode: null, rejectionReason: null,
      site: { id: 's1', code: 'S1', name: 'Store', town: 'Mumbai', lat: 19.076, lng: 72.877 },
      submittedBy: { id: 'u1', name: 'Field' },
      posms: [{ id: 'rp1', slotNo: 1, posmTypeId: 'pt1', dimensions: {}, photo: { key: KEY }, markup: null, posmType: { id: 'pt1', code: 'PT1', name: 'Board' } }],
    };
    const tx = {
      recce: { create: jest.fn().mockResolvedValue(createdRow) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      reccePosm: { deleteMany: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    mockMedia.recordImageHashes.mockResolvedValue({ dupHashes: ['hash-dup'] });

    const res = await service.create(vendorField, { siteId: 's1', posms: [line({ lat: 19.0761, lng: 72.8771 })] });
    expect(res.integrity.qualityFlags.duplicate).toBe(true);
  });

  // ── Per-POSM stored quality flags (blur/lowLight/overexposed/lowAccuracy) ──────
  it('prepare(): computes + persists per-POSM qualityFlags on the recce.create write (duplicate dropped)', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findFirst.mockResolvedValue(null);
    mockPrisma.posmType.findMany.mockResolvedValue([{ id: 'pt1', isActive: true }]);
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: false, radiusMeters: 100 } } });
    mockIntegrity.fetchImageBytes.mockResolvedValue(Buffer.alloc(16, 1));
    mockIntegrity.hash.mockReturnValue('hash-1');

    const createdRow = {
      id: 'r1', status: 'SUBMITTED', version: 1,
      captureLat: 19.076, captureLng: 72.877, captureAccuracy: null, distanceMeters: 0, geoFenceOk: null,
      capturedAt: null, receivedAt: new Date(),
      rejectionReasonCode: null, rejectionReason: null,
      site: { id: 's1', code: 'S1', name: 'Store', town: 'Mumbai', lat: 19.076, lng: 72.877 },
      submittedBy: { id: 'u1', name: 'Field' },
      posms: [{ id: 'rp1', slotNo: 1, posmTypeId: 'pt1', dimensions: {}, photo: { key: KEY }, markup: null, qualityFlags: null, posmType: { id: 'pt1', code: 'PT1', name: 'Board' } }],
    };
    const tx = {
      recce: { create: jest.fn().mockResolvedValue(createdRow) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      reccePosm: { deleteMany: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    mockMedia.recordImageHashes.mockResolvedValue({ dupHashes: [] });

    // A poor-accuracy fix (500 m > 100 m cap) → per-POSM lowAccuracy true; image flags false.
    await service.create(vendorField, {
      siteId: 's1',
      posms: [{ posmTypeId: 'pt1', dimensions: { width: 2, height: 3, unit: 'ft' }, photo: { key: KEY, geo: { lat: 19.0761, lng: 72.8771, accuracy: 500 } } } as any],
    });

    const persisted = tx.recce.create.mock.calls[0][0].data.posms.create[0].qualityFlags;
    expect(persisted).toEqual({ blur: false, blank: false, lowLight: false, overexposed: false, lowAccuracy: true });
    // The submission-level duplicate signal is NOT folded into the per-POSM object.
    expect(persisted).not.toHaveProperty('duplicate');
  });

  it('present(): surfaces each stored per-POSM qualityFlags on the read shape (null for a legacy row)', async () => {
    mockPrisma.site.findFirst.mockResolvedValue(activeSite);
    mockPrisma.recce.findFirst.mockResolvedValue(null);
    mockPrisma.posmType.findMany.mockResolvedValue([{ id: 'pt1', isActive: true }]);
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: false, radiusMeters: 100 } } });
    mockIntegrity.fetchImageBytes.mockResolvedValue(null);

    const storedQf = { blur: true, lowLight: false, overexposed: false, lowAccuracy: false };
    const createdRow = {
      id: 'r1', status: 'SUBMITTED', version: 1,
      captureLat: 19.076, captureLng: 72.877, captureAccuracy: null, distanceMeters: 0, geoFenceOk: null,
      capturedAt: null, receivedAt: new Date(),
      rejectionReasonCode: null, rejectionReason: null,
      site: { id: 's1', code: 'S1', name: 'Store', town: 'Mumbai', lat: 19.076, lng: 72.877 },
      submittedBy: { id: 'u1', name: 'Field' },
      posms: [
        { id: 'rp1', slotNo: 1, posmTypeId: 'pt1', dimensions: {}, photo: { key: KEY }, markup: null, qualityFlags: storedQf, posmType: { id: 'pt1', code: 'PT1', name: 'Board' } },
        { id: 'rp2', slotNo: 2, posmTypeId: 'pt1', dimensions: {}, photo: { key: `${KEY}-2` }, markup: null, qualityFlags: null, posmType: { id: 'pt1', code: 'PT1', name: 'Board' } },
      ],
    };
    const tx = {
      recce: { create: jest.fn().mockResolvedValue(createdRow) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      reccePosm: { deleteMany: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    mockMedia.recordImageHashes.mockResolvedValue({ dupHashes: [] });

    const res = await service.create(vendorField, { siteId: 's1', posms: [line({ lat: 19.0761, lng: 72.8771 })] });
    expect(res.posms[0].qualityFlags).toEqual(storedQf);
    expect(res.posms[1].qualityFlags).toBeNull(); // legacy row (no stored flags) → null
    // The recce-level integrity block is unchanged/additive.
    expect(res.integrity.qualityFlags).toMatchObject({ duplicate: false });
  });

  // ── RS code + Beat list filters merge into where.site, preserving the vendor pin ──
  it('list: rsCode + beatName are EXACT filters merged into where.site, keeping the vendor pin', async () => {
    mockPrisma.recce.findMany.mockResolvedValue([]);
    mockPrisma.recce.count.mockResolvedValue(0);
    await service.list(vendorField, { rsCode: 'RS1', beatName: 'Beat 1' } as any);
    const where = mockPrisma.recce.findMany.mock.calls[0][0].where;
    expect(where.site).toEqual({
      vendorId: 'vA', // set by scopeWhere — must survive the merge
      rsCode: { equals: 'RS1', mode: 'insensitive' },
      beatName: { equals: 'Beat 1', mode: 'insensitive' },
    });
    expect(where.submittedById).toBe('u1'); // own-recces pin intact
  });

  it('list: rsCode merges ALONGSIDE siteCode without dropping the vendor pin', async () => {
    mockPrisma.recce.findMany.mockResolvedValue([]);
    mockPrisma.recce.count.mockResolvedValue(0);
    await service.list(vendorField, { siteCode: 'ST', rsCode: 'RS1' } as any);
    const where = mockPrisma.recce.findMany.mock.calls[0][0].where;
    expect(where.site).toEqual({
      vendorId: 'vA',
      code: { contains: 'ST', mode: 'insensitive' },
      rsCode: { equals: 'RS1', mode: 'insensitive' },
    });
  });

  it('list: beatNames (multi-select) → case-INSENSITIVE OR merged into where.site, vendor pin kept', async () => {
    mockPrisma.recce.findMany.mockResolvedValue([]);
    mockPrisma.recce.count.mockResolvedValue(0);
    await service.list(vendorField, { beatNames: ['Beat 1', 'Beat 2'] } as any);
    const where = mockPrisma.recce.findMany.mock.calls[0][0].where;
    expect(where.site).toEqual({
      vendorId: 'vA', // set by scopeWhere — survives the merge
      OR: [
        { beatName: { equals: 'Beat 1', mode: 'insensitive' } },
        { beatName: { equals: 'Beat 2', mode: 'insensitive' } },
      ],
    });
    expect(where.submittedById).toBe('u1'); // own-recces pin intact
  });

  it('list: beatNames WINS over a single beatName when both present', async () => {
    mockPrisma.recce.findMany.mockResolvedValue([]);
    mockPrisma.recce.count.mockResolvedValue(0);
    await service.list(vendorField, { beatName: 'Beat 9', beatNames: ['Beat 1'] } as any);
    const where = mockPrisma.recce.findMany.mock.calls[0][0].where;
    expect(where.site.OR).toEqual([{ beatName: { equals: 'Beat 1', mode: 'insensitive' } }]);
    expect(where.site.beatName).toBeUndefined();
  });

  it('list: empty beatNames array falls back to the single beatName behaviour', async () => {
    mockPrisma.recce.findMany.mockResolvedValue([]);
    mockPrisma.recce.count.mockResolvedValue(0);
    await service.list(vendorField, { beatName: 'Beat 9', beatNames: [] } as any);
    const where = mockPrisma.recce.findMany.mock.calls[0][0].where;
    expect(where.site.beatName).toEqual({ equals: 'Beat 9', mode: 'insensitive' });
  });

  it('list: each row carries hoReviewStatus + hoRejectionReasonCode (so the re-capture card can show the HO reason)', async () => {
    mockPrisma.recce.findMany.mockResolvedValue([
      {
        id: 'r1', status: 'REJECTED', hoReviewStatus: 'REJECTED', version: 2,
        geoFenceOk: true, distanceMeters: 0, capturedAt: null, receivedAt: new Date(),
        rejectionReasonCode: null, hoRejectionReasonCode: 'GEO_MISMATCH',
        site: { id: 's1', code: 'S1', name: 'Store', town: 'Mumbai' },
        posms: [{ id: 'rp1', slotNo: 1 }],
      },
    ]);
    mockPrisma.recce.count.mockResolvedValue(1);
    const res = await service.list(vendorField, {} as any);
    expect(res.recces[0]).toMatchObject({
      id: 'r1',
      hoReviewStatus: 'REJECTED',
      rejectionReasonCode: null,
      hoRejectionReasonCode: 'GEO_MISMATCH',
    });
  });

  // ── Manual recce submit (field-typed outlet → straight to HO) ───────────────────
  const manualRecceRow = (over: Record<string, unknown> = {}) => ({
    id: 'rM', status: 'SUBMITTED', recceMode: 'MANUAL', version: 1,
    captureLat: null, captureLng: null, captureAccuracy: null, distanceMeters: null, geoFenceOk: null,
    capturedAt: null, receivedAt: new Date(),
    rejectionReasonCode: null, rejectionReason: null,
    hoReviewStatus: 'PENDING', hoRejectionReasonCode: null, hoRejectionReason: null,
    site: { id: 'sNew', code: 'MAN-xyz', name: 'New Shop', town: null, lat: null, lng: null },
    submittedBy: { id: 'u1', name: 'Field' },
    posms: [{ id: 'rp1', slotNo: 1, posmTypeId: 'pt1', dimensions: {}, photo: { key: KEY }, markup: null, qualityFlags: null, posmType: { id: 'pt1', code: 'PT1', name: 'Board' } }],
    ...over,
  });

  const manualPrepMocks = () => {
    mockPrisma.posmType.findMany.mockResolvedValue([{ id: 'pt1', isActive: true }]);
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: false, radiusMeters: 100 } } });
    mockIntegrity.fetchImageBytes.mockResolvedValue(null);
    mockMedia.recordImageHashes.mockResolvedValue({ dupHashes: [] });
  };

  it('manual: a blank outletName → 400, no outlet/recce write', async () => {
    await expect(
      service.createManual(vendorField, { outletName: '   ', posms: [line({ lat: 19.076, lng: 72.877 })] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('manual: a vendor with no resolvable vendor is DENIED (404) — fail-closed', async () => {
    const noVendor = { sub: 'u1', role: 'VENDOR_FIELD', clientId: 'kwality', phone: '9', name: 'F' } as any;
    await expect(
      service.createManual(noVendor, { outletName: 'X', posms: [line({ lat: 19.076, lng: 72.877 })] }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('manual: no outletId → creates a provisional MAN- outlet + MANUAL recce (SUBMITTED + hoReviewStatus PENDING)', async () => {
    manualPrepMocks();
    const tx = {
      site: { create: jest.fn().mockResolvedValue({ id: 'sNew' }) },
      recce: { create: jest.fn().mockResolvedValue(manualRecceRow()) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const res = await service.createManual(vendorField, { outletName: 'New Shop', outletAddress: '12 Main St', posms: [line({ lat: 19.0761, lng: 72.8771 })] });

    const siteData = tx.site.create.mock.calls[0][0].data;
    expect(siteData.code.startsWith('MAN-')).toBe(true); // provisional sentinel
    expect(siteData.name).toBe('New Shop');
    expect(siteData.vendorId).toBe('vA'); // vendor derived from the caller
    expect(siteData.address).toBe('12 Main St');
    const recceData = tx.recce.create.mock.calls[0][0].data;
    expect(recceData.recceMode).toBe('MANUAL');
    expect(recceData.status).toBe('SUBMITTED');
    expect(recceData.hoReviewStatus).toBe('PENDING'); // straight to HO, no ASM
    expect(recceData.siteId).toBe('sNew');
    expect(res.recceMode).toBe('MANUAL');
    // Audit records the manual-submit event.
    expect(tx.auditLog.create.mock.calls[0][0].data.metadata.event).toBe('RECCE_MANUAL_SUBMIT');
  });

  it('manual: an EXISTING owned outletId → ATTACHES (no new outlet) — allowed even if it has an app recce', async () => {
    manualPrepMocks();
    // Vendor-scoped attach lookup returns the owned outlet (its app recce is irrelevant to manual).
    mockPrisma.site.findFirst.mockResolvedValue({ id: 'sExisting', lat: 19.076, lng: 72.877, status: 'ACTIVE' });
    const tx = {
      site: { create: jest.fn() },
      recce: { create: jest.fn().mockResolvedValue(manualRecceRow({ site: { id: 'sExisting', code: 'OUT1', name: 'Existing', town: null, lat: 19.076, lng: 72.877 } })) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await service.createManual(vendorField, { outletId: 'OUT1', outletName: 'Existing', posms: [line({ lat: 19.0761, lng: 72.8771 })] });

    expect(tx.site.create).not.toHaveBeenCalled(); // reused, not duplicated
    expect(tx.recce.create.mock.calls[0][0].data.siteId).toBe('sExisting');
    // The attach lookup carried the vendor pin — a foreign outlet is invisible here.
    expect(mockPrisma.site.findFirst.mock.calls[0][0].where).toEqual({ clientId: 'kwality', code: 'OUT1', vendorId: 'vA' });
  });

  it('manual: an outletId that collides with a NON-owned outlet → 409 (no cross-vendor attach)', async () => {
    manualPrepMocks();
    mockPrisma.site.findFirst.mockResolvedValue(null); // not found under this vendor → create branch
    const tx = {
      site: { create: jest.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' })) },
      recce: { create: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await expect(
      service.createManual(vendorField, { outletId: 'OTHER', outletName: 'X', posms: [line({ lat: 19.0761, lng: 72.8771 })] }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.recce.create).not.toHaveBeenCalled();
  });

  // ── GSB element-type gate (recce may include the GSB element only at a gsbAllowed outlet) ──
  const gsbLine = (geo: { lat: number; lng: number }) => ({ ...line(geo), posmTypeId: 'gsb1' });

  it('GSB (app): a GSB element on a gsbAllowed=false outlet → 400, no write', async () => {
    mockPrisma.site.findFirst.mockResolvedValue({ ...activeSite, gsbAllowed: false });
    mockPrisma.recce.findFirst.mockResolvedValue(null);
    mockPrisma.posmType.findMany.mockResolvedValue([{ id: 'gsb1', code: 'GSB', isActive: true }]);
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: false, radiusMeters: 100 } } });
    await expect(
      service.create(vendorField, { siteId: 's1', posms: [gsbLine({ lat: 19.0761, lng: 72.8771 })] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('GSB (app): a lower-case "gsb" code is still gated (case-insensitive) on a gsbAllowed=false outlet → 400', async () => {
    mockPrisma.site.findFirst.mockResolvedValue({ ...activeSite, gsbAllowed: false });
    mockPrisma.recce.findFirst.mockResolvedValue(null);
    mockPrisma.posmType.findMany.mockResolvedValue([{ id: 'gsb1', code: 'gsb', isActive: true }]);
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: false, radiusMeters: 100 } } });
    await expect(
      service.create(vendorField, { siteId: 's1', posms: [gsbLine({ lat: 19.0761, lng: 72.8771 })] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('GSB (app): a GSB element on a gsbAllowed=true outlet → OK (submits)', async () => {
    mockPrisma.site.findFirst.mockResolvedValue({ ...activeSite, gsbAllowed: true });
    mockPrisma.recce.findFirst.mockResolvedValue(null);
    mockPrisma.posmType.findMany.mockResolvedValue([{ id: 'gsb1', code: 'GSB', isActive: true }]);
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: false, radiusMeters: 100 } } });
    mockIntegrity.fetchImageBytes.mockResolvedValue(null);

    const createdRow = {
      id: 'r1', status: 'SUBMITTED', version: 1,
      captureLat: 19.076, captureLng: 72.877, captureAccuracy: null, distanceMeters: 0, geoFenceOk: null,
      capturedAt: null, receivedAt: new Date(),
      rejectionReasonCode: null, rejectionReason: null,
      site: { id: 's1', code: 'S1', name: 'Store', town: 'Mumbai', lat: 19.076, lng: 72.877 },
      submittedBy: { id: 'u1', name: 'Field' },
      posms: [{ id: 'rp1', slotNo: 1, posmTypeId: 'gsb1', dimensions: {}, photo: { key: KEY }, markup: null, posmType: { id: 'gsb1', code: 'GSB', name: 'GSB' } }],
    };
    const tx = {
      recce: { create: jest.fn().mockResolvedValue(createdRow) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      reccePosm: { deleteMany: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    mockMedia.recordImageHashes.mockResolvedValue({ dupHashes: [] });

    const res = await service.create(vendorField, { siteId: 's1', posms: [gsbLine({ lat: 19.0761, lng: 72.8771 })] });
    expect(res.status).toBe('SUBMITTED');
    expect(tx.recce.create).toHaveBeenCalled();
  });

  it('GSB (app): a NON-GSB element is always allowed, even on a gsbAllowed=false outlet', async () => {
    mockPrisma.site.findFirst.mockResolvedValue({ ...activeSite, gsbAllowed: false });
    mockPrisma.recce.findFirst.mockResolvedValue(null);
    mockPrisma.posmType.findMany.mockResolvedValue([{ id: 'pt1', code: 'FSU', isActive: true }]);
    mockPrisma.client.findUnique.mockResolvedValue({ settings: { geoFence: { enabled: false, radiusMeters: 100 } } });
    mockIntegrity.fetchImageBytes.mockResolvedValue(null);

    const createdRow = {
      id: 'r1', status: 'SUBMITTED', version: 1,
      captureLat: 19.076, captureLng: 72.877, captureAccuracy: null, distanceMeters: 0, geoFenceOk: null,
      capturedAt: null, receivedAt: new Date(),
      rejectionReasonCode: null, rejectionReason: null,
      site: { id: 's1', code: 'S1', name: 'Store', town: 'Mumbai', lat: 19.076, lng: 72.877 },
      submittedBy: { id: 'u1', name: 'Field' },
      posms: [{ id: 'rp1', slotNo: 1, posmTypeId: 'pt1', dimensions: {}, photo: { key: KEY }, markup: null, posmType: { id: 'pt1', code: 'FSU', name: 'FSU' } }],
    };
    const tx = {
      recce: { create: jest.fn().mockResolvedValue(createdRow) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      reccePosm: { deleteMany: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    mockMedia.recordImageHashes.mockResolvedValue({ dupHashes: [] });

    const res = await service.create(vendorField, { siteId: 's1', posms: [line({ lat: 19.0761, lng: 72.8771 })] });
    expect(res.status).toBe('SUBMITTED');
  });

  it('GSB (manual): a GSB element on a provisional walk-in (gsbAllowed=false by default) → 400, no write', async () => {
    manualPrepMocks();
    mockPrisma.posmType.findMany.mockResolvedValue([{ id: 'gsb1', code: 'GSB', isActive: true }]);
    // No outletId → provisional outlet (gsbAllowed false) → GSB blocked before the transaction.
    await expect(
      service.createManual(vendorField, { outletName: 'Walk-in Shop', posms: [gsbLine({ lat: 19.0761, lng: 72.8771 })] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('GSB (manual): a GSB element on an ATTACHED gsbAllowed=true outlet → OK (submits)', async () => {
    manualPrepMocks();
    mockPrisma.posmType.findMany.mockResolvedValue([{ id: 'gsb1', code: 'GSB', isActive: true }]);
    mockPrisma.site.findFirst.mockResolvedValue({ id: 'sExisting', lat: 19.076, lng: 72.877, status: 'ACTIVE', gsbAllowed: true });
    const tx = {
      site: { create: jest.fn() },
      recce: { create: jest.fn().mockResolvedValue(manualRecceRow({ site: { id: 'sExisting', code: 'OUT1', name: 'Existing', town: null, lat: 19.076, lng: 72.877 } })) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const res = await service.createManual(vendorField, { outletId: 'OUT1', outletName: 'Existing', posms: [gsbLine({ lat: 19.0761, lng: 72.8771 })] });
    expect(res.recceMode).toBe('MANUAL');
    expect(tx.recce.create).toHaveBeenCalled();
    // The attach lookup selected gsbAllowed so the gate can read it.
    expect(mockPrisma.site.findFirst.mock.calls[0][0].select).toMatchObject({ gsbAllowed: true });
  });
});
