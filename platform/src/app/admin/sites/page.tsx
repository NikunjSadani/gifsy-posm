'use client';

/**
 * Sites master — search + filter (vendor / status) list, create + edit + deactivate, and an
 * Excel bulk-upload panel. A site is soft-deleted (status → INACTIVE), never hard-deleted.
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Plus, Pencil, Ban, RotateCcw, Search, ChevronLeft, ChevronRight, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/admin/data-table';
import { FormDialog } from '@/components/admin/form-dialog';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { StatusBadge } from '@/components/admin/status-badge';
import { UploadPanel } from '@/components/admin/upload-panel';
import { sitesApi, vendorsApi, usersApi, type SiteCreate, type SiteUpdate } from '@/lib/admin/api';
import { SITE_UPLOAD_HEADERS, SITE_UPLOAD_REQUIRED_HEADERS, type Site, type SiteStatus, type Vendor, type AdminUser } from '@/lib/admin/types';
import { validateSite, isValid, type FieldErrors } from '@/lib/admin/validation';
import { formatCoords } from '@/lib/admin/format';

type Editing = { mode: 'create' } | { mode: 'edit'; site: Site } | null;
type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

/** Server page size. The list is server-paginated so every row (any status, any page) is reachable. */
const PAGE_SIZE = 50;

const emptyForm = {
  code: '',
  name: '',
  phone: '',
  lat: '',
  lng: '',
  region: '',
  state: '',
  cluster: '',
  town: '',
  rsCode: '',
  rsName: '',
  beatName: '',
  channel: '',
  address: '',
  pincode: '',
  vendorId: '',
  asmUserId: '',
  gsbAllowed: false,
  status: 'ACTIVE' as SiteStatus,
};

