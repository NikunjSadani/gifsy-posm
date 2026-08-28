/**
 * image-integrity.helper.ts — capture-integrity primitives for the POSM field pipeline,
 * now operating on REAL DECODED PIXELS via a pure-JS decoder (jimp — no native binary).
 *
 * ── What changed & why ───────────────────────────────────────────────────────────────────
 * The previous cut computed its heuristics over the stored file's RAW BYTES. For a JPEG/PNG
 * those bytes are the *compressed* stream, so "mean byte value", "byte-pool aHash" and a
 * "Laplacian over pooled bytes" measure the entropy of the codec, NOT the picture — they are
 * non-functional on any real photo. This module now DECODES each image to a small fixed
 * grayscale grid and analyzes actual luminance:
 *   - before≠after  → a TRUE perceptual aHash: decode both, 8×8 grayscale, threshold each
 *                     pixel vs the grid mean, 64-bit hash, Hamming distance.
 *   - blur          → variance of a discrete Laplacian over a 32×32 decoded luminance grid.
 *   - exposure      → mean decoded luminance (0..255) too low / too high.
 *
 * ── Failure posture (never throw) ────────────────────────────────────────────────────────
 * Decoding is wrapped in try/catch. A non-image / corrupt / PDF / empty buffer yields an
 * "unverifiable / neutral" result — the decode helpers return `null`, the boolean quality
 * checks return `false` (no flag raised on evidence we cannot read), and before≠after returns
 * `null` (unverifiable) — NEVER an exception. Soft reviewer flags only; never a hard block.
 *
 * ── Async ────────────────────────────────────────────────────────────────────────────────
 * Decoding is asynchronous, so every image-analyzing routine returns a Promise. The pure math
 * over an already-decoded grid (aHash-from-grid, Laplacian variance, grid mean, Hamming) stays
 * synchronous and is exported for direct unit testing.
 *
 * ── Cost bound (defensive) ───────────────────────────────────────────────────────────────
 * Every image is resized to a FIXED small grid (8×8 for the hash, 32×32 for blur/exposure)
 * before any per-pixel work, so the analysis cost is constant regardless of the input's
 * pixel dimensions.
 *
 * ── Decode path ──────────────────────────────────────────────────────────────────────────
 * We sniff the format from the buffer's magic bytes and invoke jimp's matching format decoder
 * DIRECTLY (via `defaultFormats`), rather than `Jimp.read`. `Jimp.read`/`fromBuffer` detect the
 * MIME through a lazy `await import('file-type')` (a pure-ESM dep); calling the decoder directly
 * skips that dynamic import — one less async ESM hop at runtime, and it keeps the decode usable
 * under a CommonJS Jest VM (which cannot satisfy that native dynamic import).
 */

import { Jimp, defaultFormats } from 'jimp';

// ─────────────────────────────────────────────────────────────────────────────
// Tunable thresholds (single source of truth; imported by the service + specs)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Side of the perceptual-hash grid → an N×N = 256-cell fingerprint (a 256-bit aHash).
 *
 * B9 (audit) raised this from 8×8 (64-bit) to 16×16 (256-bit): a 64-bit aHash is coarse
 * enough that two genuinely different site photos can collide low, weakening the before≠after
 * signal. A 256-bit fingerprint quadruples the resolution, so honest install/recce pairs sit
 * clearly above the recalibrated threshold while re-used/near-identical frames still collapse
 * toward 0.
 */
export const HASH_GRID = 16;

/** Side of the blur/exposure analysis grid (decoded luminance is pooled to this size). */
export const ANALYSIS_GRID = 32;

/**
 * Minimum Hamming distance (of 256 bits) an INSTALL photo must differ from its linked RECCE
 * photo to pass the before≠after check. Below this the two are "too similar" (a re-used /
 * copied photo) → beforeAfterDiffOk = false. Identical images → distance 0 → always fails.
 *
 * Recalibrated proportionally with the B9 grid change (8×8→16×16, 64→256 bits): the old floor
 * was 8/64 = 12.5% of the bits; holding that ratio on 256 bits gives 32. Identical/near-
 * identical frames sit at 0–a-few bits, while two genuinely different photos differ by well
 * over 32 — a conservative floor that still clears re-used/duplicate frames without falsely
 * flagging two honest photos of the same site.
 */
export const BEFORE_AFTER_MIN_HAMMING = 32;

/**
 * Variance-of-Laplacian at/under this reads as BLURRY. Measured over a 32×32 decoded
 * luminance grid (0..255): a flat / smooth / out-of-focus frame produces near-zero second
 * derivatives → low variance; an in-focus, high-detail frame produces a high variance.
 * Calibrated on the 32×32 luminance domain (a uniform frame ≈ 0; a sharp edge-rich frame ≫ 60).
 */
