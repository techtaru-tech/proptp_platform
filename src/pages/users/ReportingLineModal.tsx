import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { useToast } from '../../context/ToastContext';
import { refAgents, refEmployees, refLeaders, refTeamLeaders } from '../../data/referenceData';
import { updateUserHierarchy } from '../../services/userService';
import { RoleId, type AccountRole, type PartnerUser } from '../../types';

/**
 * Where somebody sits in the reporting tree: their role and who they report to.
 *
 * The CRM's visibility is derived from this one edge, so it is edited in one place and the
 * server checks the pair together — a promotion cannot leave somebody under the wrong kind of
 * manager, and nobody can be placed under their own report.
 */

const ROLE_FROM_ID: Record<number, AccountRole> = {
  [RoleId.Agent]: 'agent',
  [RoleId.Admin]: 'admin',
  [RoleId.Employee]: 'employee',
  [RoleId.Leader]: 'leader',
  [RoleId.TeamLeader]: 'team_leader',
};

const ROLE_LABEL: Record<AccountRole, string> = {
  admin: 'Admin',
  leader: 'Leader',
  team_leader: 'Team Leader',
  employee: 'Employee',
  agent: 'Agent',
};

/** Who each role may report to — mirrors the server's rule, which is what enforces it. */
const MANAGER_ROLES: Record<AccountRole, AccountRole[]> = {
  admin: [],
  leader: [],
  team_leader: ['leader'],
  employee: ['team_leader', 'leader'],
  agent: ['employee', 'team_leader', 'leader'],
};

const ROLE_OPTIONS = (['leader', 'team_leader', 'employee', 'agent'] as AccountRole[]).map((value) => ({ value, label: ROLE_LABEL[value] }));

export function ReportingLineModal({ user, onClose, onSaved }: { user: PartnerUser; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [role, setRole] = useState<AccountRole>(ROLE_FROM_ID[user.role] ?? 'employee');
  const [managerId, setManagerId] = useState(user.managerId ?? '');
  const [saving, setSaving] = useState(false);

  const allowed = MANAGER_ROLES[role];
  const pool = [
    ...(allowed.includes('leader') ? refLeaders : []),
    ...(allowed.includes('team_leader') ? refTeamLeaders : []),
    ...(allowed.includes('employee') ? refEmployees : []),
    ...(allowed.includes('agent') ? refAgents : []),
  ].filter((m) => m.id !== user.id && m.status === 'active');

  const save = async () => {
    setSaving(true);
    try {
      await updateUserHierarchy(user.id, { role, managerId: managerId || null });
      onSaved();
    } catch (err) {
      toast({ title: 'Could not change the reporting line', description: (err as Error).message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Reporting line — ${user.name}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} isLoading={saving}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Role"
          name="hierarchyRole"
          value={role}
          onChange={(e) => {
            setRole(e.target.value as AccountRole);
            setManagerId('');
          }}
          options={ROLE_OPTIONS}
        />
        {allowed.length > 0 && (
          <Select
            label="Reporting manager"
            name="hierarchyManager"
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
            options={[{ value: '', label: 'No manager' }, ...pool.map((m) => ({ value: m.id, label: m.name }))]}
          />
        )}
        <p className="rounded-lg bg-surface-subtle px-3 py-2.5 text-xs text-ink-muted">
          Their leads stay with them. What changes is who can see them: a manager sees their own leads and everyone
          beneath them, so moving somebody moves their leads in or out of each manager&apos;s view.
        </p>
      </div>
    </Modal>
  );
}
