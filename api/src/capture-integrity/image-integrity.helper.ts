/**
 * image-integrity.helper.ts — pure, dependency-free capture-integrity primitives for the
 * POSM field pipeline. NO NestJS / Prisma / image-decoder imports, so every routine is
 * unit-testable on synthetic buffers and safe to import from services and specs alike.
 *
 * ── Scope + honest caveat ────────────────────────────────────────────────────────────────
 * The dependency set carries NO image decoder (no sharp/jimp), so these are FIRST-CUT,
 * BYTE-DOMAIN heuristics that treat the stored file's raw bytes as a pixel-proxy signal:
 *   - before≠after  → an aHash-style 8×8 average-pool fingerprint + Hamming distance;
 *   - blur          → variance of a discrete Laplacian over the 8×8 pooled grid;
 *   - exposure      → mean byte value (luminance-proxy) too low / too high.
 * They are deterministic and directional (identical input → identical output; a constant
 * buffer reads as blurry/dark; a high-frequency buffer reads as sharp), which is what the
 * pipeline's soft reviewer-flags need. When an image decoder is added the internals can be
 * upgraded to true grayscale-pixel aHash / Laplacian / luminance WITHOUT changing any caller
 * (the public signatures below are pixel-agnostic on purpose).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tunable thresholds (single source of truth; imported by the service + specs)
// ─────────────────────────────────────────────────────────────────────────────

/** Side of the average-pool grid → an N×N = 64-cell fingerprint (a 64-bit aHash). */
export const HASH_GRID = 8;

/**
 * Minimum Hamming distance (of 64 bits) an INSTALL photo must differ from its linked RECCE
 * photo to pass the before≠after check. Below this the two are "too similar" (a re-used /
 * copied photo) → beforeAfterDiffOk = false. Identical bytes → distance 0 → always fails.
 */
export const BEFORE_AFTER_MIN_HAMMING = 10;

/** Variance-of-Laplacian at/under this reads as BLURRY (a flat, low-detail signal). */
export const BLUR_VARIANCE_THRESHOLD = 100;

/** Mean luminance-proxy under this → underexposed (lowLight). */
export const LOW_LUMINANCE_THRESHOLD = 40;

/** Mean luminance-proxy over this → overexposed. */
export const HIGH_LUMINANCE_THRESHOLD = 220;

/** GPS reported-accuracy (metres) over this reads as a low-accuracy fix → lowAccuracy flag. */
export const GPS_ACCURACY_CAP_METERS = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Average-pool sampling → the shared pooled grid
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Average-pool a byte buffer into `grid`×`grid` cell means (0..255). Each cell is the mean
 * of a contiguous byte slice; an empty buffer yields all-zero cells. Deterministic and
 * length-independent (the fingerprint of two different-length encodings of the same content
 * is comparable, and identical bytes always pool identically).
 */
export function poolGrid(buffer: Buffer, grid: number = HASH_GRID): number[] {
  const cells = grid * grid;
  const out = new Array<number>(cells).fill(0);
  const n = buffer.length;
  if (n === 0) return out;
  for (let i = 0; i < cells; i++) {
    const start = Math.floor((i * n) / cells);
    const end = Math.max(start + 1, Math.floor(((i + 1) * n) / cells));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end && j < n; j++) {
      sum += buffer[j];
      count++;
    }
    out[i] = count > 0 ? sum / count : buffer[Math.min(i, n - 1)];
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Perceptual fingerprint (aHash) + Hamming distance → before≠after
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 64-bit average-hash (aHash) of a buffer: pool to an 8×8 grid, then set each bit where the
 * cell's mean exceeds the grid's overall mean. Returned as a BigInt bitset (bit i = cell i).
 */
export function aHash(buffer: Buffer): bigint {
  const cells = poolGrid(buffer, HASH_GRID);
  const mean = cells.reduce((a, b) => a + b, 0) / cells.length;
  let bits = 0n;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] > mean) bits |= 1n << BigInt(i);
  }
  return bits;
}

/** Number of differing bits between two 64-bit fingerprints (XOR popcount). */
export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/**
 * before≠after: does the INSTALL photo differ ENOUGH from its linked RECCE photo?
 * Returns true when the aHash Hamming distance ≥ BEFORE_AFTER_MIN_HAMMING. Identical bytes
 * → distance 0 → false (the anti-fraud "re-used the recce photo" catch).
 */