export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [total, setTotal] = useState(0);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [asms, setAsms] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [page, setPage] = useState(1);

  // Stable id for label association on the (visually label-less) search box.
  const searchId = useId();

  const [editing, setEditing] = useState<Editing>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirm, setConfirm] = useState<Site | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Reference lists for the pickers + display maps (loaded once).
  const loadRefs = useCallback(async () => {
    const [vRes, uRes] = await Promise.all([vendorsApi.list(), usersApi.list()]);
    if (vRes.success) setVendors(vRes.data);
    if (uRes.success) setAsms(uRes.data.filter((u) => u.role === 'ASM'));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await sitesApi.list({
      name: search.trim() || undefined,
      vendorId: vendorFilter || undefined,
      // Status is filtered SERVER-SIDE so an inactive site on any page is reachable.
      status: statusFilter === 'ALL' ? undefined : statusFilter,
      page,
      limit: PAGE_SIZE,
    });
    if (res.success) {
      setSites(res.data.sites);
      setTotal(res.data.total);
      setLoadError(null);
    } else {
      setLoadError(res.error || 'Could not load outlets.');
      setSites([]);
      setTotal(0);
    }
    setLoading(false);
  }, [search, vendorFilter, statusFilter, page]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  // Any filter change returns to page 1 so the user never lands on an out-of-range page
  // (e.g. was on page 5, then a filter narrows the result to a single page).
  useEffect(() => {
    setPage(1);
  }, [search, vendorFilter, statusFilter]);

  // Debounce the search/filter/page-driven reload.
  useEffect(() => {
    const t = setTimeout(() => void load(), 300);
    return () => clearTimeout(t);
  }, [load]);

  const vendorName = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of vendors) m.set(v.id, `${v.name} (${v.code})`);
    return m;
  }, [vendors]);
  const asmName = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of asms) m.set(a.id, a.name);
    return m;
  }, [asms]);

  const activeVendorOptions = useMemo(
    () => vendors.filter((v) => v.isActive).map((v) => ({ value: v.id, label: `${v.name} (${v.code})` })),
    [vendors],
  );
  const asmOptions = useMemo(
    () => asms.filter((a) => a.isActive).map((a) => ({ value: a.id, label: a.name })),
    [asms],
  );
  const vendorFilterOptions = useMemo(
    () => [{ value: '', label: 'All vendors' }, ...vendors.map((v) => ({ value: v.id, label: `${v.name} (${v.code})` }))],
    [vendors],
  );

  // Rows are exactly what the server returned for this page — status is filtered server-side,
  // so there is no client-side single-page narrowing that could hide a match on another page.
  const rows = sites;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const openCreate = () => {
    setEditing({ mode: 'create' });
    setForm({ ...emptyForm });
    setFieldErrors({});
    setFormError(null);
  };
  const openEdit = (s: Site) => {
    setEditing({ mode: 'edit', site: s });
    setForm({
      code: s.code,
      name: s.name,
      phone: s.phone ?? '',
      lat: s.lat != null ? String(s.lat) : '',
      lng: s.lng != null ? String(s.lng) : '',
      region: s.region ?? '',
      state: s.state ?? '',
      cluster: s.cluster ?? '',
      town: s.town ?? '',
      rsCode: s.rsCode ?? '',
      rsName: s.rsName ?? '',
      beatName: s.beatName ?? '',
      channel: s.channel ?? '',
      address: s.address ?? '',
      pincode: s.pincode ?? '',
      vendorId: s.vendorId ?? '',
      asmUserId: s.asmUserId ?? '',
      gsbAllowed: s.gsbAllowed ?? false,
      status: s.status,
    });
    setFieldErrors({});
    setFormError(null);
  };

  const submit = async () => {
    const errs = validateSite(form);
    setFieldErrors(errs);
    if (!isValid(errs)) return;

    const hasCoords = form.lat.trim() !== '' && form.lng.trim() !== '';
    setSaving(true);
    setFormError(null);

    let res;
    if (editing?.mode === 'edit') {
      // On edit we send every field: an empty vendor/asm string disconnects the link.
      const body: SiteUpdate = {
        code: form.code.trim(),
        name: form.name.trim(),
        phone: form.phone.trim(),
        region: form.region.trim(),
        state: form.state.trim(),
        cluster: form.cluster.trim(),
        town: form.town.trim(),
        rsCode: form.rsCode.trim(),
        rsName: form.rsName.trim(),
        beatName: form.beatName.trim(),
        channel: form.channel.trim(),
        address: form.address.trim(),
        pincode: form.pincode.trim(),
        vendorId: form.vendorId,
        asmUserId: form.asmUserId,
        gsbAllowed: form.gsbAllowed,
        status: form.status,
      };
      if (hasCoords) {
        body.lat = Number(form.lat);
        body.lng = Number(form.lng);
      }
      res = await sitesApi.update(editing.site.id, body);
    } else {
      // On create, omit empty optional refs (an empty FK would be rejected).
      const body: SiteCreate = {
        code: form.code.trim(),
        name: form.name.trim(),
        status: form.status,
      };
      if (form.phone.trim()) body.phone = form.phone.trim();
      if (form.region.trim()) body.region = form.region.trim();
      if (form.state.trim()) body.state = form.state.trim();
      if (form.cluster.trim()) body.cluster = form.cluster.trim();
      if (form.town.trim()) body.town = form.town.trim();
      if (form.rsCode.trim()) body.rsCode = form.rsCode.trim();
      if (form.rsName.trim()) body.rsName = form.rsName.trim();
      if (form.beatName.trim()) body.beatName = form.beatName.trim();
      if (form.channel.trim()) body.channel = form.channel.trim();
      if (form.address.trim()) body.address = form.address.trim();
      if (form.pincode.trim()) body.pincode = form.pincode.trim();
      if (form.vendorId) body.vendorId = form.vendorId;
      if (form.asmUserId) body.asmUserId = form.asmUserId;
      // gsbAllowed is a boolean toggle (default false) — always send it explicitly.
      body.gsbAllowed = form.gsbAllowed;
      if (hasCoords) {
        body.lat = Number(form.lat);
        body.lng = Number(form.lng);
      }
      res = await sitesApi.create(body);
    }
    setSaving(false);
    if (!res.success) {
      setFormError(res.error || 'Could not save the outlet.');
      return;
    }
    toast.success(editing?.mode === 'edit' ? 'Outlet updated' : 'Outlet created');
    setEditing(null);
    void load();
  };

  const doDeactivate = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    setConfirmError(null);
    const res = await sitesApi.deactivate(confirm.id);
    setConfirmBusy(false);
    if (!res.success) {
      setConfirmError(res.error || 'Could not deactivate the outlet.');
      return;
    }
    toast.success('Outlet deactivated');
    setConfirm(null);
    void load();
  };

  const reactivate = async (s: Site) => {
    const res = await sitesApi.reactivate(s.id);
    if (!res.success) {
      toast.error(res.error || 'Could not reactivate the outlet.');
      return;
    }
    toast.success('Outlet reactivated');
    void load();
  };

  const columns: Column<Site>[] = [
    { key: 'code', header: 'Code', render: (s) => <span className="font-mono text-gray-900">{s.code}</span> },
    {
      key: 'name',
      header: 'Name',
      render: (s) => (
        <span className="flex items-center gap-1.5">
          <span className="font-medium text-gray-900">{s.name}</span>
          {s.gsbAllowed && (
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-[var(--brand-primary)] bg-[var(--brand-primary-light)]"
              title="GSB allowed at this outlet"
            >
              GSB
            </span>
          )}
        </span>
      ),
    },
    { key: 'town', header: 'Town', render: (s) => <span className="text-gray-600">{s.town || '—'}</span> },
    { key: 'vendor', header: 'Vendor', render: (s) => <span className="text-gray-600">{s.vendorId ? vendorName.get(s.vendorId) ?? '—' : '—'}</span> },
    { key: 'asm', header: 'ASM', render: (s) => <span className="text-gray-600">{s.asmUserId ? asmName.get(s.asmUserId) ?? '—' : '—'}</span> },
    { key: 'coords', header: 'Geotag', render: (s) => <span className="font-mono text-xs text-gray-500">{formatCoords(s)}</span> },
    { key: 'status', header: 'Status', render: (s) => <StatusBadge active={s.status === 'ACTIVE'} /> },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (s) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          {s.status === 'ACTIVE' ? (
            <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => { setConfirm(s); setConfirmError(null); }}>
              <Ban className="h-4 w-4" />
              Deactivate
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => reactivate(s)}>
              <RotateCcw className="h-4 w-4" />
              Reactivate
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Outlets</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Retail outlets your vendors service.{' '}
              {!loading && !loadError && <span className="text-gray-400">{total} total</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Jump to the full recce/installation report for these outlets (existing route). */}
            <Link
              href="/admin/execution-report"
              className="inline-flex items-center justify-center gap-1.5 font-medium transition-colors px-3 py-1.5 text-sm rounded-lg bg-transparent border border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Recce Report
            </Link>
            <Button variant="primary" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              New outlet
            </Button>
          </div>
        </div>

        {/* Search + filters */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 px-3 py-2 focus-within:border-[var(--brand-primary)] transition-colors flex-1 min-w-[200px] max-w-sm">
            <label htmlFor={searchId} className="sr-only">Search outlets by name</label>
            <Search className="h-4 w-4 text-gray-400 shrink-0" aria-hidden="true" />
            <input
              id={searchId}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name…"
              className="flex-1 text-sm text-gray-900 focus:outline-none bg-transparent"
            />
          </div>
          <div className="w-52">
            <Select
              aria-label="Filter by vendor"
              placeholder="All vendors"
              options={vendorFilterOptions}
              value={vendorFilter}
              onValueChange={setVendorFilter}
            />
          </div>
          <div className="w-40">
            <Select
              aria-label="Filter by status"
              placeholder="All statuses"
              options={[
                { value: 'ALL', label: 'All statuses' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INACTIVE', label: 'Inactive' },
              ]}
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as StatusFilter)}
            />
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(s) => s.id}
          loading={loading}
          error={loadError}
          emptyTitle={search || vendorFilter || statusFilter !== 'ALL' ? 'No matching outlets' : 'No outlets yet'}
          emptyDescription={
            search || vendorFilter || statusFilter !== 'ALL'
              ? 'Try a different search or filter.'
              : 'Create an outlet or bulk-upload from Excel below.'
          }
          rowClassName={(s) => (s.status === 'ACTIVE' ? undefined : 'opacity-60')}
        />

        {/* Server-side pagination */}
        {!loading && !loadError && total > PAGE_SIZE && (
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Showing {rows.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}
              –{(page - 1) * PAGE_SIZE + rows.length} of {total.toLocaleString()}
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 text-sm font-medium text-gray-700 disabled:text-gray-300 hover:text-gray-900"
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </button>
              <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="inline-flex items-center gap-1 text-sm font-medium text-gray-700 disabled:text-gray-300 hover:text-gray-900"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <UploadPanel
        title="Bulk upload outlets (Excel)"
        description={
          <>Upload an .xlsx / .xls file. Existing outlets (matched by <code className="text-xs">code</code>) are
          updated; new codes are created. Max 5 MB / 5000 rows per file.</>
        }
        headers={SITE_UPLOAD_HEADERS}
        requiredHeaders={SITE_UPLOAD_REQUIRED_HEADERS}
        hint={
          <>
            <code>vendor_code</code> resolves to a vendor and <code>asm_phone</code> to an ASM user in this
            tenant; <code>lat</code>/<code>lng</code> must be supplied together; <code>status</code> is ACTIVE or INACTIVE.
          </>
        }
        upload={sitesApi.bulkUpload}
        templateUrl="/api/sites/bulk-upload/template"
        templateFileName="outlet-upload-template.xlsx"
        onUploaded={() => void load()}
      />

      <FormDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing?.mode === 'edit' ? 'Edit outlet' : 'New outlet'}
        submitLabel={editing?.mode === 'edit' ? 'Save changes' : 'Create outlet'}
        loading={saving}
        error={formError}
        onSubmit={submit}
      >
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Code"
            placeholder="e.g. STORE-001"
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            error={fieldErrors.code}
            maxLength={100}
            autoFocus
          />
          <Input
            label="Name"
            placeholder="Outlet name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            error={fieldErrors.name}
            maxLength={200}
          />
          <Input
            label="Phone"
            placeholder="Contact phone"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            maxLength={20}
          />
          <Input
            label="Town"
            placeholder="Town"
            value={form.town}
            onChange={(e) => setForm((f) => ({ ...f, town: e.target.value }))}
            maxLength={120}
          />
          <Input
            label="Latitude"
            placeholder="-90 to 90"
            type="number"
            inputMode="decimal"
            value={form.lat}
            onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))}
            error={fieldErrors.lat}
          />
          <Input
            label="Longitude"
            placeholder="-180 to 180"
            type="number"
            inputMode="decimal"
            value={form.lng}
            onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))}
            error={fieldErrors.lng}
          />
          <Input
            label="RS code"
            placeholder="Retailer/route code"
            value={form.rsCode}
            onChange={(e) => setForm((f) => ({ ...f, rsCode: e.target.value }))}
            error={fieldErrors.rsCode}
            maxLength={60}
          />
          <Input
            label="RS name"
            placeholder="Retailer/distributor name"
            value={form.rsName}
            onChange={(e) => setForm((f) => ({ ...f, rsName: e.target.value }))}
            maxLength={160}
          />
          <Input
            label="Region"
            placeholder="Region"
            value={form.region}
            onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
            maxLength={120}
          />
          <Input
            label="State"
            placeholder="State"
            value={form.state}
            onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
            maxLength={120}
          />
          <Input
            label="Cluster"
            placeholder="Cluster"
            value={form.cluster}
            onChange={(e) => setForm((f) => ({ ...f, cluster: e.target.value }))}
            maxLength={120}
          />
          <Input
            label="Beat name"
            placeholder="Beat name"
            value={form.beatName}
            onChange={(e) => setForm((f) => ({ ...f, beatName: e.target.value }))}
            error={fieldErrors.beatName}
            maxLength={120}
          />
          <Input
            label="Channel"
            placeholder="e.g. GT / MT"
            value={form.channel}
            onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}
            maxLength={60}
          />
          <Input
            label="Address"
            placeholder="Street address"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            maxLength={300}
          />
          <Input
            label="Pincode"
            placeholder="Postal pincode"
            value={form.pincode}
            onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value }))}
            maxLength={20}
          />
          <Select
            label="GSB allowed at this outlet"
            options={[
              { value: 'false', label: 'No' },
              { value: 'true', label: 'Yes' },
            ]}
            value={form.gsbAllowed ? 'true' : 'false'}
            onValueChange={(v) => setForm((f) => ({ ...f, gsbAllowed: v === 'true' }))}
          />
          <Select
            label="Status"
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
            ]}
            value={form.status}
            onValueChange={(v) => setForm((f) => ({ ...f, status: v as SiteStatus }))}
          />
          <Select
            label="Vendor (optional)"
            placeholder="Unassigned"
            options={[{ value: '', label: 'Unassigned' }, ...activeVendorOptions]}
            value={form.vendorId}
            onValueChange={(v) => setForm((f) => ({ ...f, vendorId: v }))}
          />
          <Select
            label="ASM (optional)"
            placeholder="Unassigned"
            options={[{ value: '', label: 'Unassigned' }, ...asmOptions]}
            value={form.asmUserId}
            onValueChange={(v) => setForm((f) => ({ ...f, asmUserId: v }))}
          />
        </div>
      </FormDialog>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Deactivate outlet?"
        description={confirm ? `"${confirm.name}" (${confirm.code}) will be set to INACTIVE. You can reactivate it later.` : undefined}
        confirmLabel="Deactivate"
        loading={confirmBusy}
        error={confirmError}
        onConfirm={doDeactivate}
      />
    </div>
  );
}
