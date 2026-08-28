/**
 * watermark.util.ts — VIEW-TIME evidence watermark for POSM capture media.
 *
 * Composites a small, legible provenance strip onto a decoded image ON THE FLY, at the moment
 * it is streamed to a viewer. The stored object is NEVER touched — the anti-fraud controls
 * (duplicate SHA-256 hash, before≠after perceptual diff, per-photo geo) all read the ORIGINAL
 * stored bytes, so applying the watermark only to the streamed copy leaves every one of them
 * unaffected.
 *
 * ── Why a self-contained bitmap font (no jimp fonts) ─────────────────────────────────────────
 * jimp's `loadFont`/`print` path performs a dynamic `import()` (of `fs`, then `Jimp.read` on the
 * font PNG pages, which itself does `await import('file-type')` — a pure-ESM dep). Under the
 * CommonJS Jest VM that dynamic import throws ("A dynamic import callback was invoked without
 * --experimental-vm-modules"), exactly the ESM-under-Jest hazard the capture-integrity helper
 * documents. So text is rendered here from a tiny embedded 5×7 pixel font blitted directly onto
 * the bitmap — deterministic, dependency-free, and identical at runtime and under test.
 *
 * ── Decode path ──────────────────────────────────────────────────────────────────────────────
 * Same as image-integrity.helper: sniff the format from magic bytes and call the matching jimp
 * format decoder DIRECTLY (via `defaultFormats`), NOT `Jimp.read` — avoiding the lazy
 * `await import('file-type')` hop. A non-image / corrupt / PDF / webp / empty buffer is not
 * decodable → `watermarkImage` returns `null` and the caller serves the original unchanged.
 */

import { Jimp, defaultFormats } from 'jimp';

// ─────────────────────────────────────────────────────────────────────────────
// Decoder / encoder maps (built once from jimp's bundled default formats)
// ─────────────────────────────────────────────────────────────────────────────

type JimpImage = ReturnType<typeof Jimp.fromBitmap>;

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

/** Sniff a jimp-decodable image mime from the buffer's leading magic bytes; null otherwise. */
export function sniffImageMime(b: Buffer | null | undefined): string | null {
  if (!b || b.length < 2) return null;
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b.length >= 3 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
    (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a))) return 'image/tiff';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Embedded 5×7 pixel font (uppercase + digits + a little punctuation)
// ─────────────────────────────────────────────────────────────────────────────

const GLYPH_W = 5;
const GLYPH_H = 7;

/** Each glyph is 7 rows × 5 columns; '#' = an on pixel. Missing chars render as blank. */
const GLYPHS: Record<string, string[]> = {
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '..##.', '.#...', '#....', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '..#..', '.#...'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '|': ['..#..', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
};

/** Normalize an arbitrary caption to the font's supported set: uppercase, unknowns → space. */
export function normalizeCaption(text: string): string {
  const up = (text || '').toUpperCase();
  let out = '';
  for (const ch of up) out += GLYPHS[ch] ? ch : ' ';
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pixel helpers (operate directly on the RGBA bitmap — no font/print dependency)
// ─────────────────────────────────────────────────────────────────────────────

function blendPixel(img: JimpImage, x: number, y: number, r: number, g: number, b: number, a: number) {
  const { width, height, data } = img.bitmap;
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const i = (y * width + x) * 4;
  data[i] = Math.round(data[i] * (1 - a) + r * a);
  data[i + 1] = Math.round(data[i + 1] * (1 - a) + g * a);
  data[i + 2] = Math.round(data[i + 2] * (1 - a) + b * a);
  data[i + 3] = 255;
}

function fillRect(img: JimpImage, x0: number, y0: number, w: number, h: number, r: number, g: number, b: number, a: number) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) blendPixel(img, x, y, r, g, b, a);
  }
}

function drawGlyph(img: JimpImage, ch: string, x0: number, y0: number, scale: number) {
  const rows = GLYPHS[ch];
  if (!rows) return;
  for (let row = 0; row < GLYPH_H; row++) {
    for (let col = 0; col < GLYPH_W; col++) {
      if (rows[row][col] !== '#') continue;
      // opaque white glyph pixel, scaled to a `scale`×`scale` block
      fillRect(img, x0 + col * scale, y0 + row * scale, scale, scale, 255, 255, 255, 1);
    }
  }
}

/**
 * Composite a legible provenance caption onto a semi-opaque black strip along the image's
 * BOTTOM edge. Font size scales with the image width; the caption is clipped to what fits on
 * one line. Mutates `img` in place.
 */
export function drawWatermark(img: JimpImage, caption: string): void {
  const W = img.bitmap.width;
  const H = img.bitmap.height;
  if (W < 1 || H < 1) return;

  const scale = Math.max(1, Math.round(W / 480)); // ~ legible across thumbnail → full-res
  const pad = 2 * scale;
  const charW = (GLYPH_W + 1) * scale; // 1 blank column between glyphs
  const textH = GLYPH_H * scale;
  const stripH = Math.min(H, textH + 2 * pad);
  const y0 = H - stripH;

  // semi-opaque black strip (evidence band)
  fillRect(img, 0, y0, W, stripH, 0, 0, 0, 0.55);

  const chars = normalizeCaption(caption);
  const maxChars = Math.max(0, Math.floor((W - 2 * pad) / charW));
  let x = pad;
  const gy = y0 + pad;
  for (const ch of chars.slice(0, maxChars)) {
    drawGlyph(img, ch, x, gy, scale);
    x += charW;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: decode → watermark → re-encode (same image type), on the fly
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decode `bytes`, composite `caption`, and re-encode to the SAME image type. Returns the
 * watermarked buffer, or `null` when the bytes are not a decodable image (non-image / corrupt /
 * PDF / webp) — the caller then serves the original unchanged. Never throws: any decode/encode
 * failure yields `null`. The stored object is never modified.
 */
export async function watermarkImage(bytes: Buffer, caption: string): Promise<Buffer | null> {
  try {
    const mime = sniffImageMime(bytes);
    if (!mime) return null;
    const decode = decoders().get(mime);
    if (!decode) return null;
    const bitmap = await decode(bytes);
    const img = Jimp.fromBitmap(bitmap);
    drawWatermark(img, caption);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (img as any).getBuffer(mime);
  } catch {
    return null; // undecodable / unencodable → serve original
  }
}
