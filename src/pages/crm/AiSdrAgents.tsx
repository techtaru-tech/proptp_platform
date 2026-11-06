import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Toggle } from '../../components/ui/Toggle';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/LoadingSkeleton';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  deleteSdrAgent, getSdrCapabilities, listSdrAgents, toggleSdrAgent,
  SDR_CHANNEL_OPTIONS, SDR_GOAL_OPTIONS,
} from '../../services/aiSdrService';
import { userDisplayName } from '../../data/referenceData';
import { cn } from '../../utils/cn';
import type { AiSdrAgent, SdrCapabilities } from '../../types';

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

  const list = agents ?? [];

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

      {/* Agents are the main column; what the engine can do today sits beside them (above on small screens). */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="xl:order-2">
          <CapabilityPanel capabilities={capabilities} />
        </div>

        <div className="min-w-0 xl:order-1">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {[0, 1].map((i) => (
                <Card key={i} className="space-y-2.5">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-56" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-2 w-full" />
                </Card>
              ))}
            </div>
          ) : list.length === 0 ? (
            <Card padded={false}>
              <EmptyState
                icon={Bot}
                title="No agents yet"
                description="Create an agent, then enrol leads into it manually or with an automation action."
                action={
                  <Button variant="primary" size="sm" leftIcon={<Plus size={13} />} onClick={() => navigate('/crm/sdr-agents/new')}>
                    Create first agent
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {list.map((a) => (
                <AgentCard
                  key={a.id}
                  agent={a}
                  onOpen={() => navigate(`/crm/sdr-agents/${a.id}`)}
                  onEdit={() => navigate(`/crm/sdr-agents/${a.id}/edit`)}
                  onToggle={() => handleToggle(a)}
                  onDelete={() => setDeleteTarget(a)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

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

// ---------------------------------------------------------------------------
// Capability status — the same flags that drive the "not configured" notice
// ---------------------------------------------------------------------------

function CapabilityPanel({ capabilities }: { capabilities?: SdrCapabilities }) {
  // The first four are the engine itself and run regardless of provider; the last two
  // are exactly the server's `aiProviderConfigured` / `messagingProviderConfigured`.
  const rows = capabilities
    ? [
        { label: 'Enrol leads manually or from an automation', ok: true },
        { label: 'Cadence and follow-up ceiling enforced', ok: true },
        { label: 'Business hours respected', ok: true },
        { label: 'Handoff reassigns the lead', ok: true },
        { label: 'Message writing', sub: 'AI provider', ok: capabilities.aiProviderConfigured },
        { label: 'Automatic sending', sub: 'Messaging provider', ok: capabilities.messagingProviderConfigured },
      ]
    : [];
  const working = rows.filter((r) => r.ok).length;
  const needsSetup = rows.length - working;

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h3 className="text-[13px] font-semibold text-ink">Capability status</h3>
          <p className="mt-0.5 text-xs text-ink-subtle">What works today and what needs setup.</p>
        </div>
        {capabilities && (
          <span className="shrink-0 pt-0.5 text-2xs tabular-nums text-ink-faint">
            {working} of {rows.length} working
          </span>
        )}
      </div>

      {!capabilities ? (
        <div className="space-y-3 px-4 py-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-3 w-full" />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0 text-xs text-ink">
                {r.label}
                {r.sub && <span className="text-ink-faint"> · {r.sub}</span>}
              </span>
              <Badge tone={r.ok ? 'success' : 'warning'} dot className="shrink-0">
                {r.ok ? 'Works' : 'Needs setup'}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {capabilities && needsSetup > 0 && (
        <p className="border-t border-line bg-surface-subtle px-4 py-2.5 text-2xs text-ink-subtle">
          {!capabilities.aiProviderConfigured
            ? 'Nothing is written or sent automatically yet: due follow-ups are listed for a human to send, and you log the message you actually sent on the lead’s thread.'
            : 'Automatic sending needs a messaging provider. Until then, due follow-ups are listed for a human to send.'}
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// One agent
// ---------------------------------------------------------------------------

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-line bg-surface-subtle px-1.5 py-px text-2xs font-medium text-ink-muted">
      {children}
    </span>
  );
}

function AgentCard({
  agent: a, onOpen, onEdit, onToggle, onDelete,
}: { agent: AiSdrAgent; onOpen: () => void; onEdit: () => void; onToggle: () => void; onDelete: () => void }) {
  const goal = SDR_GOAL_OPTIONS.find((o) => o.value === a.goal)?.label ?? a.goal;
  const channel = SDR_CHANNEL_OPTIONS.find((o) => o.value === a.channel)?.label ?? a.channel;
  const total = a.enrollmentCount ?? 0;
  const active = a.activeEnrollmentCount ?? 0;
  const pct = total > 0 ? Math.round((active / total) * 100) : 0;

  return (
    <Card padded={false} className={cn('flex flex-col', !a.active && 'bg-surface-subtle')}>
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onOpen}
            className="block max-w-full truncate rounded text-left text-[13px] font-semibold text-ink hover:text-brand-700 focus-ring"
          >
            {a.name}
          </button>
          <p className="mt-0.5 text-xs text-ink-subtle">
            Goal: {goal} · Channel: {channel}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={cn('text-2xs font-medium', a.active ? 'text-success-700' : 'text-ink-faint')}>{a.active ? 'Active' : 'Off'}</span>
          <Toggle label={`${a.name} active`} showLabel={false} checked={a.active} onChange={onToggle} />
        </div>
      </div>

      {a.persona ? (
        <p className="line-clamp-2 px-4 pt-2 text-xs text-ink-muted">{a.persona}</p>
      ) : (
        <p className="px-4 pt-2 text-xs italic text-ink-faint">No persona written yet.</p>
      )}

      <div className="mx-4 mt-3 space-y-2.5 border-t border-line pt-3">
        <div className="flex flex-wrap gap-1.5">
          <Chip>
            max {a.maxFollowUps} follow-up{a.maxFollowUps === 1 ? '' : 's'}
          </Chip>
          <Chip>≥{a.minHoursBetweenFollowUps}h apart</Chip>
          {a.respectBusinessHours && <Chip>business hours</Chip>}
          {a.goal === 'book_meeting' && a.meetingType && <Chip>{a.meetingType}</Chip>}
        </div>

        <p className="text-xs text-ink-subtle">
          {a.handoffUserId ? (
            <>
              Hands off to <span className="font-medium text-ink">{userDisplayName(a.handoffUserId)}</span>
            </>
          ) : (
            'No handoff person set'
          )}
        </p>

        <div>
          <div className="flex items-center justify-between text-2xs tabular-nums text-ink-faint">
            <span>Leads</span>
            <span>
              <span className="font-medium text-ink">{active}</span> active / {total} enrolled
            </span>
          </div>
          <div
            className="mt-1 h-1 overflow-hidden rounded-full bg-surface-muted"
            role="progressbar"
            aria-label="Leads still being worked"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={active}
          >
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <div className="mt-3 flex justify-end gap-0.5 border-t border-line px-2 py-1.5">
        <Button variant="ghost" size="sm" leftIcon={<Users size={13} />} onClick={onOpen}>
          Leads
        </Button>
        <Button variant="ghost" size="sm" leftIcon={<Pencil size={13} />} onClick={onEdit}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" className="text-danger-600 hover:text-danger-700" leftIcon={<Trash2 size={13} />} onClick={onDelete}>
          Delete
        </Button>
      </div>
    </Card>
  );
}
