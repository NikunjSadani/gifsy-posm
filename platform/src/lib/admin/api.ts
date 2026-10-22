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
  /** Reference-photo media key (from /api/media/upload); '' clears it. */
  imageKey?: string;
}
export interface PosmTypeUpdate {
  code?: string;
  name?: string;
  defaultDimensions?: PosmDimensions;
  /** Reference-photo media key (from /api/media/upload); '' clears it. */
  imageKey?: string;
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
  /** Login id — required, unique per tenant. */
  email: string;
  /** Optional at create — when omitted the login can't sign in until an admin sets one. */
  password?: string;
  /** Optional contact number (no longer the login id). */
  phone?: string;
  role: ManagedRole;
  /** Required for VENDOR_* roles; must be absent otherwise. */
  vendorId?: string;
  /** Optional promoter/employee code (report "Promoter ID"); unique per tenant when set. */
  promoterCode?: string;
}
export interface UserUpdate {
  name?: string;
  /** Re-assign the login email. */
  email?: string;
  /** Admin password reset; undefined leaves it unchanged. */
  password?: string;
  phone?: string;
  role?: ManagedRole;
  /** A vendor id, or null to clear the link; undefined leaves it unchanged. */
  vendorId?: string | null;
  /** Promoter code; "" clears it; undefined leaves it unchanged. */
  promoterCode?: string;
  isActive?: boolean;
}

export const usersApi = {
  list: () => api.get<AdminUser[]>('/api/users'),
  create: (body: UserCreate) => api.post<AdminUser>('/api/users', body),
  update: (id: string, body: UserUpdate) => api.patch<AdminUser>(`/api/users/${id}`, body),
  /** Soft-deactivate + evict all live sessions (backend blocks self / last-admin). */
  deactivate: (id: string) => api.del<AdminUser>(`/api/users/${id}`),
  reactivate: (id: string) => api.patch<AdminUser>(`/api/users/${id}`, { isActive: true }),
  bulkUpload: (file: File) => bulkUploadUsers(file),
};

// ── Sites ─────────────────────────────────────────────────────────────────────
export interface SiteCreate {
  code: string;
  name: string;
  phone?: string;
  lat?: number;
  lng?: number;
  region?: string;
  state?: string;
  cluster?: string;
  town?: string;
  rsCode?: string;
  rsName?: string;
  beatName?: string;
  channel?: string;
  address?: string;
  pincode?: string;
  vendorId?: string;
  asmUserId?: string;
  gsbAllowed?: boolean;
  status?: SiteStatus;
}
export interface SiteUpdate {
  code?: string;
  name?: string;
  phone?: string;
  lat?: number;
  lng?: number;
  region?: string;
  state?: string;
  cluster?: string;
  town?: string;
  rsCode?: string;
  rsName?: string;
  beatName?: string;
  channel?: string;
  address?: string;
  pincode?: string;
  vendorId?: string;
  asmUserId?: string;
  gsbAllowed?: boolean;
  status?: SiteStatus;
}

function siteQuery(filters: SiteFilters): string {
  const p = new URLSearchParams();
  if (filters.name) p.set('name', filters.name);
  if (filters.code) p.set('code', filters.code);
  if (filters.town) p.set('town', filters.town);
  if (filters.rsCode) p.set('rsCode', filters.rsCode);
  if (filters.vendorId) p.set('vendorId', filters.vendorId);
  if (filters.status) p.set('status', filters.status);
  p.set('page', String(filters.page ?? 1));
  p.set('limit', String(filters.limit ?? 50));
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
export function bulkUploadSites(file: File): Promise<ApiResponse<BulkUploadResult>> {
  return bulkUploadFile('/api/sites/bulk-upload', file);
}

/** Bulk-upload users (same multipart contract as sites). */
export function bulkUploadUsers(file: File): Promise<ApiResponse<BulkUploadResult>> {
  return bulkUploadFile('/api/users/bulk-upload', file);
}

async function bulkUploadFile(endpoint: string, file: File): Promise<ApiResponse<BulkUploadResult>> {
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch(endpoint, { method: 'POST', body: form });
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
