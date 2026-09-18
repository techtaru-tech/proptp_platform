import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock3, Info, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Toggle } from '../../components/ui/Toggle';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  deleteSdrAgent, getSdrCapabilities, listSdrAgents, toggleSdrAgent,
  SDR_CHANNEL_OPTIONS, SDR_GOAL_OPTIONS,
} from '../../services/aiSdrService';
import { userDisplayName } from '../../data/referenceData';
import type { AiSdrAgent } from '../../types';

export function AiSdrAgents() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<AiSdrAgent | null>(null);

  const { data: agents, isLoading } = useAsync(() => listSdrAgents(), [reloadKey]);
  const { data: capabilities } = useAsync(() => getSdrCapabilities(), []);

  const handleToggle = async (agent: AiSdrAgent) => {
    await toggleSdrAgent(agent.id);
    setReloadKey((k) => k + 1);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteSdrAgent(deleteTarget.id);
    toast({ title: 'Agent deleted', description: 'Its enrollments and message threads were removed too.', variant: 'success' });
    setDeleteTarget(null);
    setReloadKey((k) => k + 1);
  };

  const columns: DataTableColumn<AiSdrAgent>[] = [
    {
      key: 'name',
      header: 'Agent',
      render: (a) => (
        <div>
          <p className="font-medium text-ink">{a.name}</p>
          {a.persona && <p className="max-w-xs truncate text-xs text-ink-faint">{a.persona}</p>}
        </div>
      ),
    },
    { key: 'goal', header: 'Goal', render: (a) => <Badge tone="shell">{SDR_GOAL_OPTIONS.find((o) => o.value === a.goal)?.label ?? a.goal}</Badge> },
    { key: 'channel', header: 'Channel', render: (a) => SDR_CHANNEL_OPTIONS.find((o) => o.value === a.channel)?.label ?? a.channel },
    {
      key: 'guardrails',
      header: 'Guardrails',
      render: (a) => (
        <span className="text-xs text-ink-muted">
          max {a.maxFollowUps} · ≥{a.minHoursBetweenFollowUps}h apart
          {a.respectBusinessHours && (
            <span className="ml-1.5 inline-flex items-center gap-1 text-ink-faint">
              <Clock3 size={11} />
              business hours
            </span>
          )}
        </span>
      ),
    },
    { key: 'handoff', header: 'Hands off to', render: (a) => (a.handoffUserId ? userDisplayName(a.handoffUserId) : <span className="text-ink-faint">—</span>) },
    {
      key: 'enrollments',
      header: 'Leads',
      align: 'center',
      render: (a) => (
        <span className="text-sm text-ink">
          {a.activeEnrollmentCount ?? 0}
          <span className="text-ink-faint"> / {a.enrollmentCount ?? 0}</span>
        </span>
      ),
    },
    {
      key: 'active',
      header: 'Active',
      align: 'center',
      render: (a) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Toggle label={`${a.name} active`} showLabel={false} checked={a.active} onChange={() => handleToggle(a)} />
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (a) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" leftIcon={<Users size={13} />} onClick={() => navigate(`/crm/sdr-agents/${a.id}`)}>
            Leads
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<Pencil size={13} />} onClick={() => navigate(`/crm/sdr-agents/${a.id}/edit`)}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" className="text-danger-600" leftIcon={<Trash2 size={13} />} onClick={() => setDeleteTarget(a)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="AI SDR Agents"
        description="An agent works a lead on your behalf — persona, offer, guardrails and who it hands a qualified lead to."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'AI SDR Agents' }]}
        actions={
          <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => navigate('/crm/sdr-agents/new')}>
            New Agent
          </Button>
        }
      />

      {capabilities && !capabilities.aiProviderConfigured && (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          <Info size={16} className="mt-0.5 shrink-0" />
          <p>
            <strong>No AI provider is configured.</strong> Everything except message writing works for real: leads enrol
            (manually or from an automation), the cadence and follow-up ceiling are enforced, business hours are respected,
            and handoff genuinely reassigns the lead. Due follow-ups are listed for a human to send.
          </p>
        </div>
      )}

      <Card padded={false}>
        <DataTable
          columns={columns}
          rows={agents ?? []}
          rowKey={(a) => a.id}
          isLoading={isLoading}
          onRowClick={(a) => navigate(`/crm/sdr-agents/${a.id}`)}
          emptyTitle="No agents yet"
          emptyDescription="Create an agent, then enrol leads into it manually or with an automation action."
        />
      </Card>

      <ConfirmationDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete this agent?"
        description={
          deleteTarget
            ? `"${deleteTarget.name}" and its ${deleteTarget.enrollmentCount ?? 0} enrollment(s) with their message threads will be permanently removed. Leads themselves are not affected.`
            : undefined
        }
        confirmLabel="Delete agent"
        variant="danger"
      />
    </div>
  );
}
