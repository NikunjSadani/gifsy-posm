import { NotFoundException, StreamableFile } from '@nestjs/common';
import { Jimp } from 'jimp';
import { MediaController } from './media.controller';
import { sniffImageMime } from './watermark.util';
import type { PosmMediaService } from '../capture/posm-media.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CaptureIntegrityService } from '../capture-integrity/capture-integrity.service';
import type { JwtPayload } from '../common/decorators/current-user.decorator';

const USER: JwtPayload = { sub: 'u1', role: 'GIFSY_ADMIN', clientId: 'c1', phone: '', name: 'Op' };

async function streamToBuffer(sf: StreamableFile): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of sf.getStream()) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function makePng(): Promise<Buffer> {
  const img = new Jimp({ width: 96, height: 64, color: 0x224488ff });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (img as any).getBuffer('image/png');
}

describe('MediaController', () => {
  let controller: MediaController;
  let media: jest.Mocked<Pick<PosmMediaService, 'uploadMedia' | 'viewMedia'>>;
  let prisma: {
    reccePosm: { findFirst: jest.Mock };
    installPosm: { findFirst: jest.Mock };
  };
  let integrity: jest.Mocked<Pick<CaptureIntegrityService, 'qualityFlags'>>;

  beforeEach(() => {
    media = {
      uploadMedia: jest.fn(),
      viewMedia: jest.fn(),
    };
    prisma = {
      reccePosm: { findFirst: jest.fn().mockResolvedValue(null) },
      installPosm: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    integrity = {
      // Default: a decodable image with no quality issues. Individual tests override.
      qualityFlags: jest.fn().mockResolvedValue({
        blur: false, blank: false, lowLight: false, overexposed: false, duplicate: false, lowAccuracy: false,
      }),
    };
    controller = new MediaController(
      media as unknown as PosmMediaService,
      prisma as unknown as PrismaService,
      integrity as unknown as CaptureIntegrityService,
    );
  });

  // ── Upload ────────────────────────────────────────────────────────────────

  describe('upload', () => {
    it('passes the file through to uploadMedia and returns { key, quality } from the integrity service', async () => {
      const file = { buffer: Buffer.from([0xff, 0xd8, 0xff]), size: 3, originalname: 'p.jpg' } as Express.Multer.File;
      media.uploadMedia.mockResolvedValue({
        key: 'posm-media/c1/abc.jpg',
        fileUrl: 'gs://x',
        mimeType: 'image/jpeg',
        fileSizeBytes: 3,
      });
      integrity.qualityFlags.mockResolvedValue({
        blur: true, blank: false, lowLight: false, overexposed: true, duplicate: false, lowAccuracy: false,
      });

      const res = await controller.upload(USER, file);

      expect(media.uploadMedia).toHaveBeenCalledWith(USER, file);
      // The uploaded bytes are analyzed; duplicate/accuracy are not known at upload time.
      expect(integrity.qualityFlags).toHaveBeenCalledWith(file.buffer, { duplicate: false, accuracy: null });
      // PINNED upload contract: only image-content flags surfaced (blur/blank/lowLight/overexposed;
      // no duplicate/lowAccuracy — those need submission/geo context not available at upload time).
      expect(res).toEqual({
        key: 'posm-media/c1/abc.jpg',
        quality: { blur: true, blank: false, lowLight: false, overexposed: true },
      });
    });
  });

  // ── View ─────────────────────────────────────────────────────────────────

  describe('view', () => {
    const KEY = 'posm-media/c1/photo.png';

    it('watermarks an image WITH provenance (bytes differ, image type preserved)', async () => {
      const original = await makePng();
      media.viewMedia.mockResolvedValue({ bytes: original, contentType: 'image/png', inline: true });
      prisma.reccePosm.findFirst.mockResolvedValue({
        photo: { key: KEY, geo: { lat: 12.34567, lng: 77.65432 } },
        recce: {
          capturedAt: new Date('2026-08-27T10:00:00.000Z'),
          captureLat: null,
          captureLng: null,
          site: { code: 'ST01' },
          submittedBy: { name: 'Ravi' },
        },
      });

      const out = await streamToBuffer(await controller.view(USER, KEY));

      expect(Buffer.compare(out, original)).not.toBe(0); // watermark applied
      expect(sniffImageMime(out)).toBe('image/png'); // type preserved
      // tenant enforcement is delegated, untouched, to viewMedia
      expect(media.viewMedia).toHaveBeenCalledWith(USER, KEY);
    });

    it('resolves provenance from InstallPosm when no ReccePosm matches', async () => {
      const original = await makePng();
      media.viewMedia.mockResolvedValue({ bytes: original, contentType: 'image/png', inline: true });
      prisma.reccePosm.findFirst.mockResolvedValue(null);
      prisma.installPosm.findFirst.mockResolvedValue({
        photo: { key: KEY },
        captureLat: 1.5,
        captureLng: 2.5,
        installation: {
          capturedAt: new Date('2026-08-27T11:00:00.000Z'),
          site: { code: 'ST02' },
          submittedBy: { name: 'Asha' },
        },
      });

      const out = await streamToBuffer(await controller.view(USER, KEY));

      expect(prisma.installPosm.findFirst).toHaveBeenCalled();
      expect(Buffer.compare(out, original)).not.toBe(0);
      expect(sniffImageMime(out)).toBe('image/png');
    });

    it('serves the ORIGINAL unchanged when there is NO provenance (pre-submit photo)', async () => {
      const original = await makePng();
      media.viewMedia.mockResolvedValue({ bytes: original, contentType: 'image/png', inline: true });
      // both findFirst already resolve null in beforeEach

      const out = await streamToBuffer(await controller.view(USER, KEY));

      expect(Buffer.compare(out, original)).toBe(0);
    });

    it('serves a NON-IMAGE (undecodable) buffer unchanged even with provenance', async () => {
      const notImage = Buffer.from('definitely not a decodable image payload');
      media.viewMedia.mockResolvedValue({ bytes: notImage, contentType: 'image/png', inline: true });
      prisma.reccePosm.findFirst.mockResolvedValue({
        photo: { key: KEY },
        recce: { capturedAt: null, captureLat: null, captureLng: null, site: { code: 'ST01' }, submittedBy: { name: 'Ravi' } },
      });

      const out = await streamToBuffer(await controller.view(USER, KEY));

      expect(Buffer.compare(out, notImage)).toBe(0);
    });

    it('propagates the tenant denial from viewMedia and never queries provenance', async () => {
      media.viewMedia.mockRejectedValue(new NotFoundException());

      await expect(controller.view(USER, KEY)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.reccePosm.findFirst).not.toHaveBeenCalled();
      expect(prisma.installPosm.findFirst).not.toHaveBeenCalled();
    });
  });
});
