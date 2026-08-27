import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';
import { randomUUID } from 'node:crypto';
import * as path from 'path';

/**
 * GCS object storage. Files are private by default; use getSignedUrl for temporary
 * read access, or downloadBytes/downloadAsDataUrl for a signing-free inline render.
 *
 * Auth: Cloud Run → Application Default Credentials (attached service account);
 * local dev → GOOGLE_APPLICATION_CREDENTIALS=/path/to/dev-sa-key.json.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly storage: Storage;
  private readonly bucket: string;
  private readonly defaultExpirySec = 3600;

  constructor(private readonly config: ConfigService) {
    // Secret Manager values can arrive with a leading UTF-8 BOM (U+FEFF) and/or
    // trailing CR/LF — a Windows Out-File/echo artifact. GCS rejects such values
    // outright, turning every upload into a bare 500. Strip a leading BOM and
    // surrounding whitespace/newlines so a dirty secret can never break uploads.
    const clean = (v?: string): string | undefined =>
      v?.replace(/^﻿/, '').trim() || undefined;
    this.storage = new Storage({ projectId: clean(this.config.get<string>('GCP_PROJECT_ID')) });
    this.bucket = clean(this.config.get<string>('GCS_BUCKET')) ?? 'posm-platform-files';
  }

  /**
   * Generate a unique object key within a folder.
   * e.g. generateKey('posm-media', 'recce.jpg') → 'posm-media/2026-08/uuid-recce.jpg'
   */
  generateKey(folder: string, filename: string): string {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext).replace(/[^a-zA-Z0-9-_]/g, '_');
    const yearMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    return `${folder}/${yearMonth}/${randomUUID()}-${base}${ext}`;
  }

  /** The canonical (private) object URL for a key — same form uploadFile returns. */
  publicUrl(key: string): string {
    return `https://storage.googleapis.com/${this.bucket}/${key}`;
  }

  /** Upload a Buffer and return the (private) object URL. */
  async uploadFile(file: Buffer, key: string, contentType: string): Promise<string> {
    await this.storage.bucket(this.bucket).file(key).save(file, {
      contentType,
      resumable: false, // simple upload for typical capture/report files (< 5MB)
    });
    return this.publicUrl(key);
  }

  /** V4 signed GET URL for a private object. */
  async getSignedUrl(key: string, expiresInSec = this.defaultExpirySec): Promise<string> {
    const [url] = await this.storage.bucket(this.bucket).file(key).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + expiresInSec * 1000,
    });
    return url;
  }

  /**
   * Read a private object and return it as a `data:` URL (base64-inlined).
   *
   * The signing-free way to surface a private GCS object to the browser: a data URL
   * needs no auth and renders in an <img>. Object READ works wherever the SA has
   * objectAdmin (the same grant that lets uploadFile write), whereas signing is
   * unreliable on Cloud Run and impossible locally.
   *
   * Bounded: objects larger than maxBytes return null (caller falls back to a
   * placeholder) so a stray large upload can't bloat a JSON response.
   */
  async downloadAsDataUrl(
    key: string,
    contentType?: string,
    maxBytes = 8 * 1024 * 1024,
  ): Promise<string | null> {
    const file = this.storage.bucket(this.bucket).file(key);
    const [meta] = await file.getMetadata();
    const size = Number(meta.size ?? 0);
    if (size > maxBytes) {
      this.logger.warn(`downloadAsDataUrl: ${key} is ${size}B (> ${maxBytes}B cap) — skipping inline`);
      return null;
    }
    const ct = contentType || meta.contentType || 'application/octet-stream';
    const [buf] = await file.download();
    return `data:${ct};base64,${buf.toString('base64')}`;
  }

  /**
   * Read a private object and return its raw BYTES + content-type, or null.
   *
   * Same signing-free read path as downloadAsDataUrl. Used to stream a private object
   * inline to the browser (the tokenized media-view endpoint).
   *
   * Bounded: objects larger than maxBytes return null (caller → 404). Returns null if
   * the object is missing.
   */
  async downloadBytes(
    key: string,
    maxBytes = 24 * 1024 * 1024,
  ): Promise<{ bytes: Buffer; contentType: string } | null> {
    try {
      const file = this.storage.bucket(this.bucket).file(key);
      const [meta] = await file.getMetadata();
      const size = Number(meta.size ?? 0);
      if (size > maxBytes) {
        this.logger.warn(`downloadBytes: ${key} is ${size}B (> ${maxBytes}B cap) — refusing`);
        return null;
      }
      const [buf] = await file.download();
      return { bytes: buf, contentType: meta.contentType || 'application/octet-stream' };
    } catch (err) {
      this.logger.warn(`downloadBytes: failed to read ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  /** Delete an object. */
  async deleteFile(key: string): Promise<void> {
    await this.storage.bucket(this.bucket).file(key).delete();
  }
}
