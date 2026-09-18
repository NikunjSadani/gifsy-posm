import { Jimp } from 'jimp';
import {
  decodeLumaGrid,
  aHash,
  aHashFromGrid,
  hammingDistance,
  beforeAfterDiffers,
  laplacianVariance,
  varianceOfLaplacian,
  isBlurry,
  isBlurryGrid,
  stdDevOfGrid,
  meanOfGrid,
  meanLuminance,
  isLowLight,
  isOverexposed,
  computeQualityFlags,
  isLowAccuracy,
  clockSkewMs,
  isClockSkewed,
  BEFORE_AFTER_MIN_HAMMING,
  CLOCK_SKEW_THRESHOLD_MS,
  ANALYSIS_GRID,
  HASH_GRID,
} from './image-integrity.helper';

// ── Real-image fixtures ──────────────────────────────────────────────────────
// Every fixture is an ACTUAL encoded PNG (lossless) so the helpers exercise the
// full decode → luminance → analyze path on real pixels, not on raw file bytes.
const rgba = (r: number, g: number, b: number, a = 255) =>
  ((r * 0x1000000 + g * 0x10000 + b * 0x100 + a) >>> 0);

async function pngSolid(w: number, h: number, r: number, g: number, b: number): Promise<Buffer> {
  const img = new Jimp({ width: w, height: h, color: rgba(r, g, b) });
  return img.getBuffer('image/png');
}

async function pngChecker(w: number, h: number, sz: number): Promise<Buffer> {
  const img = new Jimp({ width: w, height: h, color: rgba(0, 0, 0) });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((Math.floor(x / sz) + Math.floor(y / sz)) % 2 === 0) {
        img.setPixelColor(rgba(255, 255, 255), x, y);
      }
    }
  }
  return img.getBuffer('image/png');
}

async function pngNoise(w: number, h: number, seed = 1): Promise<Buffer> {
  // Deterministic pseudo-noise so the test is stable run-to-run.
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s % 256;
  };
  const img = new Jimp({ width: w, height: h, color: rgba(0, 0, 0) });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = rand();
      img.setPixelColor(rgba(v, v, v), x, y);
    }
  }
  return img.getBuffer('image/png');
}

const notAnImage = Buffer.from('%PDF-1.4 this is definitely not a decodable image at all');