export const BLUR_VARIANCE_THRESHOLD = 60;

/** Mean decoded luminance under this → underexposed (lowLight). */
export const LOW_LUMINANCE_THRESHOLD = 50;

/** Mean decoded luminance over this → overexposed. */
export const HIGH_LUMINANCE_THRESHOLD = 205;

/** GPS reported-accuracy (metres) over this reads as a low-accuracy fix → lowAccuracy flag. */
export const GPS_ACCURACY_CAP_METERS = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Decode step — real pixels → a small fixed grayscale luminance grid
// ─────────────────────────────────────────────────────────────────────────────

/** Rec. 601 luma from 8-bit RGB → a 0..255 grayscale luminance. */
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Lazily-built mime → jimp-format-decoder map (from the bundled defaultFormats). */
let DECODERS: Map<string, (buffer: Buffer) => Promise<{ data: Buffer; width: number; height: number }>> | null = null;
function decoders() {
  if (!DECODERS) {
    DECODERS = new Map();
    for (const make of defaultFormats) {
      const fmt = make();
      if (fmt.decode) DECODERS.set(fmt.mime, fmt.decode as never);
    }
  }
  return DECODERS;
}

/** Sniff an image mime from the buffer's leading magic bytes (jimp's decodable formats only). */
function sniffMime(b: Buffer): string | null {
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b.length >= 3 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
    (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a))) return 'image/tiff';
  return null;
}

/**
 * Decode an image buffer and reduce it to a `grid`×`grid` array of grayscale luminance values
 * (0..255, row-major). Returns `null` for an empty/missing buffer or anything we cannot decode
 * (non-image / corrupt / PDF / unknown format) — NEVER throws. The fixed-size resize caps
 * per-pixel work regardless of the source dimensions.
 */
export async function decodeLumaGrid(
  buffer: Buffer | null | undefined,
  grid: number = ANALYSIS_GRID,
): Promise<number[] | null> {
  if (!buffer || buffer.length === 0) return null;
  try {
    const mime = sniffMime(buffer);
    const decode = mime ? decoders().get(mime) : undefined;
    if (!decode) return null; // unknown / non-image format → unverifiable
    const bitmap = await decode(buffer);
    const img = Jimp.fromBitmap(bitmap);
    img.resize({ w: grid, h: grid });
    const { data, width, height } = img.bitmap;
    if (width !== grid || height !== grid) return null;
    const out = new Array<number>(grid * grid);
    for (let i = 0; i < grid * grid; i++) {
      const p = i * 4; // RGBA
      out[i] = luma(data[p], data[p + 1], data[p + 2]);
    }
    return out;
  } catch {
    return null; // unverifiable → neutral, never a throw
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Perceptual fingerprint (aHash) + Hamming distance → before≠after
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Average-hash of an ALREADY-DECODED N×N luminance grid: set each bit where the cell's
 * luminance exceeds the grid mean. Returned as a BigInt bitset (bit i = cell i), so it scales
 * to any grid size (64-bit for an 8×8 grid, 256-bit for the 16×16 HASH_GRID). Pure/sync.
 */
export function aHashFromGrid(grid: number[]): bigint {
  const mean = grid.reduce((a, b) => a + b, 0) / grid.length;
  let bits = 0n;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] > mean) bits |= 1n << BigInt(i);
  }
  return bits;
}

/**
 * Decode a buffer to a HASH_GRID×HASH_GRID luminance grid and return its perceptual aHash
 * (256-bit at the default 16×16 grid), or `null` when the buffer is missing/undecodable
 * (unverifiable). Async (decode).
 */
export async function aHash(buffer: Buffer | null | undefined): Promise<bigint | null> {
  const grid = await decodeLumaGrid(buffer, HASH_GRID);
  return grid ? aHashFromGrid(grid) : null;
}

/** Number of differing bits between two 64-bit fingerprints (XOR popcount). Pure/sync. */
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
 * Returns true when the decoded-aHash Hamming distance ≥ BEFORE_AFTER_MIN_HAMMING; false when
 * the two are too similar (identical / re-used photo → distance ~0 → false). Returns `null`
 * when EITHER image is missing or undecodable (unverifiable — never a pass on unreadable
 * evidence). Async (decodes both images).
 */
