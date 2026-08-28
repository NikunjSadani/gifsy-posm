'use client';

/**
 * Sites master — search + filter (vendor / status) list, create + edit + deactivate, and an
 * Excel bulk-upload panel. A site is soft-deleted (status → INACTIVE), never hard-deleted.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Pencil, Ban, RotateCcw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/admin/data-table';
import { FormDialog } from '@/components/admin/form-dialog';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { StatusBadge } from '@/components/admin/status-badge';
import { UploadPanel } from '@/components/admin/upload-panel';
import { sitesApi, vendorsApi, usersApi, type SiteCreate, type SiteUpdate } from '@/lib/admin/api';
import type { Site, SiteStatus, Vendor, AdminUser } from '@/lib/admin/types';
import { validateSite, isValid, type FieldErrors } from '@/lib/admin/validation';
import { formatCoords } from '@/lib/admin/format';

type Editing = { mode: 'create' } | { mode: 'edit'; site: Site } | null;
type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

const emptyForm = {
  code: '',
  name: '',
  phone: '',
  lat: '',
  lng: '',
  town: '',
  rsCode: '',
  vendorId: '',
  asmUserId: '',
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
      limit: 200,
    });
    if (res.success) {
      setSites(res.data.sites);
      setTotal(res.data.total);
      setLoadError(null);
    } else {
      setLoadError(res.error || 'Could not load sites.');
      setSites([]);
      setTotal(0);
    }
    setLoading(false);
  }, [search, vendorFilter]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  // Debounce the search/filter-driven reload.
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

  // Status is filtered client-side (the list endpoint has no status param).
  const rows = useMemo(
    () => (statusFilter === 'ALL' ? sites : sites.filter((s) => s.status === statusFilter)),
    [sites, statusFilter],
  );

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
      town: s.town ?? '',
      rsCode: s.rsCode ?? '',
      vendorId: s.vendorId ?? '',
      asmUserId: s.asmUserId ?? '',
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
        town: form.town.trim(),
        rsCode: form.rsCode.trim(),
        vendorId: form.vendorId,
        asmUserId: form.asmUserId,
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
      if (form.town.trim()) body.town = form.town.trim();
      if (form.rsCode.trim()) body.rsCode = form.rsCode.trim();
      if (form.vendorId) body.vendorId = form.vendorId;
      if (form.asmUserId) body.asmUserId = form.asmUserId;
      if (hasCoords) {
        body.lat = Number(form.lat);
        body.lng = Number(form.lng);
      }
      res = await sitesApi.create(body);
    }
    setSaving(false);
    if (!res.success) {
      setFormError(res.error || 'Could not save the site.');
      return;
    }
    toast.success(editing?.mode === 'edit' ? 'Site updated' : 'Site created');
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
      setConfirmError(res.error || 'Could not deactivate the site.');
      return;
    }
    toast.success('Site deactivated');
    setConfirm(null);
    void load();
  };

  const reactivate = async (s: Site) => {
    const res = await sitesApi.reactivate(s.id);
    if (!res.success) {
      toast.error(res.error || 'Could not reactivate the site.');
      return;
    }
    toast.success('Site reactivated');
    void load();
  };

  const columns: Column<Site>[] = [
    { key: 'code', header: 'Code', render: (s) => <span className="font-mono text-gray-900">{s.code}</span> },
    { key: 'name', header: 'Name', render: (s) => <span className="font-medium text-gray-900">{s.name}</span> },
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
            <h1 className="text-xl font-bold text-gray-900">Sites</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Retail outlets your vendors service.{' '}
              {!loading && !loadError && <span className="text-gray-400">{total} total</span>}
            </p>
          </div>
          <Button variant="primary" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            New site
          </Button>
        </div>

        {/* Search + filters */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 px-3 py-2 focus-within:border-[var(--brand-primary)] transition-colors flex-1 min-w-[200px] max-w-sm">
            <Search className="h-4 w-4 text-gray-400 shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name…"
              className="flex-1 text-sm text-gray-900 focus:outline-none bg-transparent"
            />
          </div>
          <div className="w-52">
            <Select
              placeholder="All vendors"
              options={vendorFilterOptions}
              value={vendorFilter}
              onValueChange={setVendorFilter}
            />
          </div>
          <div className="w-40">
            <Select
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
          emptyTitle={search || vendorFilter || statusFilter !== 'ALL' ? 'No matching sites' : 'No sites yet'}
          emptyDescription={
            search || vendorFilter || statusFilter !== 'ALL'
              ? 'Try a different search or filter.'
              : 'Create a site or bulk-upload from Excel below.'
          }
          rowClassName={(s) => (s.status === 'ACTIVE' ? undefined : 'opacity-60')}
        />
      </div>

      <UploadPanel onUploaded={() => void load()} />

      <FormDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing?.mode === 'edit' ? 'Edit site' : 'New site'}
        submitLabel={editing?.mode === 'edit' ? 'Save changes' : 'Create site'}
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
            maxLength={60}
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
        title="Deactivate site?"
        description={confirm ? `"${confirm.name}" (${confirm.code}) will be set to INACTIVE. You can reactivate it later.` : undefined}
        confirmLabel="Deactivate"
        loading={confirmBusy}
        error={confirmError}
        onConfirm={doDeactivate}
      />
    </div>
  );
}