describe('image-integrity.helper (real pixel-domain analysis)', () => {
  describe('decodeLumaGrid', () => {
    it('decodes a real PNG to a fixed grid of 0..255 luminance', async () => {
      const grid = await decodeLumaGrid(await pngSolid(80, 60, 128, 128, 128), ANALYSIS_GRID);
      expect(grid).not.toBeNull();
      expect(grid!).toHaveLength(ANALYSIS_GRID * ANALYSIS_GRID);
      expect(Math.round(meanOfGrid(grid!))).toBe(128);
    });

    it('returns null (neutral) for a non-image buffer — never throws', async () => {
      await expect(decodeLumaGrid(notAnImage)).resolves.toBeNull();
    });

    it('returns null for an empty / missing buffer', async () => {
      await expect(decodeLumaGrid(Buffer.alloc(0))).resolves.toBeNull();
      await expect(decodeLumaGrid(null)).resolves.toBeNull();
      await expect(decodeLumaGrid(undefined)).resolves.toBeNull();
    });
  });

  describe('aHash / hamming (pure + decode)', () => {
    it('identical grids → hamming 0', () => {
      const g = [1, 2, 3, 4];
      expect(hammingDistance(aHashFromGrid(g), aHashFromGrid([...g]))).toBe(0);
    });

    it('decodes to a 16×16 (256-bit) hash grid (B9 stronger fingerprint)', async () => {
      const grid = await decodeLumaGrid(await pngChecker(64, 64, 8), HASH_GRID);
      expect(HASH_GRID).toBe(16); // B9: raised from 8×8 (64-bit) to 16×16 (256-bit)
      expect(grid!).toHaveLength(HASH_GRID * HASH_GRID);
    });

    it('null for an undecodable buffer', async () => {
      await expect(aHash(notAnImage)).resolves.toBeNull();
    });
  });

  describe('beforeAfterDiffers (before≠after)', () => {
    it('is FALSE on identical images (the re-used-photo catch)', async () => {
      const img = await pngChecker(64, 64, 8);
      await expect(beforeAfterDiffers(img, Buffer.from(img))).resolves.toBe(false);
    });

    it('is TRUE on two clearly different images', async () => {
      const recce = await pngChecker(64, 64, 8);
      const install = await pngNoise(96, 96, 7);
      await expect(beforeAfterDiffers(recce, install)).resolves.toBe(true);
    });

    it('is NULL when either side is undecodable (unverifiable)', async () => {
      const good = await pngChecker(64, 64, 8);
      await expect(beforeAfterDiffers(notAnImage, good)).resolves.toBeNull();
      await expect(beforeAfterDiffers(good, null)).resolves.toBeNull();
    });
  });

  describe('blur (variance of Laplacian over decoded luminance)', () => {
    it('a uniform image reads as blurry (variance ~0)', async () => {
      const gray = await pngSolid(64, 64, 128, 128, 128);
      await expect(varianceOfLaplacian(gray)).resolves.toBeLessThan(1);
      await expect(isBlurry(gray)).resolves.toBe(true);
    });

    it('a high-contrast checkerboard reads as sharp (high variance)', async () => {
      const checker = await pngChecker(64, 64, 8);
      const v = await varianceOfLaplacian(checker);
      expect(v).not.toBeNull();
      expect(v!).toBeGreaterThan(1000);
      await expect(isBlurry(checker)).resolves.toBe(false);
    });

    it('undecodable → NEUTRAL: varianceOfLaplacian null, isBlurry false (no throw)', async () => {
      await expect(varianceOfLaplacian(notAnImage)).resolves.toBeNull();
      await expect(isBlurry(notAnImage)).resolves.toBe(false);
    });

    it('laplacianVariance is 0 on a flat grid', () => {
      expect(laplacianVariance(new Array(ANALYSIS_GRID * ANALYSIS_GRID).fill(100), ANALYSIS_GRID)).toBe(0);
    });
  });

  describe('isBlurryGrid (blur verdict = low edge energy AND enough tonal spread)', () => {
    const N = ANALYSIS_GRID;
    const flat = new Array(N * N).fill(120);
    // A smooth horizontal ramp: high tonal spread, but a linear gradient has ~0 Laplacian → BLURRY.
    const ramp = Array.from({ length: N * N }, (_, i) => Math.round(((i % N) / (N - 1)) * 255));
    // A sharp checkerboard: high edge energy → NOT blurry.
    const checker = Array.from({ length: N * N }, (_, i) => ((Math.floor(i / N) + (i % N)) % 2 ? 255 : 0));

    it('a FLAT frame is NOT called blurry (too uniform to assess focus)', () => {
      expect(stdDevOfGrid(flat)).toBeLessThan(1);
      expect(isBlurryGrid(flat)).toBe(false);
    });

    it('a smooth high-spread gradient IS blurry (tonal content, no edges)', () => {
      expect(stdDevOfGrid(ramp)).toBeGreaterThan(8);
      expect(laplacianVariance(ramp, N)).toBeLessThanOrEqual(60);
      expect(isBlurryGrid(ramp)).toBe(true);
    });

    it('a sharp checkerboard is NOT blurry (high edge energy)', () => {
      expect(isBlurryGrid(checker)).toBe(false);
    });
  });

  describe('exposure (mean decoded luminance)', () => {
    it('a solid-black image is lowLight, not overexposed', async () => {
      const dark = await pngSolid(64, 64, 0, 0, 0);
      await expect(meanLuminance(dark)).resolves.toBeLessThan(50);
      await expect(isLowLight(dark)).resolves.toBe(true);
      await expect(isOverexposed(dark)).resolves.toBe(false);
    });

    it('a solid-white image is overexposed, not lowLight', async () => {
      const bright = await pngSolid(64, 64, 255, 255, 255);
      await expect(isOverexposed(bright)).resolves.toBe(true);
      await expect(isLowLight(bright)).resolves.toBe(false);
    });

    it('a mid-tone image is neither', async () => {
      const mid = await pngSolid(64, 64, 128, 128, 128);
      await expect(isLowLight(mid)).resolves.toBe(false);
      await expect(isOverexposed(mid)).resolves.toBe(false);
    });

    it('undecodable → NEUTRAL: meanLuminance null, both flags false', async () => {
      await expect(meanLuminance(notAnImage)).resolves.toBeNull();
      await expect(isLowLight(notAnImage)).resolves.toBe(false);
      await expect(isOverexposed(notAnImage)).resolves.toBe(false);
    });
  });

  describe('computeQualityFlags / isLowAccuracy', () => {
    it('flags a poor GPS fix past the cap', () => {
      expect(isLowAccuracy(150)).toBe(true);
      expect(isLowAccuracy(20)).toBe(false);
      expect(isLowAccuracy(undefined)).toBe(false);
    });

    it('derives lowLight (not blur) from a decoded dark solid image; carries passed signals', async () => {
      const dark = await pngSolid(64, 64, 0, 0, 0);
      const flags = await computeQualityFlags(dark, { duplicate: true, lowAccuracy: false });
      expect(flags).toEqual({
        blur: false, // solid frame is too flat to assess for focus → NOT called blurry
        lowLight: true, // dark → low light (this is the meaningful flag on a black frame)
        overexposed: false,
        duplicate: true, // passed through
        lowAccuracy: false,
      });
    });

    it('a sharp mid-tone image raises no image flags', async () => {
      const checker = await pngChecker(64, 64, 8);
      const flags = await computeQualityFlags(checker, { duplicate: false, lowAccuracy: false });
      expect(flags.blur).toBe(false);
      expect(flags.lowLight).toBe(false);
      expect(flags.overexposed).toBe(false);
    });

    it('a NON-IMAGE buffer yields all-neutral image flags (no throw)', async () => {
      const flags = await computeQualityFlags(notAnImage, { duplicate: false, lowAccuracy: false });
      expect(flags).toEqual({
        blur: false, lowLight: false, overexposed: false, duplicate: false, lowAccuracy: false,
      });
    });

    it('null bytes → no image-derived flags', async () => {
      const flags = await computeQualityFlags(null, { duplicate: true, lowAccuracy: true });
      expect(flags).toEqual({
        blur: false, lowLight: false, overexposed: false, duplicate: true, lowAccuracy: true,
      });
    });
  });

  describe('B9 before≠after threshold (256-bit fingerprint)', () => {
    it('is recalibrated proportionally to 32 (12.5% of 256 bits)', () => {
      expect(BEFORE_AFTER_MIN_HAMMING).toBe(32);
    });

    it('still catches an identical (re-used) photo as too-similar', async () => {
      const img = await pngChecker(64, 64, 8);
      // Identical → hamming 0 → below the 32-bit floor → beforeAfterDiffOk false.
      await expect(beforeAfterDiffers(img, Buffer.from(img))).resolves.toBe(false);
    });

    it('still passes two clearly different photos on the stronger hash', async () => {
      const recce = await pngChecker(64, 64, 8);
      const install = await pngNoise(96, 96, 7);
      await expect(beforeAfterDiffers(recce, install)).resolves.toBe(true);
    });
  });

  describe('B6 clock-skew (client capturedAt vs server receivedAt)', () => {
    const received = new Date('2026-08-28T12:00:00.000Z');

    it('threshold is 10 minutes', () => {
      expect(CLOCK_SKEW_THRESHOLD_MS).toBe(10 * 60 * 1000);
    });

    it('flags a capture time more than 10 min from the server clock', () => {
      const captured = new Date('2026-08-28T12:20:00.000Z').toISOString(); // +20 min
      expect(clockSkewMs(captured, received)).toBe(20 * 60 * 1000);
      expect(isClockSkewed(captured, received)).toBe(true);
    });

    it('does NOT flag a capture time within 10 min (and accepts a Date too)', () => {
      const captured = new Date('2026-08-28T12:05:00.000Z'); // +5 min
      expect(isClockSkewed(captured, received)).toBe(false);
    });

    it('missing / unparseable capture time → NEUTRAL (false, unverifiable)', () => {
      expect(clockSkewMs(null, received)).toBeNull();
      expect(clockSkewMs('not-a-date', received)).toBeNull();
      expect(isClockSkewed(undefined, received)).toBe(false);
    });
  });

});