export async function beforeAfterDiffers(
  recceBytes: Buffer | null | undefined,
  installBytes: Buffer | null | undefined,
  minHamming: number = BEFORE_AFTER_MIN_HAMMING,
): Promise<boolean | null> {
  const [a, b] = await Promise.all([aHash(recceBytes), aHash(installBytes)]);
  if (a === null || b === null) return null;
  return hammingDistance(a, b) >= minHamming;
}

// ─────────────────────────────────────────────────────────────────────────────
// Blur (variance of a discrete Laplacian over the decoded luminance grid)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Variance of a discrete Laplacian over a decoded `gridSize`×`gridSize` luminance grid: for
 * each interior cell, lap = 4·c − (up+down+left+right); return the variance of those laps.
 * A flat / out-of-focus frame → laps near 0 → low variance; a sharp, high-detail frame →
 * high variance. Pure/sync (operates on the already-decoded grid).
 */
export function laplacianVariance(grid: number[], gridSize: number = ANALYSIS_GRID): number {
  const at = (r: number, c: number) => grid[r * gridSize + c];
  const laps: number[] = [];
  for (let r = 1; r < gridSize - 1; r++) {
    for (let c = 1; c < gridSize - 1; c++) {
      laps.push(4 * at(r, c) - at(r - 1, c) - at(r + 1, c) - at(r, c - 1) - at(r, c + 1));
    }
  }
  if (laps.length === 0) return 0;
  const mean = laps.reduce((a, b) => a + b, 0) / laps.length;
  return laps.reduce((a, b) => a + (b - mean) ** 2, 0) / laps.length;
}

/**
 * Decode a buffer to a 32×32 luminance grid and return its variance-of-Laplacian, or `null`
 * when the buffer is missing/undecodable (unverifiable). Async (decode).
 */
export async function varianceOfLaplacian(
  buffer: Buffer | null | undefined,
): Promise<number | null> {
  const grid = await decodeLumaGrid(buffer, ANALYSIS_GRID);
  return grid ? laplacianVariance(grid, ANALYSIS_GRID) : null;
}

/**
 * Blurry when the decoded variance-of-Laplacian is at/under the threshold. Missing/undecodable
 * → false (NEUTRAL — no blur flag raised on evidence we cannot read). Async (decode).
 */
