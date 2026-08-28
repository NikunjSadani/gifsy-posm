/**
 * Field-capture media upload — posts a photo to the auth-gated media WRITE endpoint and
 * returns its stored object key.
 *
 * Contract (verified against `api/src/media/media.controller.ts` + `PosmMediaService`):
 *   - `POST /api/media/upload` (proxied to backend `/v1/media/upload`).
 *   - multipart/form-data with a single file part named **`file`**
 *     (`FileInterceptor('file')`), max 5 MB, image/PDF (magic-byte sniffed server-side).
 *   - success envelope `{ success: true, data: { key: string } }`.
 *
 * The upload endpoint stores ONLY the original bytes and returns `{ key }` — it does NOT
 * persist geo. The authoritative per-photo geotag is bound later, in the recce/installation
 * submission JSON (`photo.geo` = {lat,lng,accuracy?,capturedAt?}). We still forward the fix
 * as best-effort companion fields (lat/lng/accuracy/capturedAt) so the request carries the
 * capture context; the backend safely ignores them today.
 *
 * We use raw `fetch` (not the JSON api-client) so the browser sets the multipart boundary —
 * never set Content-Type by hand for FormData.
 */

import type { GeoFix } from './geo';

export interface UploadResult {
  key: string;
}

/**
 * Assemble the multipart body: the `file` part the backend reads, plus best-effort geo
 * companion fields. Pure + synchronous — unit-tested.
 */
export function buildUploadForm(file: File, geo?: GeoFix | null): FormData {
  const form = new FormData();
  form.append('file', file); // the FileInterceptor('file') field — must match exactly
  if (geo) {
    form.append('lat', String(geo.lat));
    form.append('lng', String(geo.lng));
    if (geo.accuracy != null) form.append('accuracy', String(geo.accuracy));
    if (geo.capturedAt) form.append('capturedAt', geo.capturedAt);
  }
  return form;
}

/**
 * Build the auth-gated inline view URL for a stored media key (pure — unit-tested).
 * `/api/media/view` is NOT public: a same-origin `<img src>` sends the httpOnly session
 * cookie, and the edge proxy injects the caller's Bearer from it before the backend's
 * role-gated view endpoint streams the bytes. Safe to use directly as an `<img src>` within
 * an authenticated session.
 */
export function mediaViewUrl(key: string): string {
  return `/api/media/view?key=${encodeURIComponent(key)}`;
}

/** Upload one captured photo and return its stored object key. Throws on any failure. */
export async function uploadMedia(file: File, geo?: GeoFix | null): Promise<UploadResult> {
  let res: Response;
  try {
    res = await fetch('/api/media/upload', { method: 'POST', body: buildUploadForm(file, geo) });
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : 'Network error while uploading the photo.');
  }

  type UploadBody = { success?: boolean; data?: { key?: string }; error?: string };
  let body: UploadBody | null = null;
  try {
    body = (await res.json()) as UploadBody;
  } catch {
    body = null;
  }

  if (!res.ok || !body?.success) {
    const msg =
      body?.error ??
      (res.status === 413
        ? 'That photo is too large (max 5 MB). Retake at a lower resolution.'
        : `Photo upload failed (${res.status}).`);
    throw new Error(msg);
  }

  const key = body.data?.key;
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('Upload succeeded but no media key was returned.');
  }
  return { key };
}
