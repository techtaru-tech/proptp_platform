import { useState } from 'react';
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import type { AccountRole } from '../../types';
import { Badge } from '../../components/ui/Badge';
import { Avatar } from '../../components/ui/Avatar';
import { Drawer } from '../../components/ui/Drawer';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import {
  createPanelUser, deletePanelUser, listPanelRoles, listPanelUsers, updatePanelUser,
} from '../../services/panelAccessService';
import { formatDate } from '../../utils/format';
import { loadReferenceData, refAgents, refEmployees, refLeaders, refTeamLeaders } from '../../data/referenceData';
import type { PanelRole, PanelUser } from '../../types';

const ACCOUNT_ROLE_LABEL: Record<AccountRole, string> = {
  admin: 'Admin',
  leader: 'Leader',
  team_leader: 'Team Leader',
  employee: 'Employee',
  channel_partner: 'Channel partner',
};

const ACCOUNT_ROLE_OPTIONS = (Object.keys(ACCOUNT_ROLE_LABEL) as AccountRole[]).map((value) => ({
  value,
  label: ACCOUNT_ROLE_LABEL[value],
}));

/** Who each role may report to. Mirrors the server's rule, which is what actually enforces it. */
const MANAGER_ROLES: Record<AccountRole, AccountRole[]> = {
  admin: [],
  leader: [],
  team_leader: ['leader'],
  employee: ['team_leader', 'leader'],
  channel_partner: ['employee', 'team_leader', 'leader'],
};


const ROLE_KEY_BY_ID: Record<number, AccountRole> = { 0: 'channel_partner', 1: 'admin', 2: 'employee', 3: 'leader', 4: 'team_leader' };
const roleKey = (id: number): AccountRole => ROLE_KEY_BY_ID[id] ?? 'employee';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'suspended', label: 'Suspended' },
];

export function PanelUsersSettings() {
  const { toast } = useToast();
  const { session } = useAuth();
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<PanelUser | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PanelUser | null>(null);

  const { data: users, isLoading } = useAsync(() => listPanelUsers(), [reloadKey]);
  const { data: roles } = useAsync(() => listPanelRoles(), [reloadKey]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deletePanelUser(deleteTarget.id);
      toast({ title: 'Panel user deleted', variant: 'success' });
      setDeleteTarget(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast({ title: 'Could not delete the user', description: (err as Error).message, variant: 'error' });
    }
  };

  const columns: DataTableColumn<PanelUser>[] = [
    {
      key: 'name',
      header: 'User',
      render: (u) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={u.name} src={u.avatarUrl} size="sm" />
          <span>
            <span className="block font-medium text-ink">
              {u.name}
              {u.id === session?.id && <span className="ml-1.5 text-xs text-ink-faint">(you)</span>}
            </span>
            <span className="block text-xs text-ink-faint">{u.email}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (u) => <Badge tone={u.isFullAccess ? 'success' : 'shell'}>{u.roleName}</Badge>,
    },
    {
      key: 'accountRole',
      header: 'Account',
      render: (u) => <Badge tone="neutral">{ACCOUNT_ROLE_LABEL[u.accountRole] ?? u.accountRole}</Badge>,
    },
    {
      key: 'manager',
      header: 'Reports to',
      render: (u) => (u.managerName ? u.managerName : <span className="text-ink-faint">—</span>),
    },
    { key: 'phone', header: 'Phone', render: (u) => u.phone },
    {
      key: 'status',
      header: 'Status',
      render: (u) => <Badge tone={u.status === 'active' ? 'success' : 'neutral'} dot>{u.status}</Badge>,
    },
    { key: 'createdAt', header: 'Added', render: (u) => formatDate(u.createdAt) },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (u) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" leftIcon={<Pencil size={13} />} onClick={() => setEditing(u)}>
            Edit
          </Button>
          {u.id !== session?.id && (
            <Button variant="ghost" size="sm" className="text-danger-600" leftIcon={<Trash2 size={13} />} onClick={() => setDeleteTarget(u)}>
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Panel Users"
        description="Everyone who can sign in to this admin panel, and the role that decides what they see."
        breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'Panel Users' }]}
        actions={
          <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setEditing('new')}>
            New Panel User
          </Button>
        }
      />

      <Card padded={false}>
        <DataTable
          columns={columns}
          rows={users ?? []}
          rowKey={(u) => u.id}
          isLoading={isLoading}
          emptyTitle="No panel users"
          emptyDescription="Create one and give them a role — they sign in with the email and password you set here."
        />
      </Card>

      {editing && roles && (
        <UserDrawer
          user={editing === 'new' ? null : editing}
          roles={roles}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReloadKey((k) => k + 1);
            // The partner directory feeds every manager picker and assignee list, so a new
            // person or a changed reporting line has to reach it before the next dropdown opens.
            void loadReferenceData(true).catch(() => {});
          }}
        />
      )}

      <ConfirmationDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete this panel user?"
        description={deleteTarget ? `"${deleteTarget.name}" will no longer be able to sign in.` : undefined}
        confirmLabel="Delete user"
        variant="danger"
      />
    </div>
  );
}

