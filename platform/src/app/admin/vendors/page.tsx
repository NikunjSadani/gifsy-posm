'use client';

/**
 * Vendors master — list (with search) + create + edit + deactivate/reactivate.
 * A vendor is soft-deactivated (never hard-deleted) so audit history + FK integrity survive.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Pencil, Ban, RotateCcw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable, type Column } from '@/components/admin/data-table';
import { FormDialog } from '@/components/admin/form-dialog';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { StatusBadge } from '@/components/admin/status-badge';
import { vendorsApi } from '@/lib/admin/api';
import type { Vendor } from '@/lib/admin/types';
import { validateVendor, isValid, type FieldErrors } from '@/lib/admin/validation';

type Editing = { mode: 'create' } | { mode: 'edit'; vendor: Vendor } | null;

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState<Editing>(null);
  const [form, setForm] = useState({ code: '', name: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirm, setConfirm] = useState<Vendor | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await vendorsApi.list();
    if (res.success) {
      setVendors(res.data);
      setLoadError(null);
    } else {
      setLoadError(res.error || 'Could not load vendors.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(
      (v) => v.code.toLowerCase().includes(q) || v.name.toLowerCase().includes(q),
    );
  }, [vendors, search]);

  const openCreate = () => {
    setEditing({ mode: 'create' });
    setForm({ code: '', name: '' });
    setFieldErrors({});
    setFormError(null);
  };
  const openEdit = (v: Vendor) => {
    setEditing({ mode: 'edit', vendor: v });
    setForm({ code: v.code, name: v.name });
    setFieldErrors({});
    setFormError(null);
  };

  const submit = async () => {
    const errs = validateVendor(form);
    setFieldErrors(errs);
    if (!isValid(errs)) return;
    setSaving(true);
    setFormError(null);
    const res =
      editing?.mode === 'edit'
        ? await vendorsApi.update(editing.vendor.id, { code: form.code.trim(), name: form.name.trim() })
        : await vendorsApi.create({ code: form.code.trim(), name: form.name.trim() });
    setSaving(false);
    if (!res.success) {
      setFormError(res.error || 'Could not save the vendor.');
      return;
    }
    toast.success(editing?.mode === 'edit' ? 'Vendor updated' : 'Vendor created');
    setEditing(null);
    void load();
  };

  const doDeactivate = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    setConfirmError(null);
    const res = await vendorsApi.deactivate(confirm.id);
    setConfirmBusy(false);
    if (!res.success) {
      setConfirmError(res.error || 'Could not deactivate the vendor.');
      return;
    }
    toast.success('Vendor deactivated');
    setConfirm(null);
    void load();
  };

  const reactivate = async (v: Vendor) => {
    const res = await vendorsApi.reactivate(v.id);
    if (!res.success) {
      toast.error(res.error || 'Could not reactivate the vendor.');
      return;
    }
    toast.success('Vendor reactivated');
    void load();
  };

  const columns: Column<Vendor>[] = [
    { key: 'code', header: 'Code', render: (v) => <span className="font-mono text-gray-900">{v.code}</span> },
    { key: 'name', header: 'Name', render: (v) => <span className="font-medium text-gray-900">{v.name}</span> },
    { key: 'status', header: 'Status', render: (v) => <StatusBadge active={v.isActive} /> },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (v) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => openEdit(v)}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          {v.isActive ? (
            <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => { setConfirm(v); setConfirmError(null); }}>
              <Ban className="h-4 w-4" />
              Deactivate
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => reactivate(v)}>
              <RotateCcw className="h-4 w-4" />
              Reactivate
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Vendors</h1>
          <p className="text-sm text-gray-500 mt-0.5">Fleets that service your sites.</p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          New vendor
        </Button>
      </div>

      <div className="mb-4 max-w-sm">
        <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 px-3 py-2 focus-within:border-[var(--brand-primary)] transition-colors">
          <Search className="h-4 w-4 text-gray-400 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code or name…"
            className="flex-1 text-sm text-gray-900 focus:outline-none bg-transparent"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(v) => v.id}
        loading={loading}
        error={loadError}
        emptyTitle={search ? 'No matching vendors' : 'No vendors yet'}
        emptyDescription={search ? 'Try a different search.' : 'Create your first vendor to get started.'}
        rowClassName={(v) => (v.isActive ? undefined : 'opacity-60')}
      />

      <FormDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing?.mode === 'edit' ? 'Edit vendor' : 'New vendor'}
        submitLabel={editing?.mode === 'edit' ? 'Save changes' : 'Create vendor'}
        loading={saving}
        error={formError}
        onSubmit={submit}
      >
        <Input
          label="Code"
          placeholder="e.g. VEN-01"
          value={form.code}
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
          error={fieldErrors.code}
          maxLength={50}
          autoFocus
        />
        <Input
          label="Name"
          placeholder="Vendor name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          error={fieldErrors.name}
          maxLength={160}
        />
      </FormDialog>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Deactivate vendor?"
        description={confirm ? `"${confirm.name}" (${confirm.code}) will be hidden from new assignments. You can reactivate it later.` : undefined}
        confirmLabel="Deactivate"
        loading={confirmBusy}
        error={confirmError}
        onConfirm={doDeactivate}
      />
    </div>
  );
}