export async function isBlurry(
  buffer: Buffer | null | undefined,
  threshold: number = BLUR_VARIANCE_THRESHOLD,
): Promise<boolean> {
  const v = await varianceOfLaplacian(buffer);
  return v === null ? false : v <= threshold;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exposure (mean decoded luminance)
// ─────────────────────────────────────────────────────────────────────────────

/** Mean of an already-decoded luminance grid (0..255). 0 for an empty grid. Pure/sync. */
export function meanOfGrid(grid: number[]): number {
  if (grid.length === 0) return 0;
  return grid.reduce((a, b) => a + b, 0) / grid.length;
}

/**
 * Decode a buffer to a 32×32 luminance grid and return its mean luminance (0..255), or `null`
 * when the buffer is missing/undecodable (unverifiable). Async (decode).
 */
export async function meanLuminance(buffer: Buffer | null | undefined): Promise<number | null> {
  const grid = await decodeLumaGrid(buffer, ANALYSIS_GRID);
  return grid ? meanOfGrid(grid) : null;
}

/**
 * Underexposed when the decoded mean luminance is under the low threshold. Missing/undecodable
 * → false (NEUTRAL). Async (decode).
 */
export async function isLowLight(
  buffer: Buffer | null | undefined,
  threshold: number = LOW_LUMINANCE_THRESHOLD,
): Promise<boolean> {
  const m = await meanLuminance(buffer);
  return m === null ? false : m < threshold;
}

/**
 * Overexposed when the decoded mean luminance is over the high threshold. Missing/undecodable
 * → false (NEUTRAL). Async (decode).
 */
export async function isOverexposed(
  buffer: Buffer | null | undefined,
  threshold: number = HIGH_LUMINANCE_THRESHOLD,
): Promise<boolean> {
  const m = await meanLuminance(buffer);
  return m === null ? false : m > threshold;
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
 * the DECODED pixels (a single decode drives all three); `duplicate` (cross-submission hash
 * hit) and `lowAccuracy` (poor GPS fix) are passed in by the caller which owns those signals.
 * A missing / undecodable buffer yields all image-derived flags = false (NEUTRAL — never a
 * throw, never a flag on evidence we cannot read). All flags are SOFT (advisory), never a
 * hard block. Async (decode).
 */
export async function computeQualityFlags(
  bytes: Buffer | null | undefined,
  signals: { duplicate: boolean; lowAccuracy: boolean },
): Promise<QualityFlags> {
  // Decode ONCE at the analysis grid; derive blur + exposure from the same luminance grid.
  const grid = await decodeLumaGrid(bytes, ANALYSIS_GRID);
  const mean = grid ? meanOfGrid(grid) : null;
  return {
    blur: grid ? laplacianVariance(grid, ANALYSIS_GRID) <= BLUR_VARIANCE_THRESHOLD : false,
    lowLight: mean === null ? false : mean < LOW_LUMINANCE_THRESHOLD,
    overexposed: mean === null ? false : mean > HIGH_LUMINANCE_THRESHOLD,
    duplicate: signals.duplicate,
    lowAccuracy: signals.lowAccuracy,
  };
}

/** GPS fix quality: a reported accuracy worse than the cap reads as low-accuracy. Pure/sync. */
export function isLowAccuracy(
  accuracy: number | null | undefined,
  cap: number = GPS_ACCURACY_CAP_METERS,
): boolean {
  return typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy > cap;
}

// ─────────────────────────────────────────────────────────────────────────────
// B9 grid change note: HASH_GRID/BEFORE_AFTER_MIN_HAMMING live at the top of the file.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// B6 (clock-skew) — client shutter time vs. server receive time
// ─────────────────────────────────────────────────────────────────────────────

/** |client capturedAt − server receivedAt| beyond this reads as a clock-skew flag. */
export const CLOCK_SKEW_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Absolute skew (ms) between a client-reported capture time and the server receive time, or
 * `null` when either is missing / unparseable (unverifiable — never a flag on absent evidence).
 * Pure/sync.
 */
export function clockSkewMs(
  capturedAt: string | Date | null | undefined,
  receivedAt: Date,
): number | null {
  if (!capturedAt) return null;
  const t = capturedAt instanceof Date ? capturedAt.getTime() : Date.parse(capturedAt);
  if (Number.isNaN(t)) return null;
  const r = receivedAt.getTime();
  if (Number.isNaN(r)) return null;
  return Math.abs(t - r);
}

/**
 * Clock-skew flag: true when the client capture time and the server receive time differ by
 * more than `thresholdMs`. Missing/unparseable capture time → false (NEUTRAL, unverifiable —
 * never a flag on evidence we cannot read). Pure/sync.
 */
export function isClockSkewed(
  capturedAt: string | Date | null | undefined,
  receivedAt: Date,
  thresholdMs: number = CLOCK_SKEW_THRESHOLD_MS,
): boolean {
  const d = clockSkewMs(capturedAt, receivedAt);
  return d === null ? false : d > thresholdMs;
}

// ─────────────────────────────────────────────────────────────────────────────
// B2 (impossible-travel) — implied speed between two timestamped fixes
// ─────────────────────────────────────────────────────────────────────────────

/** Implied ground speed beyond this (km/h) reads as physically impossible → a reviewer flag. */
export const IMPOSSIBLE_SPEED_KMH = 200;

/**
 * Implied ground speed (km/h) to cover `distanceMeters` in the interval between two client
 * capture times, or `null` when the distance or either timestamp is missing/unparseable, or
 * the interval is ≤ 0 (unverifiable — two fixes at the same instant imply no travel we can
 * measure). Pure/sync.
 */
export function impliedSpeedKmh(
  distanceMeters: number | null | undefined,
  fromCapturedAt: string | Date | null | undefined,
  toCapturedAt: string | Date | null | undefined,
): number | null {
  if (typeof distanceMeters !== 'number' || !Number.isFinite(distanceMeters)) return null;
  const parse = (v: string | Date | null | undefined): number | null => {
    if (!v) return null;
    const t = v instanceof Date ? v.getTime() : Date.parse(v);
    return Number.isNaN(t) ? null : t;
  };
  const a = parse(fromCapturedAt);
  const b = parse(toCapturedAt);
  if (a === null || b === null) return null;
  const dtMs = Math.abs(b - a);
  if (dtMs <= 0) return null;
  const hours = dtMs / 3_600_000;
  const km = distanceMeters / 1000;
  return km / hours;
}

/**
 * Impossible-travel flag: true when the implied speed to move `distanceMeters` between the two
 * capture times exceeds `capKmh`. Missing distance/timestamps or a zero interval → false
 * (NEUTRAL, unverifiable). Pure/sync.
 */
export function isImpossibleTravel(
  distanceMeters: number | null | undefined,
  fromCapturedAt: string | Date | null | undefined,
  toCapturedAt: string | Date | null | undefined,
  capKmh: number = IMPOSSIBLE_SPEED_KMH,
): boolean {
  const s = impliedSpeedKmh(distanceMeters, fromCapturedAt, toCapturedAt);
  return s === null ? false : s > capKmh;
}
