/**
 * Magic-bytes (file-signature) sniffing for upload validation.
 *
 * A client-supplied Content-Type / mimetype is untrusted: an attacker can upload
 * an HTML or SVG payload labelled `image/jpeg`. We derive the file's REAL type
 * from its leading bytes and reject anything that isn't an allowed document type.
 * The view side (signed-URL render) already forces non-safe mimetypes to an
 * octet-stream download; validating on UPLOAD stops the hostile bytes from ever
 * being stored and lets the stored mimetype be trusted.
 *
 * The allowlist is deliberately a SUPERSET of the inline-renderable types so a
 * real-world capture photo is never false-rejected: phone photos (JPEG, or HEIC
 * from iOS), scans (PNG/TIFF/BMP/WEBP/GIF) and PDFs (incl. a leading UTF-8 BOM).
 * HTML/SVG/XML/script payloads match NONE of these and are rejected. Types the
 * view side can't render inline (HEIC/TIFF/BMP) are still served as a safe
 * download, never executed.
 */

export interface SniffedType {
  /** The canonical mimetype derived from the bytes (never the client's). */
  mime: string;
  /** A safe file extension for the detected type. */
  ext: string;
}

const HEIF_BRANDS = new Set([
  'heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'heif',
]);

/**
 * Detect a file's type from its magic bytes. Returns null when the signature
 * matches none of the allowed document types (JPEG / PNG / GIF / WEBP / TIFF /
 * BMP / HEIC / PDF). A leading UTF-8 BOM is tolerated.
 */
export function sniffFileType(buf: Buffer | undefined | null): SniffedType | null {
  if (!buf || buf.length < 4) return null;

  // Tolerate a leading UTF-8 BOM (some scanners/exporters prepend it).
  let b = buf;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    b = buf.subarray(3);
    if (b.length < 4) return null;
  }

  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: 'png' };
  }
  // GIF: 47 49 46 38 ("GIF8")
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return { mime: 'image/gif', ext: 'gif' };
  }
  // WEBP: "RIFF" .... "WEBP" (bytes 0-3 = RIFF, bytes 8-11 = WEBP)
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  // TIFF: "II*\0" (little-endian) or "MM\0*" (big-endian)
  if (
    (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
    (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)
  ) {
    return { mime: 'image/tiff', ext: 'tiff' };
  }
  // BMP: "BM"
  if (b[0] === 0x42 && b[1] === 0x4d) {
    return { mime: 'image/bmp', ext: 'bmp' };
  }
  // HEIC/HEIF (iOS photos): ISO-BMFF "ftyp" box (bytes 4-7) with a HEIF brand (8-11).
  if (
    b.length >= 12 &&
    b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 &&
    HEIF_BRANDS.has(b.subarray(8, 12).toString('latin1'))
  ) {
    return { mime: 'image/heic', ext: 'heic' };
  }
  // PDF: "%PDF" at offset 0 (after any BOM strip).
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) {
    return { mime: 'application/pdf', ext: 'pdf' };
  }

  return null;
}