export function beforeAfterDiffers(
  recceBytes: Buffer,
  installBytes: Buffer,
  minHamming: number = BEFORE_AFTER_MIN_HAMMING,
): boolean {
  return hammingDistance(aHash(recceBytes), aHash(installBytes)) >= minHamming;
}

// ─────────────────────────────────────────────────────────────────────────────
// Blur (variance of Laplacian over the pooled grid)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Variance of a discrete Laplacian over the 8×8 pooled grid: for each interior cell,
 * lap = 4·c − (up+down+left+right); return the variance of those lap values. A flat / smooth
 * (blurry) signal → laps near 0 → low variance; a high-detail (sharp) signal → high variance.
 */
export function varianceOfLaplacian(buffer: Buffer, grid: number = HASH_GRID): number {
  const cells = poolGrid(buffer, grid);
  const at = (r: number, c: number) => cells[r * grid + c];
  const laps: number[] = [];
  for (let r = 1; r < grid - 1; r++) {
    for (let c = 1; c < grid - 1; c++) {
      laps.push(4 * at(r, c) - at(r - 1, c) - at(r + 1, c) - at(r, c - 1) - at(r, c + 1));
    }
  }
  if (laps.length === 0) return 0;
  const mean = laps.reduce((a, b) => a + b, 0) / laps.length;
  return laps.reduce((a, b) => a + (b - mean) ** 2, 0) / laps.length;
}

/** Blurry when the variance-of-Laplacian is at/under the threshold (a flat, low-detail image). */
export function isBlurry(buffer: Buffer, threshold: number = BLUR_VARIANCE_THRESHOLD): boolean {
  return varianceOfLaplacian(buffer) <= threshold;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exposure (mean luminance-proxy)
// ─────────────────────────────────────────────────────────────────────────────

/** Mean byte value (0..255) — a luminance-proxy over the raw bytes. 0 for an empty buffer. */
export function meanLuminance(buffer: Buffer): number {
  const n = buffer.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += buffer[i];
  return sum / n;
}

/** Underexposed when the mean luminance-proxy is under the low threshold. */
export function isLowLight(buffer: Buffer, threshold: number = LOW_LUMINANCE_THRESHOLD): boolean {
  return meanLuminance(buffer) < threshold;
}

/** Overexposed when the mean luminance-proxy is over the high threshold. */
export function isOverexposed(buffer: Buffer, threshold: number = HIGH_LUMINANCE_THRESHOLD): boolean {
  return meanLuminance(buffer) > threshold;
}

// ─────────────────────────────────────────────────────────────────────────────
// Combined quality flags (the soft reviewer signals)
// ─────────────────────────────────────────────────────────────────────────────

/** The soft, reviewer-facing capture-quality flags persisted on an install POSM. */
export interface QualityFlags {
  blur: boolean;
  lowLight: boolean;
  overexposed: boolean;
  duplicate: boolean;
  lowAccuracy: boolean;
}

/**
 * Assemble the quality flags for one photo. `blur`/`lowLight`/`overexposed` are derived from
 * the bytes; `duplicate` (cross-submission hash hit) and `lowAccuracy` (poor GPS fix) are
 * passed in by the caller which owns those signals. All flags are SOFT (advisory to the
 * reviewer) — never a hard block.
 */
export function computeQualityFlags(
  bytes: Buffer | null,
  signals: { duplicate: boolean; lowAccuracy: boolean },
): QualityFlags {
  return {
    blur: bytes ? isBlurry(bytes) : false,
    lowLight: bytes ? isLowLight(bytes) : false,
    overexposed: bytes ? isOverexposed(bytes) : false,
    duplicate: signals.duplicate,
    lowAccuracy: signals.lowAccuracy,
  };
}

/** GPS fix quality: a reported accuracy worse than the cap reads as low-accuracy. */
export function isLowAccuracy(
  accuracy: number | null | undefined,
  cap: number = GPS_ACCURACY_CAP_METERS,
): boolean {
  return typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy > cap;
}
