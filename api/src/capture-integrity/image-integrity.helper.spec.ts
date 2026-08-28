import {
  aHash, hammingDistance, beforeAfterDiffers, varianceOfLaplacian, isBlurry,
  meanLuminance, isLowLight, isOverexposed, computeQualityFlags, isLowAccuracy,
  poolGrid,
} from './image-integrity.helper';

/** Build a 64×64-byte buffer where each of the 64 pooled cells holds a fixed value. */
function cellBuf(values: number[]): Buffer {
  const cell = 64;
  const b = Buffer.alloc(64 * cell);
  for (let i = 0; i < 64; i++) b.fill(values[i], i * cell, (i + 1) * cell);
  return b;
}

describe('image-integrity.helper', () => {
  describe('poolGrid / aHash / hamming', () => {
    it('pools an empty buffer to all-zero cells (no throw)', () => {
      expect(poolGrid(Buffer.alloc(0))).toHaveLength(64);
      expect(poolGrid(Buffer.alloc(0)).every((c) => c === 0)).toBe(true);
    });

    it('identical bytes → identical aHash → hamming 0', () => {
      const buf = Buffer.alloc(2048, 137);
      expect(hammingDistance(aHash(buf), aHash(Buffer.from(buf)))).toBe(0);
    });

    it('opposite half/half buffers → large hamming distance', () => {
      const a = Buffer.alloc(4096, 0); a.fill(255, 2048); // second half bright
      const b = Buffer.alloc(4096, 0); b.fill(255, 0, 2048); // first half bright
      expect(hammingDistance(aHash(a), aHash(b))).toBeGreaterThanOrEqual(10);
    });
  });

  describe('beforeAfterDiffers (before≠after)', () => {
    // The load-bearing anti-fraud proof: a re-used (identical) photo must NOT pass.
    it('is FALSE on identical bytes', () => {
      const buf = Buffer.alloc(4096, 200);
      expect(beforeAfterDiffers(buf, Buffer.from(buf))).toBe(false);
    });

    it('is TRUE on clearly different images', () => {
      const recce = Buffer.alloc(4096, 0); recce.fill(255, 2048);
      const install = Buffer.alloc(4096, 0); install.fill(255, 0, 2048);
      expect(beforeAfterDiffers(recce, install)).toBe(true);
    });
  });

  describe('blur (variance of Laplacian)', () => {
    it('a flat (constant) image reads as blurry', () => {
      const flat = cellBuf(new Array(64).fill(100));
      expect(varianceOfLaplacian(flat)).toBe(0);
      expect(isBlurry(flat)).toBe(true);
    });

    it('a high-detail (checkerboard) image reads as sharp', () => {
      const checker = cellBuf(
        Array.from({ length: 64 }, (_, i) => ((Math.floor(i / 8) + (i % 8)) % 2 ? 255 : 0)),
      );
      expect(varianceOfLaplacian(checker)).toBeGreaterThan(100);
      expect(isBlurry(checker)).toBe(false);
    });
  });

  describe('exposure (mean luminance)', () => {
    it('a dark image is lowLight', () => {
      const dark = Buffer.alloc(1024, 10);
      expect(meanLuminance(dark)).toBeCloseTo(10, 5);
      expect(isLowLight(dark)).toBe(true);
      expect(isOverexposed(dark)).toBe(false);
    });

    it('a bright image is overexposed', () => {
      const bright = Buffer.alloc(1024, 250);
      expect(isOverexposed(bright)).toBe(true);
      expect(isLowLight(bright)).toBe(false);
    });

    it('a mid-tone image is neither', () => {
      const mid = Buffer.alloc(1024, 128);
      expect(isLowLight(mid)).toBe(false);
      expect(isOverexposed(mid)).toBe(false);
    });
  });

  describe('computeQualityFlags / isLowAccuracy', () => {
    it('flags a poor GPS fix past the cap', () => {
      expect(isLowAccuracy(150)).toBe(true);
      expect(isLowAccuracy(20)).toBe(false);
      expect(isLowAccuracy(undefined)).toBe(false);
    });

    it('assembles all five flags; null bytes → no image-derived flags', () => {
      const flags = computeQualityFlags(null, { duplicate: true, lowAccuracy: true });
      expect(flags).toEqual({
        blur: false, lowLight: false, overexposed: false, duplicate: true, lowAccuracy: true,
      });
    });

    it('derives blur/lowLight from bytes when present', () => {
      const dark = cellBuf(new Array(64).fill(5));
      const flags = computeQualityFlags(dark, { duplicate: false, lowAccuracy: false });
      expect(flags.blur).toBe(true);
      expect(flags.lowLight).toBe(true);
    });
  });
});
