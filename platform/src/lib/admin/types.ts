/* ─── Admin masters — shared domain types ────────────────────────────────────
   Mirror the backend entity shapes returned by the /v1 masters endpoints
   (see api/src/{vendors,users,posm-types,sites}). Decimal columns (site lat/lng)
   serialise to JSON *strings*, so those fields are `string | number | null`.
─────────────────────────────────────────────────────────────────────────────── */

/** Roles a tenant admin may provision (GIFSY_ADMIN is intentionally NOT provisionable). */
export const MANAGED_ROLES = [
  'CLIENT_ADMIN',
  'ASM',
  'AUDITOR',
  'VENDOR_HO',
  'VENDOR_FIELD',
] as const;
export type ManagedRole = (typeof MANAGED_ROLES)[number];

/** The two roles that MUST carry a vendorId (and only these). */
export const VENDOR_ROLES: readonly ManagedRole[] = ['VENDOR_FIELD', 'VENDOR_HO'];

export function isVendorRole(role: string): boolean {
  return role === 'VENDOR_FIELD' || role === 'VENDOR_HO';
}

/** Human labels for the role picker. */
export const ROLE_LABELS: Record<ManagedRole, string> = {
  CLIENT_ADMIN: 'Client Admin',
  ASM: 'ASM (Area Sales Manager)',
  AUDITOR: 'Auditor',
  VENDOR_HO: 'Vendor — Head Office',
  VENDOR_FIELD: 'Vendor — Field',
};

export interface Vendor {
  id: string;
  clientId: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PosmDimensions {
  width: number;
  height: number;
  unit: string;
}

export interface PosmType {
  id: string;
  clientId: string;
  code: string;
  name: string;
  defaultDimensions?: PosmDimensions | null;
  /** Reference-photo media key for the field catalogue (view via /api/media/view?key=). */
  imageKey?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUser {
  id: string;
  clientId: string;
  phone: string | null;
  name: string;
  role: ManagedRole;
  email: string | null;
  vendorId: string | null;
  promoterCode: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SiteStatus = 'ACTIVE' | 'INACTIVE';

export interface Site {
  id: string;
  clientId?: string;
  code: string;
  name: string;
  phone: string | null;
  /** Prisma Decimal → serialised as a string over JSON; may also be null. */
  lat: string | number | null;
  lng: string | number | null;
  region: string | null;
  state: string | null;
  cluster: string | null;
  town: string | null;
  rsCode: string | null;
  beatName: string | null;
  channel: string | null;
  address: string | null;
  vendorId: string | null;
  asmUserId: string | null;
  status: SiteStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface SiteListResult {
  sites: Site[];
  total: number;
  page: number;
  limit: number;
}

export interface SiteFilters {
  name?: string;
  code?: string;
  town?: string;
  rsCode?: string;
  vendorId?: string;
  /** Server-side status filter; omit for all statuses. */
  status?: SiteStatus;
  page?: number;
  limit?: number;
}

/** POST /v1/sites/bulk-upload response. */
export interface BulkUploadResult {
  batchId: string;
  rowCount: number;
  successCount: number;
  errorCount: number;
  /** base64 .xlsx rejection report; null when every row succeeded. */
  errorFileBase64: string | null;
}

/** The bulk-upload template columns (first row of the .xlsx). Mirrors api SITE_UPLOAD_HEADERS. */
export const SITE_UPLOAD_HEADERS = [
  'code',
  'name',
  'phone',
  'lat',
  'lng',
  'region',
  'state',
  'cluster',
  'town',
  'rs_code',
  'beat_name',
  'channel',
  'address',
  'vendor_code',
  'asm_phone',
  'status',
] as const;

/** The user bulk-upload template columns. Mirrors api USER_UPLOAD_HEADERS. */
export const USER_UPLOAD_HEADERS = [
  'email',
  'name',
  'role',
  'phone',
  'vendor_code',
  'promoter_code',
  'password',
] as const;
export const USER_UPLOAD_REQUIRED_HEADERS = ['email', 'name', 'role'] as const;

export const SITE_UPLOAD_REQUIRED_HEADERS = ['code', 'name'] as const;
