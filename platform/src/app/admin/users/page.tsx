'use client';

/**
 * Users master — list + create + edit + deactivate/reactivate.
 *
 * Roles: CLIENT_ADMIN · ASM · AUDITOR · VENDOR_HO · VENDOR_FIELD (GIFSY_ADMIN is not
 * provisionable here). The vendor picker shows ONLY for VENDOR_* roles (a vendor login must
 * be linked to a vendor; a non-vendor role must not). Deactivation is a soft-delete that
 * evicts sessions; the backend blocks deactivating yourself or the last active admin — those
 * refusals are surfaced in-dialog, never crash.
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Pencil, Ban, RotateCcw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/admin/data-table';
import { FormDialog } from '@/components/admin/form-dialog';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { StatusBadge } from '@/components/admin/status-badge';
import { usersApi, vendorsApi, type UserCreate, type UserUpdate } from '@/lib/admin/api';
import {
  MANAGED_ROLES,
  ROLE_LABELS,
  isVendorRole,
  type AdminUser,
  type ManagedRole,
  type Vendor,
} from '@/lib/admin/types';
import { validateUser, isValid, type FieldErrors } from '@/lib/admin/validation';
import { displayPhone } from '@/lib/admin/format';

type Editing = { mode: 'create' } | { mode: 'edit'; user: AdminUser } | null;

const emptyForm = { name: '', phone: '', role: '' as '' | ManagedRole, vendorId: '' };

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState<Editing>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirm, setConfirm] = useState<AdminUser | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const phoneId = useId();

  const load = useCallback(async () => {
    setLoading(true);
    const [uRes, vRes] = await Promise.all([usersApi.list(), vendorsApi.list()]);
    if (uRes.success) {
      setUsers(uRes.data);
      setLoadError(null);
    } else {
      setLoadError(uRes.error || 'Could not load users.');
    }
    if (vRes.success) setVendors(vRes.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const vendorName = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of vendors) m.set(v.id, `${v.name} (${v.code})`);
    return m;
  }, [vendors]);

  // The picker only offers ACTIVE vendors (the backend rejects an inactive vendor link).
  const vendorOptions = useMemo(
    () => vendors.filter((v) => v.isActive).map((v) => ({ value: v.id, label: `${v.name} (${v.code})` })),
    [vendors],
  );

  const roleOptions = MANAGED_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.phone.toLowerCase().includes(q) ||
        ROLE_LABELS[u.role]?.toLowerCase().includes(q),
    );
  }, [users, search]);

  const openCreate = () => {
    setEditing({ mode: 'create' });
    setForm({ ...emptyForm });
    setFieldErrors({});
    setFormError(null);
  };
  const openEdit = (u: AdminUser) => {
    setEditing({ mode: 'edit', user: u });
    // Stored phone is +91XXXXXXXXXX — show the bare 10 digits for editing.
    const bare = /^\+91(\d{10})$/.exec(u.phone)?.[1] ?? u.phone;
    setForm({ name: u.name, phone: bare, role: u.role, vendorId: u.vendorId ?? '' });
    setFieldErrors({});
    setFormError(null);
  };

  // When the role flips away from a vendor role, drop any stale vendorId selection.
  const onRoleChange = (role: string) => {
    setForm((f) => ({ ...f, role: role as ManagedRole, vendorId: isVendorRole(role) ? f.vendorId : '' }));
  };

  const submit = async () => {
    const errs = validateUser({ name: form.name, phone: form.phone, role: form.role, vendorId: form.vendorId });
    setFieldErrors(errs);
    if (!isValid(errs)) return;

    const role = form.role as ManagedRole;
    const vendorLinked = isVendorRole(role);
    setSaving(true);
    setFormError(null);

    let res;
    if (editing?.mode === 'edit') {
      const body: UserUpdate = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        role,
        // A vendor role sends its vendorId; a non-vendor role clears the link (null).
        vendorId: vendorLinked ? form.vendorId : null,
      };
      res = await usersApi.update(editing.user.id, body);
    } else {
      const body: UserCreate = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        role,
        ...(vendorLinked ? { vendorId: form.vendorId } : {}),
      };
      res = await usersApi.create(body);
    }
    setSaving(false);
    if (!res.success) {
      setFormError(res.error || 'Could not save the user.');
      return;
    }
    toast.success(editing?.mode === 'edit' ? 'User updated' : 'User created');
    setEditing(null);
    void load();
  };

  const doDeactivate = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    setConfirmError(null);
    const res = await usersApi.deactivate(confirm.id);
    setConfirmBusy(false);
    if (!res.success) {
      // Backend guard (self / last-admin lockout) — surface in place, don't close.
      setConfirmError(res.error || 'Could not deactivate the user.');
      return;
    }
    toast.success('User deactivated');
    setConfirm(null);
    void load();
  };

  const reactivate = async (u: AdminUser) => {
    const res = await usersApi.reactivate(u.id);
    if (!res.success) {
      toast.error(res.error || 'Could not reactivate the user.');
      return;
    }
    toast.success('User reactivated');
    void load();
  };

  const showVendorPicker = isVendorRole(form.role);

  const columns: Column<AdminUser>[] = [
    { key: 'name', header: 'Name', render: (u) => <span className="font-medium text-gray-900">{u.name}</span> },
    { key: 'phone', header: 'Phone', render: (u) => <span className="font-mono text-gray-700">{displayPhone(u.phone)}</span> },
    { key: 'role', header: 'Role', render: (u) => <Badge variant="info">{ROLE_LABELS[u.role] ?? u.role}</Badge> },
    {
      key: 'vendor',
      header: 'Vendor',
      render: (u) => <span className="text-gray-600">{u.vendorId ? vendorName.get(u.vendorId) ?? '—' : '—'}</span>,
    },
    { key: 'status', header: 'Status', render: (u) => <StatusBadge active={u.isActive} /> },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (u) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          {u.isActive ? (
            <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => { setConfirm(u); setConfirmError(null); }}>
              <Ban className="h-4 w-4" />
              Deactivate
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => reactivate(u)}>
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
          <h1 className="text-xl font-bold text-gray-900">Users</h1>
          <p className="text-sm text-gray-500 mt-0.5">Admins, ASMs, auditors and vendor logins.</p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          New user
        </Button>
      </div>

      <div className="mb-4 max-w-sm">
        <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 px-3 py-2 focus-within:border-[var(--brand-primary)] transition-colors">
          <Search className="h-4 w-4 text-gray-400 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone or role…"
            className="flex-1 text-sm text-gray-900 focus:outline-none bg-transparent"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(u) => u.id}
        loading={loading}
        error={loadError}
        emptyTitle={search ? 'No matching users' : 'No users yet'}
        emptyDescription={search ? 'Try a different search.' : 'Create your first user to get started.'}
        rowClassName={(u) => (u.isActive ? undefined : 'opacity-60')}
      />

      <FormDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing?.mode === 'edit' ? 'Edit user' : 'New user'}
        submitLabel={editing?.mode === 'edit' ? 'Save changes' : 'Create user'}
        loading={saving}
        error={formError}
        onSubmit={submit}
      >
        <Input
          label="Name"
          placeholder="Full name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          error={fieldErrors.name}
          maxLength={120}
          autoFocus
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={phoneId} className="text-sm font-medium text-gray-700">Mobile number</label>
          <div className="flex items-stretch rounded-lg border border-gray-300 focus-within:border-[var(--brand-primary)] overflow-hidden">
            <span className="flex items-center px-3 text-gray-500 bg-gray-50 text-sm font-medium border-r border-gray-200">+91</span>
            <input
              id={phoneId}
              type="tel"
              inputMode="numeric"
              maxLength={10}
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
              placeholder="10-digit mobile"
              className="flex-1 px-3 py-2.5 text-sm text-gray-900 focus:outline-none"
            />
          </div>
          {fieldErrors.phone && <p className="text-xs text-red-600">{fieldErrors.phone}</p>}
        </div>
        <Select
          label="Role"
          placeholder="Select a role"
          options={roleOptions}
          value={form.role || undefined}
          onValueChange={onRoleChange}
          error={fieldErrors.role}
        />
        {showVendorPicker && (
          <Select
            label="Vendor"
            placeholder={vendorOptions.length ? 'Select a vendor' : 'No active vendors — create one first'}
            options={vendorOptions}
            value={form.vendorId || undefined}
            onValueChange={(v) => setForm((f) => ({ ...f, vendorId: v }))}
            error={fieldErrors.vendorId}
          />
        )}
      </FormDialog>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Deactivate user?"
        description={confirm ? `"${confirm.name}" will be signed out immediately and blocked from logging in. You can reactivate them later.` : undefined}
        confirmLabel="Deactivate"
        loading={confirmBusy}
        error={confirmError}
        onConfirm={doDeactivate}
      />
    </div>
  );
}