function UserDrawer({
  user, roles, onClose, onSaved,
}: {
  user: PanelUser | null;
  roles: PanelRole[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [password, setPassword] = useState('');
  const [panelRoleId, setPanelRoleId] = useState(user?.panelRoleId ?? roles[0]?.id ?? '');
  const [accountRole, setAccountRole] = useState<AccountRole>(user?.accountRole ?? 'admin');
  const [managerId, setManagerId] = useState<string>(user?.managerId ?? '');
  const [status, setStatus] = useState(user?.status ?? 'active');
  const [isSaving, setIsSaving] = useState(false);

  const save = async () => {
    setIsSaving(true);
    try {
      if (user) {
        await updatePanelUser(user.id, {
          name: name.trim(),
          panelRoleId,
          status,
          // Left blank means "keep the current password" — nothing is sent.
          ...(password ? { password } : {}),
          // Placement is sent only when it actually changed, so saving a name edit cannot
          // trip the server's reporting-line checks for somebody whose setup predates them.
          ...(accountRole !== user.accountRole || (managerId || null) !== (user.managerId ?? null)
            ? { accountRole, managerId: managerId || null }
            : {}),
        });
        toast({ title: 'Panel user updated', variant: 'success' });
      } else {
        await createPanelUser({ name: name.trim(), email: email.trim(), phone: phone.trim(), password, panelRoleId, accountRole, managerId: managerId || null });
        toast({ title: 'Panel user created', description: 'They can sign in with this email and password.', variant: 'success' });
      }
      onSaved();
    } catch (err) {
      toast({ title: 'Could not save the user', description: (err as Error).message, variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const selectedRole = roles.find((r) => r.id === panelRoleId);

  // Everyone who could be this person's manager given what they are, excluding themselves.
  const allowedManagerRoles = MANAGER_ROLES[accountRole];
  const managerPool = [
    ...(allowedManagerRoles.includes('leader') ? refLeaders : []),
    ...(allowedManagerRoles.includes('team_leader') ? refTeamLeaders : []),
    ...(allowedManagerRoles.includes('employee') ? refEmployees : []),
    ...(allowedManagerRoles.includes('channel_partner') ? refAgents : []),
  ].filter((m) => m.id !== user?.id && m.status === 'active');

  return (
    <Drawer isOpen onClose={onClose} title={user ? `Edit ${user.name}` : 'New panel user'} width="sm">
      <div className="flex flex-col gap-4">
        <Input label="Full name" name="userName" required value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          label="Email"
          name="userEmail"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={!!user}
          hint={user ? 'Email cannot be changed after the account is created.' : 'They sign in with this.'}
        />
        <Input
          label="Phone"
          name="userPhone"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={!!user}
          placeholder="10 digits"
        />
        <Input
          label={user ? 'New password' : 'Password'}
          name="userPassword"
          type="password"
          required={!user}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={user ? 'Leave blank to keep the current one' : 'At least 8 characters'}
          leftIcon={<KeyRound size={14} />}
        />
        <Select
          label="Account role"
          name="accountRole"
          value={accountRole}
          onChange={(e) => {
            setAccountRole(e.target.value as AccountRole);
            // A manager that suits the old role may be the wrong kind for the new one.
            setManagerId('');
          }}
          options={ACCOUNT_ROLE_OPTIONS}
          hint="Where this person sits: Leader → Team Leader → Employee → Agent. It decides which leads, follow-ups, tasks and reports they can see — their own and everyone beneath them. An Admin sees everything."
        />
        {allowedManagerRoles.length > 0 && (
          <Select
            label="Reporting manager"
            name="managerId"
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
            options={[
              { value: '', label: 'No manager' },
              ...managerPool.map((m) => ({ value: m.id, label: `${m.name} · ${ACCOUNT_ROLE_LABEL[roleKey(m.role)]}` })),
            ]}
            hint={
              accountRole === 'team_leader'
                ? 'A Team Leader reports to a Leader.'
                : accountRole === 'employee'
                  ? 'An Employee reports to a Team Leader.'
                  : 'An Agent reports to an Employee or a Team Leader.'
            }
          />
        )}
        {user && accountRole !== user.accountRole && (
          <p className="rounded-lg bg-warning-50 px-3 py-2.5 text-xs text-warning-700">
            Changing the role moves this person in the tree. Their leads stay with them; what changes is who can see them.
          </p>
        )}

        <Select
          label="Role"
          name="userRole"
          required
          value={panelRoleId}
          onChange={(e) => setPanelRoleId(e.target.value)}
          options={roles.map((r) => ({ value: r.id, label: r.name }))}
        />
        {selectedRole && (
          <p className="rounded-lg bg-surface-subtle px-3 py-2.5 text-xs text-ink-muted">
            {selectedRole.isFullAccess
              ? 'Full access — every module, including roles and panel users.'
              : `Can open: ${selectedRole.modules.join(', ') || 'nothing yet'}.`}
          </p>
        )}
        {user && (
          <Select label="Status" name="userStatus" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} options={STATUS_OPTIONS} />
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} isLoading={isSaving}>
            {user ? 'Save changes' : 'Create user'}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
