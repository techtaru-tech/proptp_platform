import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock3, History, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Toggle } from '../../components/ui/Toggle';
import { Tabs } from '../../components/ui/Tabs';
import { Select } from '../../components/ui/Select';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  listAutomations, toggleAutomationEnabled, deleteAutomation, listAutomationRuns,
} from '../../services/leadAutomationService';
import { TRIGGER_OPTIONS } from './automationOptions';
import { formatDateTime, formatRelativeTime } from '../../utils/format';
import type { Automation, AutomationRunEntry } from '../../types';

const STATUS_OPTIONS: { value: AutomationRunEntry['status'] | 'all'; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'waiting', label: 'Waiting (delay)' },
];

export function Automations() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Automation | null>(null);
  const [runAutomationFilter, setRunAutomationFilter] = useState('all');
  const [runStatusFilter, setRunStatusFilter] = useState<AutomationRunEntry['status'] | 'all'>('all');

  const { data: automations, isLoading } = useAsync(() => listAutomations(), [reloadKey]);
  const runParams = { page: 1, pageSize: 30, automationId: runAutomationFilter, status: runStatusFilter, sortBy: 'ranAt', sortDir: 'desc' as const };
  const { data: runs, isLoading: runsLoading } = useAsync(() => listAutomationRuns(runParams), [JSON.stringify(runParams), reloadKey]);

  const handleToggle = async (automation: Automation) => {
    await toggleAutomationEnabled(automation.id);
    setReloadKey((k) => k + 1);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteAutomation(deleteTarget.id);
    toast({ title: 'Automation deleted', variant: 'success' });
    setDeleteTarget(null);
    setReloadKey((k) => k + 1);
  };

  const columns: DataTableColumn<Automation>[] = [
    {
      key: 'name',
      header: 'Automation',
      render: (a) => (
        <div>
          <p className="font-medium text-ink">{a.name}</p>
          {a.description && <p className="max-w-xs truncate text-xs text-ink-faint">{a.description}</p>}
        </div>
      ),
    },
    {
      key: 'trigger',
      header: 'Trigger Event',
      render: (a) => <Badge tone="shell">{TRIGGER_OPTIONS.find((o) => o.value === a.triggerType)?.label ?? a.triggerType}</Badge>,
    },
    { key: 'steps', header: 'Steps', align: 'center', render: (a) => a.steps.length },
    {
      key: 'businessHours',
      header: 'Business Hours',
      align: 'center',
      render: (a) => (a.respectBusinessHours ? <Badge tone="info"><Clock3 size={11} />Respected</Badge> : <span className="text-ink-faint">—</span>),
    },
    { key: 'runCount', header: 'Runs', align: 'center', render: (a) => a.runCount ?? 0 },
    {
      key: 'active',
      header: 'Active',
      align: 'center',
      render: (a) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Toggle label={`${a.name} active`} showLabel={false} checked={a.enabled} onChange={() => handleToggle(a)} />
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (a) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" leftIcon={<Pencil size={13} />} onClick={() => navigate(`/crm/automation/${a.id}/edit`)}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" className="text-danger-600" leftIcon={<Trash2 size={13} />} onClick={() => setDeleteTarget(a)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  const runColumns: DataTableColumn<AutomationRunEntry>[] = [
    { key: 'ranAt', header: 'When', render: (r) => formatDateTime(r.ranAt) },
    { key: 'automation', header: 'Automation', render: (r) => r.automationName },
    { key: 'lead', header: 'Lead', render: (r) => r.leadName || r.leadId },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge tone={r.status === 'success' ? 'success' : r.status === 'failed' ? 'danger' : r.status === 'waiting' ? 'info' : 'neutral'}>
          {r.status}
        </Badge>
      ),
    },
    { key: 'message', header: 'Detail', render: (r) => <span className="text-xs text-ink-muted">{r.message}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Automations"
        description="Trigger, conditions, actions and delays — run automatically for every matching lead."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Automations' }]}
        actions={
          <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => navigate('/crm/automation/new')}>
            New Automation
          </Button>
        }
      />

      <Tabs items={[{ key: 'automations', label: 'Automations', icon: <Zap size={14} /> }, { key: 'runs', label: 'Run History', icon: <History size={14} /> }]}>
        {(active) => (
          <div className="pt-4">
            {active === 'automations' && (
              <Card padded={false}>
                <DataTable
                  columns={columns}
                  rows={automations ?? []}
                  rowKey={(a) => a.id}
                  isLoading={isLoading}
                  onRowClick={(a) => navigate(`/crm/automation/${a.id}/edit`)}
                  emptyTitle="No automations yet"
                  emptyDescription="Create one to assign, tag, or follow up on leads automatically."
                />
              </Card>
            )}

            {active === 'runs' && (
              <Card padded={false}>
                <div className="flex flex-wrap items-center gap-2.5 border-b border-line p-4">
                  <Select
                    value={runAutomationFilter}
                    onChange={(e) => setRunAutomationFilter(e.target.value)}
                    options={[{ value: 'all', label: 'All Automations' }, ...(automations ?? []).map((a) => ({ value: a.id, label: a.name }))]}
                    wrapperClassName="w-56"
                  />
                  <Select
                    value={runStatusFilter}
                    onChange={(e) => setRunStatusFilter(e.target.value as AutomationRunEntry['status'] | 'all')}
                    options={STATUS_OPTIONS}
                    wrapperClassName="w-48"
                  />
                  <span className="ml-auto text-xs text-ink-faint">
                    {runs?.items[0] ? `Last run ${formatRelativeTime(runs.items[0].ranAt)}` : ''}
                  </span>
                </div>
                <DataTable
                  columns={runColumns}
                  rows={runs?.items ?? []}
                  rowKey={(r) => r.id}
                  isLoading={runsLoading}
                  emptyTitle="No runs yet"
                  emptyDescription="Every automatic and manual run is logged here — a stage change, a new lead, or an admin's manual 'Run' action."
                />
              </Card>
            )}
          </div>
        )}
      </Tabs>

      <ConfirmationDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete this automation?"
        description={deleteTarget ? `"${deleteTarget.name}" and its run history will be permanently removed.` : undefined}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
