import { useState } from 'react';
import { Info, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Drawer } from '../../components/ui/Drawer';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  createPanelRole, deletePanelRole, listModules, listPanelRoles, updatePanelRole,
} from '../../services/panelAccessService';
import { cn } from '../../utils/cn';
import type { ModuleKey, PanelRole } from '../../types';

export function RolesSettings() {
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<PanelRole | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PanelRole | null>(null);

  const { data: roles, isLoading } = useAsync(() => listPanelRoles(), [reloadKey]);
  const { data: modules } = useAsync(() => listModules(), []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deletePanelRole(deleteTarget.id);
      toast({ title: 'Role deleted', variant: 'success' });
      setDeleteTarget(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast({ title: 'Could not delete the role', description: (err as Error).message, variant: 'error' });
    }
  };

  const columns: DataTableColumn<PanelRole>[] = [
    {
      key: 'name',
      header: 'Role',
      render: (r) => (
        <div>
          <p className="flex items-center gap-2 font-medium text-ink">
            {r.name}
            {r.isSystem && <Badge tone="navy">Built-in</Badge>}
          </p>
          {r.description && <p className="max-w-md truncate text-xs text-ink-faint">{r.description}</p>}
        </div>
      ),
    },
    {
      key: 'access',
      header: 'Access',
      render: (r) =>
        r.isFullAccess ? (
          <Badge tone="success" dot>Every module</Badge>
        ) : (
          <span className="text-sm text-ink-muted">
            {r.modules.length} module{r.modules.length === 1 ? '' : 's'}
          </span>
        ),
    },
    { key: 'users', header: 'Users', align: 'center', render: (r) => r.userCount ?? 0 },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (r) =>
        r.isSystem ? (
          <span className="text-xs text-ink-faint">Not editable</span>
        ) : (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" leftIcon={<Pencil size={13} />} onClick={() => setEditing(r)}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" className="text-danger-600" leftIcon={<Trash2 size={13} />} onClick={() => setDeleteTarget(r)}>
              Delete
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Roles & Permissions"
        description="Create a role, tick the modules it may open, then assign it to a panel user."
        breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'Roles & Permissions' }]}
        actions={
          <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setEditing('new')}>
            New Role
          </Button>
        }
      />

      <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-info-100 bg-info-50 px-4 py-3 text-sm text-info-700">
        <Info size={16} className="mt-0.5 shrink-0" />
        <p>
          A module the role doesn't have is hidden from the sidebar <strong>and</strong> refused by the API, so it can't be
          reached by typing the URL either. Only a full-access administrator can open this page or manage panel users.
        </p>
      </div>

      <Card padded={false}>
        <DataTable
          columns={columns}
          rows={roles ?? []}
          rowKey={(r) => r.id}
          isLoading={isLoading}
          emptyTitle="No roles yet"
          emptyDescription="Create one — for example 'HR Manager' with only Attendance and Partners."
        />
      </Card>

      {editing && modules && (
        <RoleDrawer
          role={editing === 'new' ? null : editing}
          modules={modules}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}

      <ConfirmationDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete this role?"
        description={deleteTarget ? `"${deleteTarget.name}" will be removed. Users still on it must be moved first.` : undefined}
        confirmLabel="Delete role"
        variant="danger"
      />
    </div>
  );
}

function RoleDrawer({
  role, modules, onClose, onSaved,
}: {
  role: PanelRole | null;
  modules: { key: ModuleKey; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selected, setSelected] = useState<ModuleKey[]>(role?.modules ?? []);
  const [isSaving, setIsSaving] = useState(false);

  const toggle = (key: ModuleKey) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]));

  const save = async () => {
    if (!name.trim()) {
      toast({ title: 'Role name is required', variant: 'error' });
      return;
    }
    if (selected.length === 0) {
      toast({ title: 'Select at least one module', variant: 'error' });
      return;
    }
    setIsSaving(true);
    try {
      if (role) await updatePanelRole(role.id, { name: name.trim(), description: description.trim(), modules: selected });
      else await createPanelRole({ name: name.trim(), description: description.trim(), modules: selected });
      toast({ title: role ? 'Role updated' : 'Role created', variant: 'success' });
      onSaved();
    } catch (err) {
      toast({ title: 'Could not save the role', description: (err as Error).message, variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Drawer isOpen onClose={onClose} title={role ? `Edit ${role.name}` : 'New role'} width="md">
      <div className="flex flex-col gap-5">
        <Input label="Role name" name="roleName" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HR Manager" />
        <Input label="Description" name="roleDescription" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this role is for" />

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-ink">Modules</span>
            <div className="flex gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => setSelected(modules.map((m) => m.key))}>
                Select all
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                Clear
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {modules.map((m) => {
              const on = selected.includes(m.key);
              return (
                <label
                  key={m.key}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                    on ? 'border-brand-600 bg-brand-50 text-ink' : 'border-line text-ink-muted hover:bg-surface-subtle'
                  )}
                >
                  <input type="checkbox" checked={on} onChange={() => toggle(m.key)} className="h-4 w-4 rounded border-line-strong text-brand-600 focus-ring" />
                  {m.label}
                </label>
              );
            })}
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-faint">
            <ShieldCheck size={13} className="mt-0.5 shrink-0" />
            Settings includes this page — give it only to people who should be able to create roles and panel users.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} isLoading={isSaving}>
            {role ? 'Save changes' : 'Create role'}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
