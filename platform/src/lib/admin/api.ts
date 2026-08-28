/* ─── Admin masters — typed API client ───────────────────────────────────────
   Thin wrappers over the central `api` fetch helper (which returns an ApiResponse
   envelope and carries the httpOnly session cookie through the /api proxy → /v1).
   The Excel bulk-upload uses a raw multipart fetch (FormData sets its own
   Content-Type boundary — never set it manually).
─────────────────────────────────────────────────────────────────────────────── */

import { api, type ApiResponse } from '@/lib/api-client';
import type {
  Vendor,
  PosmType,
  PosmDimensions,
  AdminUser,
  ManagedRole,
  Site,
  SiteListResult,
  SiteFilters,
  SiteStatus,
  BulkUploadResult,
} from './types';

// ── Vendors ──────────────────────────────────────────────────────────────────
export interface VendorCreate {
  code: string;
  name: string;
}
export interface VendorUpdate {
  code?: string;
  name?: string;
  isActive?: boolean;
}

export const vendorsApi = {
  list: () => api.get<Vendor[]>('/api/vendors'),
  create: (body: VendorCreate) => api.post<Vendor>('/api/vendors', body),
  update: (id: string, body: VendorUpdate) => api.patch<Vendor>(`/api/vendors/${id}`, body),
  /** Soft-deactivate (DELETE = isActive:false). */
  deactivate: (id: string) => api.del<Vendor>(`/api/vendors/${id}`),
  /** Reactivate a soft-deactivated vendor. */
  reactivate: (id: string) => api.patch<Vendor>(`/api/vendors/${id}`, { isActive: true }),
};

// ── POSM types ─────────────────────────────────────────────────────────────────
export interface PosmTypeCreate {
  code: string;
  name: string;
  defaultDimensions?: PosmDimensions;
}
export interface PosmTypeUpdate {
  code?: string;
  name?: string;
  defaultDimensions?: PosmDimensions;
  isActive?: boolean;
}

export const posmTypesApi = {
  list: () => api.get<PosmType[]>('/api/posm-types'),
  create: (body: PosmTypeCreate) => api.post<PosmType>('/api/posm-types', body),
  update: (id: string, body: PosmTypeUpdate) => api.patch<PosmType>(`/api/posm-types/${id}`, body),
  deactivate: (id: string) => api.del<PosmType>(`/api/posm-types/${id}`),
  reactivate: (id: string) => api.patch<PosmType>(`/api/posm-types/${id}`, { isActive: true }),
};

// ── Users ─────────────────────────────────────────────────────────────────────
export interface UserCreate {
  name: string;
  phone: string;
  role: ManagedRole;
  /** Required for VENDOR_* roles; must be absent otherwise. */
  vendorId?: string;
}
export interface UserUpdate {
  name?: string;
  phone?: string;
  role?: ManagedRole;
  /** A vendor id, or null to clear the link; undefined leaves it unchanged. */
  vendorId?: string | null;
  isActive?: boolean;
}

export const usersApi = {
  list: () => api.get<AdminUser[]>('/api/users'),
  create: (body: UserCreate) => api.post<AdminUser>('/api/users', body),
  update: (id: string, body: UserUpdate) => api.patch<AdminUser>(`/api/users/${id}`, body),
  /** Soft-deactivate + evict all live sessions (backend blocks self / last-admin). */
  deactivate: (id: string) => api.del<AdminUser>(`/api/users/${id}`),
  reactivate: (id: string) => api.patch<AdminUser>(`/api/users/${id}`, { isActive: true }),
};

// ── Sites ─────────────────────────────────────────────────────────────────────
export interface SiteCreate {
  code: string;
  name: string;
  phone?: string;
  lat?: number;
  lng?: number;
  town?: string;
  rsCode?: string;
  vendorId?: string;
  asmUserId?: string;
  status?: SiteStatus;
}
export interface SiteUpdate {
  code?: string;
  name?: string;
  phone?: string;
  lat?: number;
  lng?: number;
  town?: string;
  rsCode?: string;
  vendorId?: string;
  asmUserId?: string;
  status?: SiteStatus;
}

function siteQuery(filters: SiteFilters): string {
  const p = new URLSearchParams();
  if (filters.name) p.set('name', filters.name);
  if (filters.code) p.set('code', filters.code);
  if (filters.town) p.set('town', filters.town);
  if (filters.rsCode) p.set('rsCode', filters.rsCode);
  if (filters.vendorId) p.set('vendorId', filters.vendorId);
  p.set('page', String(filters.page ?? 1));
  p.set('limit', String(filters.limit ?? 200));
  return p.toString();
}

export const sitesApi = {
  list: (filters: SiteFilters = {}) => api.get<SiteListResult>(`/api/sites?${siteQuery(filters)}`),
  create: (body: SiteCreate) => api.post<Site>('/api/sites', body),
  update: (id: string, body: SiteUpdate) => api.patch<Site>(`/api/sites/${id}`, body),
  /** Soft-delete (status → INACTIVE). */
  deactivate: (id: string) => api.patch<Site>(`/api/sites/${id}/deactivate`, {}),
  /** Reactivate a soft-deleted site. */
  reactivate: (id: string) => api.patch<Site>(`/api/sites/${id}`, { status: 'ACTIVE' }),
  bulkUpload: (file: File) => bulkUploadSites(file),
};

/**
 * Excel bulk-upload — raw multipart POST. The field name MUST be `file` (matches the
 * backend FileInterceptor) and we deliberately do NOT set Content-Type: the browser adds
 * the correct multipart boundary automatically. Returns the same ApiResponse envelope the
 * rest of the client uses so pages branch on `.success` uniformly.
 */
export async function bulkUploadSites(file: File): Promise<ApiResponse<BulkUploadResult>> {
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch('/api/sites/bulk-upload', { method: 'POST', body: form });
    type Envelope = { success?: boolean; data?: BulkUploadResult; error?: string };
    let body: Envelope | null = null;
    try {
      body = (await res.json()) as Envelope;
    } catch {
      body = null;
    }
    if (!res.ok) {
      return {
        success: false,
        error: body?.error ?? res.statusText ?? 'Upload failed',
        status: res.status,
      };
    }
    if (body && typeof body.success === 'boolean') {
      return body as ApiResponse<BulkUploadResult>;
    }
    // Some envelopes return the payload directly — tolerate both shapes.
    if (body) return { success: true, data: body as unknown as BulkUploadResult };
    return { success: false, error: 'Empty response from server' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
