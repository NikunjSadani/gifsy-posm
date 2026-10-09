/**
 * Field-app installation API client — the recce-keyed install surface.
 *
 * With manual recces, an outlet can carry MANY installable recces (1 app + N manual), so install
 * is no longer site-keyed: the field exec must say WHICH approved recce they are installing. This
 * module wraps `GET /v1/installation/installable?siteId=…` (the picker feed — only recces that are
 * APPROVED + HO-APPROVED + not yet installed) and exposes the recce's `recceMode` + element
 * summary so the picker can label each option honestly.
 *
 * The install POST itself lives on the install capture page; it now carries `recceId` so the
 * backend targets the exact recce (falling back server-side to the single app recce when omitted,
 * for backward compatibility).
 */

import { api } from '@/lib/api-client';
import type { RecceMode } from '@/lib/field/recce-api';

/** One element line in an installable recce's summary (enough to label the picker option). */
export interface InstallablePosm {
  slotNo: number;
  posmType: { id: string; code: string; name: string } | null;
}

/** One installable recce for an outlet (APPROVED + HO-APPROVED + not yet installed). */
export interface InstallableRecce {
  id: string;
  recceMode: RecceMode;
  site: { id: string; code: string; name: string; town: string | null };
  posms: InstallablePosm[];
  capturedAt: string | null;
}

/** `GET /v1/installation/installable` envelope payload (already unwrapped by the api-client). */
export interface InstallableResult {
  recces: InstallableRecce[];
}

/**
 * Fetch the outlet's installable recces for the field install picker. Vendor-scoped server-side
 * (a cross-vendor / cross-tenant siteId resolves as a failure). Returns the api-client
 * `ApiResponse` so callers branch on `.success`.
 */
export function fetchInstallableRecces(siteId: string) {
  return api.get<InstallableResult>(
    `/api/installation/installable?siteId=${encodeURIComponent(siteId)}`,
  );
}

/**
 * A short, human element summary for an installable recce — the POSM type names when known, else
 * a plain element count. Pure — unit-tested.
 */
export function installableElementSummary(posms: InstallablePosm[]): string {
  const names = posms
    .map((p) => p.posmType?.name?.trim())
    .filter((n): n is string => !!n);
  if (names.length > 0) return names.join(', ');
  const n = posms.length;
  return `${n} Element${n === 1 ? '' : 's'}`;
}
