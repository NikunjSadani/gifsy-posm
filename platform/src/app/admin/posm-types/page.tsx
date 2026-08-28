'use client';

/**
 * POSM Types master — list (with search) + create + edit + deactivate/reactivate.
 * Optional default dimensions {width,height,unit} pre-fill a rep's capture form.
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
import { posmTypesApi, type PosmTypeCreate, type PosmTypeUpdate } from '@/lib/admin/api';
import type { PosmType } from '@/lib/admin/types';
import { validatePosmType, isValid, type FieldErrors } from '@/lib/admin/validation';

type Editing = { mode: 'create' } | { mode: 'edit'; posmType: PosmType } | null;

const emptyForm = { code: '', name: '', width: '', height: '', unit: '' };

export default function PosmTypesPage() {
  const [items, setItems] = useState<PosmType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState<Editing>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirm, setConfirm] = useState<PosmType | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await posmTypesApi.list();
    if (res.success) {
      setItems(res.data);
      setLoadError(null);
    } else {
      setLoadError(res.error || 'Could not load POSM types.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((p) => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
  }, [items, search]);

  const openCreate = () => {
    setEditing({ mode: 'create' });
    setForm({ ...emptyForm });
    setFieldErrors({});
    setFormError(null);
  };
  const openEdit = (p: PosmType) => {
    setEditing({ mode: 'edit', posmType: p });
    setForm({
      code: p.code,
      name: p.name,
      width: p.defaultDimensions?.width != null ? String(p.defaultDimensions.width) : '',
      height: p.defaultDimensions?.height != null ? String(p.defaultDimensions.height) : '',
      unit: p.defaultDimensions?.unit ?? '',
    });
    setFieldErrors({});
    setFormError(null);
  };

  const submit = async () => {
    const errs = validatePosmType(form);
    setFieldErrors(errs);
    if (!isValid(errs)) return;

    const hasDims = form.width.trim() !== '' && form.height.trim() !== '' && form.unit.trim() !== '';
    const dims = hasDims
      ? { width: Number(form.width), height: Number(form.height), unit: form.unit.trim() }
      : undefined;

    const base = { code: form.code.trim(), name: form.name.trim() };
    setSaving(true);
    setFormError(null);
    let res;
    if (editing?.mode === 'edit') {
      const body: PosmTypeUpdate = { ...base };
      if (dims) body.defaultDimensions = dims;
      res = await posmTypesApi.update(editing.posmType.id, body);
    } else {
      const body: PosmTypeCreate = { ...base };
      if (dims) body.defaultDimensions = dims;
      res = await posmTypesApi.create(body);
    }
    setSaving(false);
    if (!res.success) {
      setFormError(res.error || 'Could not save the POSM type.');
      return;
    }
    toast.success(editing?.mode === 'edit' ? 'POSM type updated' : 'POSM type created');
    setEditing(null);
    void load();
  };

  const doDeactivate = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    setConfirmError(null);
    const res = await posmTypesApi.deactivate(confirm.id);
    setConfirmBusy(false);
    if (!res.success) {
      setConfirmError(res.error || 'Could not deactivate the POSM type.');
      return;
    }
    toast.success('POSM type deactivated');
    setConfirm(null);
    void load();
  };

  const reactivate = async (p: PosmType) => {
    const res = await posmTypesApi.reactivate(p.id);
    if (!res.success) {
      toast.error(res.error || 'Could not reactivate the POSM type.');
      return;
    }
    toast.success('POSM type reactivated');
    void load();
  };

  const dimsLabel = (p: PosmType) =>
    p.defaultDimensions
      ? `${p.defaultDimensions.width} × ${p.defaultDimensions.height} ${p.defaultDimensions.unit}`
      : '—';

  const columns: Column<PosmType>[] = [
    { key: 'code', header: 'Code', render: (p) => <span className="font-mono text-gray-900">{p.code}</span> },
    { key: 'name', header: 'Name', render: (p) => <span className="font-medium text-gray-900">{p.name}</span> },
    { key: 'dims', header: 'Default dimensions', render: (p) => <span className="text-gray-600">{dimsLabel(p)}</span> },
    { key: 'status', header: 'Status', render: (p) => <StatusBadge active={p.isActive} /> },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (p) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          {p.isActive ? (
            <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => { setConfirm(p); setConfirmError(null); }}>
              <Ban className="h-4 w-4" />
              Deactivate
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => reactivate(p)}>
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
          <h1 className="text-xl font-bold text-gray-900">POSM Types</h1>
          <p className="text-sm text-gray-500 mt-0.5">The point-of-sale material catalogue reps capture against.</p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          New POSM type
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
        rowKey={(p) => p.id}
        loading={loading}
        error={loadError}
        emptyTitle={search ? 'No matching POSM types' : 'No POSM types yet'}
        emptyDescription={search ? 'Try a different search.' : 'Create your first POSM type to get started.'}
        rowClassName={(p) => (p.isActive ? undefined : 'opacity-60')}
      />

      <FormDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing?.mode === 'edit' ? 'Edit POSM type' : 'New POSM type'}
        submitLabel={editing?.mode === 'edit' ? 'Save changes' : 'Create POSM type'}
        loading={saving}
        error={formError}
        onSubmit={submit}
      >
        <Input
          label="Code"
          placeholder="e.g. GLOW-BOARD"
          value={form.code}
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
          error={fieldErrors.code}
          maxLength={50}
          autoFocus
        />
        <Input
          label="Name"
          placeholder="POSM name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          error={fieldErrors.name}
          maxLength={160}
        />
        <div>
          <p className="text-sm font-medium text-gray-700 mb-1.5">Default dimensions <span className="font-normal text-gray-400">(optional)</span></p>
          <div className="grid grid-cols-3 gap-2">
            <Input
              placeholder="Width"
              type="number"
              inputMode="decimal"
              value={form.width}
              onChange={(e) => setForm((f) => ({ ...f, width: e.target.value }))}
              error={fieldErrors.width}
            />
            <Input
              placeholder="Height"
              type="number"
              inputMode="decimal"
              value={form.height}
              onChange={(e) => setForm((f) => ({ ...f, height: e.target.value }))}
              error={fieldErrors.height}
            />
            <Input
              placeholder="Unit (e.g. cm)"
              value={form.unit}
              onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
              error={fieldErrors.unit}
              maxLength={16}
            />
          </div>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Deactivate POSM type?"
        description={confirm ? `"${confirm.name}" (${confirm.code}) will be hidden from new captures. You can reactivate it later.` : undefined}
        confirmLabel="Deactivate"
        loading={confirmBusy}
        error={confirmError}
        onConfirm={doDeactivate}
      />
    </div>
  );
}
