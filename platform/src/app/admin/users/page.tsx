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
import { BulkActionPanel } from '@/components/admin/bulk-action-panel';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';
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

const emptyForm = { name: '', email: '', password: '', phone: '', role: '' as '' | ManagedRole, vendorId: '', promoterCode: '' };

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

  const [bulkDeactivateOpen, setBulkDeactivateOpen] = useState(false);
  const [createTab, setCreateTab] = useState<'single' | 'bulk'>('single');

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
        (u.email ?? '').toLowerCase().includes(q) ||
        (u.phone ?? '').toLowerCase().includes(q) ||
        ROLE_LABELS[u.role]?.toLowerCase().includes(q),
    );
  }, [users, search]);

  const openCreate = () => {
    setEditing({ mode: 'create' });
    setForm({ ...emptyForm });
    setFieldErrors({});
    setFormError(null);
    setCreateTab('single');
  };
  const openEdit = (u: AdminUser) => {
    setEditing({ mode: 'edit', user: u });
    // Stored phone is +91XXXXXXXXXX — show the bare 10 digits for editing (may be absent now).
    const bare = u.phone ? (/^\+91(\d{10})$/.exec(u.phone)?.[1] ?? u.phone) : '';
    // Password is never shown; a blank field on edit leaves the current password unchanged.
    setForm({ name: u.name, email: u.email ?? '', password: '', phone: bare, role: u.role, vendorId: u.vendorId ?? '', promoterCode: u.promoterCode ?? '' });
    setFieldErrors({});
    setFormError(null);
  };

  // When the role flips away from a vendor role, drop any stale vendorId + promoter code (a
  // promoter code is a field-user identifier — it only applies to vendor logins).
  const onRoleChange = (role: string) => {
    setForm((f) => ({
      ...f,
      role: role as ManagedRole,
      vendorId: isVendorRole(role) ? f.vendorId : '',
      promoterCode: isVendorRole(role) ? f.promoterCode : '',
    }));
  };

  const submit = async () => {
    const isEdit = editing?.mode === 'edit';
    const errs = validateUser({
      name: form.name, email: form.email, password: form.password,
      phone: form.phone, role: form.role, vendorId: form.vendorId, isEdit,
    });
    setFieldErrors(errs);
    if (!isValid(errs)) return;

    const role = form.role as ManagedRole;
    const vendorLinked = isVendorRole(role);
    const pw = form.password.trim();
    setSaving(true);
    setFormError(null);

    let res;
    if (isEdit) {
      const body: UserUpdate = {
        name: form.name.trim(),
        email: form.email.trim(),
        // Optional contact; "" clears it.
        phone: form.phone.trim(),
        role,
        // A vendor role sends its vendorId; a non-vendor role clears the link (null).
        vendorId: vendorLinked ? form.vendorId : null,
        // Send the promoter code for vendor logins; a non-vendor role sends "" to clear it.
        promoterCode: vendorLinked ? form.promoterCode.trim() : '',
        // Only send a password when the admin typed a new one (blank = keep current).
        ...(pw ? { password: pw } : {}),
      };
      res = await usersApi.update(editing!.user.id, body);
    } else {
      const body: UserCreate = {
        name: form.name.trim(),
        email: form.email.trim(),
        role,
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        ...(pw ? { password: pw } : {}),
        ...(vendorLinked ? { vendorId: form.vendorId } : {}),
        ...(vendorLinked && form.promoterCode.trim() ? { promoterCode: form.promoterCode.trim() } : {}),
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
    { key: 'email', header: 'Email', render: (u) => <span className="text-gray-700">{u.email || '—'}</span> },
    { key: 'phone', header: 'Phone', render: (u) => <span className="font-mono text-gray-700">{u.phone ? displayPhone(u.phone) : '—'}</span> },
    { key: 'role', header: 'Role', render: (u) => <Badge variant="info">{ROLE_LABELS[u.role] ?? u.role}</Badge> },
    {
      key: 'vendor',
      header: 'Vendor',
      render: (u) => <span className="text-gray-600">{u.vendorId ? vendorName.get(u.vendorId) ?? '—' : '—'}</span>,
    },
    {
      key: 'promoterCode',
      header: 'Promoter code',
      render: (u) => <span className="font-mono text-gray-600">{u.promoterCode || '—'}</span>,
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

  // Shared field grid for the create (Single entry tab) and edit dialogs.
  const userFields = (
    <>
      <Input
        label="Name"
        placeholder="Full name"
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        error={fieldErrors.name}
        maxLength={120}
        autoFocus
      />
      <Input
        label="Email"
        type="email"
        placeholder="login email (unique)"
        value={form.email}
        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        error={fieldErrors.email}
        maxLength={254}
      />
      <Input
        label={editing?.mode === 'edit' ? 'Password (leave blank to keep current)' : 'Password (optional — can be set later)'}
        type="password"
        placeholder={editing?.mode === 'edit' ? 'Set a new password' : 'Min 8 characters'}
        value={form.password}
        onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
        error={fieldErrors.password}
        maxLength={200}
        autoComplete="new-password"
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={phoneId} className="text-sm font-medium text-gray-700">Phone (optional)</label>
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
        <>
          <Select
            label="Vendor"
            placeholder={vendorOptions.length ? 'Select a vendor' : 'No active vendors — create one first'}
            options={vendorOptions}
            value={form.vendorId || undefined}
            onValueChange={(v) => setForm((f) => ({ ...f, vendorId: v }))}
            error={fieldErrors.vendorId}
          />
          <Input
            label="Promoter code"
            placeholder="Optional — field-user promoter/employee ID"
            value={form.promoterCode}
            onChange={(e) => setForm((f) => ({ ...f, promoterCode: e.target.value }))}
            maxLength={60}
          />
        </>
      )}
    </>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Users</h1>
          <p className="text-sm text-gray-500 mt-0.5">Admins, ASMs, auditors and vendor logins.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setBulkDeactivateOpen(true)}>
            <Ban className="h-4 w-4" />
            Bulk deactivate
          </Button>
          <Button variant="primary" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            New user
          </Button>
        </div>
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

      {/* Create user — tabbed Single entry / Bulk upload modal. */}
      <Modal
        open={editing?.mode === 'create'}
        onOpenChange={(o) => !o && setEditing(null)}
        title="New user"
      >
        <div className="flex flex-col gap-4">
          {/* Segmented toggle */}
          <div role="tablist" aria-label="New user mode" className="inline-flex self-start rounded-lg bg-gray-100 p-0.5">
            <button
              type="button"
              role="tab"
              aria-selected={createTab === 'single'}
              onClick={() => setCreateTab('single')}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                createTab === 'single' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
              )}
            >
              Single entry
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={createTab === 'bulk'}
              onClick={() => setCreateTab('bulk')}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                createTab === 'bulk' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
              )}
            >
              Bulk upload
            </button>
          </div>

          {createTab === 'single' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!saving) submit();
              }}
              className="flex flex-col gap-4"
            >
              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{formError}</div>
              )}
              {userFields}
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={saving}>
                  Create user
                </Button>
              </div>
            </form>
          ) : (
            <BulkActionPanel
              instructions="A new phone creates a login; an existing phone updates only its name & promoter code (role/vendor never change — use Edit). role is CLIENT_ADMIN / ASM / AUDITOR / VENDOR_HO / VENDOR_FIELD; vendor_code is required for VENDOR_* roles."
              templateUrl="/api/users/bulk-upload/template"
              templateFileName="user-upload-template.xlsx"
              reportBaseName="user-upload"
              upload={usersApi.bulkUpload}
              onDone={() => void load()}
            />
          )}
        </div>
      </Modal>

      {/* Edit user — plain single-entry form (no toggle). */}
      <FormDialog
        open={editing?.mode === 'edit'}
        onOpenChange={(o) => !o && setEditing(null)}
        title="Edit user"
        submitLabel="Save changes"
        loading={saving}
        error={formError}
        onSubmit={submit}
      >
        {userFields}
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

      {/* Bulk deactivate users */}
      <Modal
        open={bulkDeactivateOpen}
        onOpenChange={setBulkDeactivateOpen}
        title="Bulk deactivate users"
      >
        <BulkActionPanel
          instructions="Upload an .xlsx with an email column; listed active users are deactivated."
          templateUrl={usersApi.bulkDeactivateTemplateUrl}
          templateFileName="user-deactivate-template.xlsx"
          reportBaseName="user-deactivate"
          upload={usersApi.bulkDeactivate}
          onDone={() => void load()}
        />
      </Modal>
    </div>
  );
}
