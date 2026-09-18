import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ExternalLink, Info, MessageSquarePlus, Pencil, Send, StopCircle } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Select } from '../../components/ui/Select';
import { Drawer } from '../../components/ui/Drawer';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  getSdrAgent, getSdrCapabilities, handOffSdrEnrollment, listSdrEnrollments, listSdrMessages,
  logSdrMessage, stopSdrEnrollment, SDR_CHANNEL_OPTIONS, SDR_GOAL_OPTIONS, SDR_STATUS_TONE,
} from '../../services/aiSdrService';
import { userDisplayName } from '../../data/referenceData';
import { formatDateTime, formatRelativeTime } from '../../utils/format';
import { cn } from '../../utils/cn';
import type { AiSdrEnrollment } from '../../types';

const STATUS_FILTERS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'exhausted', label: 'Ceiling reached' },
  { value: 'handed_off', label: 'Handed off' },
  { value: 'stopped', label: 'Stopped' },
];

export function AiSdrAgentDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [reloadKey, setReloadKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [threadFor, setThreadFor] = useState<AiSdrEnrollment | null>(null);

  const { data: agent, isLoading, error } = useAsync(() => getSdrAgent(id), [id]);
  const { data: enrollments, isLoading: enrollmentsLoading } = useAsync(() => listSdrEnrollments(id), [id, reloadKey]);
  const { data: capabilities } = useAsync(() => getSdrCapabilities(), []);

  if (isLoading) return <CardSkeleton />;
  if (error || !agent) return <ErrorState title="Agent not found" description={error?.message ?? 'This agent may have been deleted.'} />;

  const rows = (enrollments ?? []).filter((e) => statusFilter === 'all' || e.status === statusFilter);
  const dueCount = (enrollments ?? []).filter((e) => e.eligibility.isDue).length;

  const reload = () => setReloadKey((k) => k + 1);

  const handleHandoff = async (enrollment: AiSdrEnrollment) => {
    const result = await handOffSdrEnrollment(enrollment.id, 'qualified');
    toast({ title: result.ok ? 'Handed off' : 'Could not hand off', description: result.message, variant: result.ok ? 'success' : 'error' });
    reload();
  };

  const handleStop = async (enrollment: AiSdrEnrollment) => {
    const result = await stopSdrEnrollment(enrollment.id);
    toast({ title: result.ok ? 'Enrollment stopped' : 'Could not stop', description: result.message, variant: result.ok ? 'success' : 'error' });
    reload();
  };

  const columns: DataTableColumn<AiSdrEnrollment>[] = [
    {
      key: 'lead',
      header: 'Lead',
      render: (e) => (
        <div>
          <p className="font-medium text-ink">{e.leadName}</p>
          <p className="text-xs text-ink-faint">{e.leadEmail || e.leadPhone || 'No contact details'}</p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (e) => <Badge tone={SDR_STATUS_TONE[e.status] ?? 'neutral'}>{e.status.replace('_', ' ')}</Badge> },
    {
      key: 'progress',
      header: 'Follow-ups',
      align: 'center',
      render: (e) => (
        <span className="text-sm text-ink">
          {e.followUpsSent}
          <span className="text-ink-faint"> / {agent.maxFollowUps}</span>
        </span>
      ),
    },
    {
      key: 'due',
      header: 'Next follow-up',
      render: (e) =>
        e.eligibility.isDue ? (
          <Badge tone="warning" dot>Due now</Badge>
        ) : (
          <span className="text-xs text-ink-muted">{e.eligibility.reason}</span>
        ),
    },
    { key: 'lastMessage', header: 'Last message', render: (e) => (e.lastMessageAt ? formatRelativeTime(e.lastMessageAt) : <span className="text-ink-faint">—</span>) },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (e) => (
        <div className="flex justify-end gap-1" onClick={(ev) => ev.stopPropagation()}>
          <Button variant="ghost" size="sm" leftIcon={<MessageSquarePlus size={13} />} onClick={() => setThreadFor(e)}>
            Thread ({e.messageCount})
          </Button>
          {(e.status === 'active' || e.status === 'exhausted') && (
            <>
              <Button variant="ghost" size="sm" leftIcon={<CheckCircle2 size={13} />} onClick={() => handleHandoff(e)}>
                Hand off
              </Button>
              <Button variant="ghost" size="sm" className="text-danger-600" leftIcon={<StopCircle size={13} />} onClick={() => handleStop(e)}>
                Stop
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={agent.name}
        description={`${SDR_GOAL_OPTIONS.find((o) => o.value === agent.goal)?.label} · ${SDR_CHANNEL_OPTIONS.find((o) => o.value === agent.channel)?.label}`}
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'AI SDR Agents', to: '/crm/sdr-agents' }, { label: agent.name }]}
        actions={
          <Button variant="outline" leftIcon={<Pencil size={14} />} onClick={() => navigate(`/crm/sdr-agents/${agent.id}/edit`)}>
            Edit agent
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={agent.active ? 'success' : 'neutral'} dot>{agent.active ? 'Active' : 'Paused'}</Badge>
        <Badge tone="navy">max {agent.maxFollowUps} follow-ups</Badge>
        <Badge tone="navy">≥{agent.minHoursBetweenFollowUps}h apart</Badge>
        {agent.respectBusinessHours && <Badge tone="info">Respects business hours</Badge>}
        {agent.handoffUserId && (
          <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
            <ArrowRight size={12} />
            hands off to {userDisplayName(agent.handoffUserId)}
          </span>
        )}
      </div>

      {capabilities && !capabilities.aiProviderConfigured && dueCount > 0 && (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          <Info size={16} className="mt-0.5 shrink-0" />
          <p>
            <strong>{dueCount} follow-up{dueCount === 1 ? '' : 's'} due now.</strong> No AI provider is configured, so nothing
            was written or sent — send these yourself, then log what you sent on the thread so the cadence and ceiling stay
            accurate.
          </p>
        </div>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line p-4">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} options={STATUS_FILTERS} wrapperClassName="w-48" />
          <span className="ml-auto text-xs text-ink-faint">
            {enrollments?.length ?? 0} enrolled · {dueCount} due now
          </span>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(e) => e.id}
          isLoading={enrollmentsLoading}
          emptyTitle="No leads enrolled"
          emptyDescription="Enrol leads from the leads list ('Enroll in AI SDR agent' bulk action) or with an automation action."
        />
      </Card>

      {threadFor && (
        <ThreadDrawer
          enrollment={threadFor}
          agentChannel={agent.channel}
          onClose={() => setThreadFor(null)}
          onLogged={() => {
            reload();
            setThreadFor(null);
          }}
        />
      )}
    </div>
  );
}

function ThreadDrawer({
  enrollment, agentChannel, onClose, onLogged,
}: {
  enrollment: AiSdrEnrollment;
  agentChannel: string;
  onClose: () => void;
  onLogged: () => void;
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [direction, setDirection] = useState<'outbound' | 'inbound'>('outbound');
  const [body, setBody] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const { data: messages, isLoading } = useAsync(() => listSdrMessages(enrollment.id), [enrollment.id, reloadKey]);

  const submit = async () => {
    if (!body.trim()) return;
    setIsSaving(true);
    try {
      const result = await logSdrMessage(enrollment.id, { direction, body: body.trim() });
      if (!result.ok) throw new Error(result.message);
      toast({
        title: 'Message logged',
        description: direction === 'outbound' ? 'Counted against the follow-up ceiling and cadence.' : 'Replies do not consume the follow-up budget.',
        variant: 'success',
      });
      setBody('');
      setReloadKey((k) => k + 1);
      onLogged();
    } catch (err) {
      toast({ title: 'Could not log the message', description: (err as Error).message, variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Drawer isOpen onClose={onClose} title={enrollment.leadName} width="md">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={SDR_STATUS_TONE[enrollment.status] ?? 'neutral'}>{enrollment.status.replace('_', ' ')}</Badge>
          <span className="text-xs text-ink-muted">{enrollment.eligibility.reason}</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            leftIcon={<ExternalLink size={12} />}
            onClick={() => navigate(`/crm/leads/${enrollment.leadId}`)}
          >
            View lead
          </Button>
        </div>

        {isLoading ? (
          <p className="py-8 text-center text-sm text-ink-faint">Loading…</p>
        ) : (messages ?? []).length === 0 ? (
          <EmptyState
            icon={MessageSquarePlus}
            title="Nothing logged yet"
            description="Once you send the first message, log it here so the cadence and follow-up ceiling stay accurate."
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            {(messages ?? []).map((m) => (
              <div
                key={m.id}
                className={cn(
                  'rounded-lg border px-3 py-2.5',
                  m.direction === 'outbound' ? 'border-line bg-surface-subtle' : 'border-info-100 bg-info-50'
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                    {m.direction === 'outbound' ? `Sent · ${m.channel}` : 'Reply received'}
                  </span>
                  <span className="text-xs text-ink-faint">{formatDateTime(m.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-ink">{m.body}</p>
                {m.deliveryNote && <p className="mt-1.5 text-xs text-ink-faint">{m.deliveryNote}</p>}
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2.5 border-t border-line pt-4">
          <Select
            label="Log a message"
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'outbound' | 'inbound')}
            options={[
              { value: 'outbound', label: `Something I sent (${agentChannel})` },
              { value: 'inbound', label: 'A reply I received' },
            ]}
          />
          <textarea
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Paste what was actually sent or received…"
            className="w-full rounded-lg border border-line-strong bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-ring"
          />
          <Button variant="primary" size="sm" leftIcon={<Send size={13} />} onClick={submit} isLoading={isSaving} disabled={!body.trim()}>
            Log message
          </Button>
          {direction === 'outbound' && (
            <p className="text-xs text-ink-faint">
              Logging a sent message uses one of the {enrollment.eligibility.followUpsRemaining} remaining follow-ups and
              restarts the cadence timer.
            </p>
          )}
        </div>
      </div>
    </Drawer>
  );
}
