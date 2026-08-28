import { Jimp } from 'jimp';
import {
  watermarkImage,
  normalizeCaption,
  sniffImageMime,
  drawWatermark,
} from './watermark.util';

/** Build a real encoded image of a solid colour for round-trip tests. */
async function makeImage(mime: 'image/png' | 'image/jpeg', w = 96, h = 64): Promise<Buffer> {
  const img = new Jimp({ width: w, height: h, color: 0x3366ccff });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (img as any).getBuffer(mime);
}

describe('watermark.util', () => {
  describe('normalizeCaption', () => {
    it('uppercases and maps unsupported chars (incl. the middle-dot) to spaces', () => {
      // `·` is not in the glyph set → space; lowercase → uppercase.
      expect(normalizeCaption('Site7 · abc')).toBe('SITE7   ABC');
    });
  });

  describe('sniffImageMime', () => {
    it('detects png/jpeg and rejects non-images', () => {
      expect(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
      expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe('image/jpeg');
      expect(sniffImageMime(Buffer.from('%PDF-1.4'))).toBeNull();
      expect(sniffImageMime(Buffer.from([]))).toBeNull();
    });
  });

  describe('watermarkImage', () => {
    it('returns a DIFFERENT buffer that is still the same image type (png)', async () => {
      const original = await makeImage('image/png');
      const stamped = await watermarkImage(original, 'ST01 | RAVI | 12.34567,77.65432 | 2026-08-27T10:00:00.000Z');
      expect(stamped).not.toBeNull();
      expect(Buffer.compare(stamped as Buffer, original)).not.toBe(0);
      expect(sniffImageMime(stamped as Buffer)).toBe('image/png');
    });

    it('preserves jpeg type', async () => {
      const original = await makeImage('image/jpeg');
      const stamped = await watermarkImage(original, 'ST01 | RAVI');
      expect(stamped).not.toBeNull();
      expect(sniffImageMime(stamped as Buffer)).toBe('image/jpeg');
    });

    it('returns null for a non-decodable (non-image) buffer', async () => {
      const notAnImage = Buffer.from('this is not an image at all, just text');
      expect(await watermarkImage(notAnImage, 'X')).toBeNull();
    });
  });

  describe('drawWatermark', () => {
    it('mutates the bitmap (bottom strip pixels change)', () => {
      const img = new Jimp({ width: 96, height: 64, color: 0xffffffff });
      const before = Buffer.from(img.bitmap.data);
      drawWatermark(img, 'ABC 123');
      expect(Buffer.compare(Buffer.from(img.bitmap.data), before)).not.toBe(0);
    });
  });
});
