// Unit tests — PosmMediaService.viewMedia access control.
// Locks: object-key format + tenant folder; VENDOR confinement on recce/install EVIDENCE photos
// (a vendor can't view another vendor's; tenant-shared media stays viewable); reviewers tenant-wide.

import { NotFoundException } from '@nestjs/common';
import { PosmMediaService } from './posm-media.service';
import type { StorageService } from '../storage/storage.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../common/decorators/current-user.decorator';

const TENANT = 'c1';
const KEY = `posm-media/${TENANT}/2026-10/uuid-photo.png`;

function make(ownerVendorId: string | null) {
  const storage = {
    downloadBytes: jest.fn().mockResolvedValue({ bytes: Buffer.from('img'), contentType: 'image/png' }),
  } as unknown as StorageService;
  // reccePosm resolves the owner; installPosm only consulted when recce misses.
  const prisma = {
    reccePosm: {
      findFirst: jest.fn().mockResolvedValue(ownerVendorId ? { recce: { site: { vendorId: ownerVendorId } } } : null),
    },
    installPosm: { findFirst: jest.fn().mockResolvedValue(null) },
  } as unknown as PrismaService;
  return { svc: new PosmMediaService(storage, prisma), storage, prisma };
}

const user = (over: Partial<JwtPayload>): JwtPayload =>
  ({ sub: 'u', role: 'VENDOR_FIELD', clientId: TENANT, ...over } as JwtPayload);

describe('PosmMediaService.viewMedia — access control', () => {
  it('rejects a key without the media prefix', async () => {
    const { svc } = make('vA');
    await expect(svc.viewMedia(user({ vendorId: 'vA' }), 'etc/passwd')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a cross-tenant key for a non-platform caller', async () => {
    const { svc } = make('vA');
    await expect(svc.viewMedia(user({ clientId: 'OTHER', vendorId: 'vA' }), KEY)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('VENDOR: serves a recce photo owned by the SAME vendor', async () => {
    const { svc, storage } = make('vA');
    const out = await svc.viewMedia(user({ role: 'VENDOR_FIELD', vendorId: 'vA' }), KEY);
    expect(out.contentType).toBe('image/png');
    expect(storage.downloadBytes).toHaveBeenCalledWith(KEY);
  });

  it('VENDOR: DENIES a recce photo owned by a DIFFERENT vendor (the cross-vendor leak)', async () => {
    const { svc, storage } = make('vA');
    await expect(svc.viewMedia(user({ role: 'VENDOR_FIELD', vendorId: 'vB' }), KEY)).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.downloadBytes).not.toHaveBeenCalled();
  });

  it('VENDOR: still views tenant-SHARED media (no owning recce/install — e.g. a POSM-type image)', async () => {
    const { svc, storage } = make(null); // not a recce/install photo
    const out = await svc.viewMedia(user({ role: 'VENDOR_HO', vendorId: 'vB' }), KEY);
    expect(out.contentType).toBe('image/png');
    expect(storage.downloadBytes).toHaveBeenCalledWith(KEY);
  });

  it('AUDITOR (reviewer) is tenant-wide: views another vendor’s evidence photo', async () => {
    const { svc, storage } = make('vA');
    const out = await svc.viewMedia(user({ role: 'AUDITOR', clientId: TENANT }), KEY);
    expect(out.contentType).toBe('image/png');
    expect(storage.downloadBytes).toHaveBeenCalled();
  });

  it('un-assumed GIFSY_ADMIN reads across tenants (platform-wide)', async () => {
    const { svc } = make('vA');
    const out = await svc.viewMedia(user({ role: 'GIFSY_ADMIN', clientId: 'gifsy' }), KEY);
    expect(out.contentType).toBe('image/png');
  });
});
