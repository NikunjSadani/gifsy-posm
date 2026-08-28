import { describe, it, expect } from 'vitest';
import { buildUploadForm, mediaViewUrl } from '@/lib/field/media-upload';
import type { GeoFix } from '@/lib/field/geo';

function makeFile(): File {
  return new File([new Uint8Array([1, 2, 3])], 'posm.jpg', { type: 'image/jpeg' });
}

describe('buildUploadForm — multipart body assembly', () => {
  it('always includes the file part under the exact field name "file"', () => {
    const form = buildUploadForm(makeFile());
    const f = form.get('file');
    expect(f).toBeInstanceOf(File);
    expect((f as File).name).toBe('posm.jpg');
  });

  it('appends geo companion fields when a fix is provided', () => {
    const geo: GeoFix = { lat: 19.076, lng: 72.8777, accuracy: 8, capturedAt: '2026-08-28T10:00:00.000Z' };
    const form = buildUploadForm(makeFile(), geo);
    expect(form.get('lat')).toBe('19.076');
    expect(form.get('lng')).toBe('72.8777');
    expect(form.get('accuracy')).toBe('8');
    expect(form.get('capturedAt')).toBe('2026-08-28T10:00:00.000Z');
  });

  it('omits accuracy when absent but keeps lat/lng/capturedAt', () => {
    const geo: GeoFix = { lat: 1, lng: 2, capturedAt: '2026-08-28T10:00:00.000Z' };
    const form = buildUploadForm(makeFile(), geo);
    expect(form.get('lat')).toBe('1');
    expect(form.get('accuracy')).toBeNull();
  });

  it('sends only the file when no geo is provided', () => {
    const form = buildUploadForm(makeFile(), null);
    expect(form.get('file')).toBeInstanceOf(File);
    expect(form.get('lat')).toBeNull();
    expect(form.get('lng')).toBeNull();
  });
});

describe('mediaViewUrl — auth-gated inline view path', () => {
  it('builds the proxied view path with an encoded key', () => {
    expect(mediaViewUrl('posm-media/client1/abc.jpg')).toBe(
      '/api/media/view?key=posm-media%2Fclient1%2Fabc.jpg',
    );
  });
});
