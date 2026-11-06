import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bot, CalendarPlus, Clock3, Filter, GitBranch, History, ListOrdered, Mail, Pencil, PenLine, Plus, Tag, Trash2, UserCog, Zap,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Toggle } from '../../components/ui/Toggle';
import { Tabs } from '../../components/ui/Tabs';
import { Select } from '../../components/ui/Select';
import { FilterChips } from '../../components/ui/FilterChips';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import { usePipelineReferenceData } from '../../hooks/usePipelineReferenceData';
import { useToast } from '../../context/ToastContext';
import {
  listAutomations, toggleAutomationEnabled, deleteAutomation, listAutomationRuns,
} from '../../services/leadAutomationService';
import { listForms } from '../../services/formService';
import { refTeams, userDisplayName } from '../../data/referenceData';
import { ACTION_OPTIONS, CONDITION_OPTIONS, TRIGGER_OPTIONS } from './automationOptions';
import { formatDateTime, formatRelativeTime } from '../../utils/format';
import { cn } from '../../utils/cn';
import type { Automation, AutomationRunEntry, AutomationStep } from '../../types';

const RUNS_PAGE_SIZE = 30;

const STATUS_CHIPS: { key: AutomationRunEntry['status'] | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'success', label: 'Success' },
  { key: 'failed', label: 'Failed' },
  { key: 'skipped', label: 'Skipped' },
  { key: 'waiting', label: 'Waiting' },
];

// ---------------------------------------------------------------------------------------------
// Turning a stored trigger and its steps into the short phrases drawn on each card
// ---------------------------------------------------------------------------------------------

interface Lookups {
  stage: (id?: unknown) => string | undefined;
  tag: (id?: unknown) => string | undefined;
  form: (id?: unknown) => string | undefined;
}

type ChipKind = 'trigger' | 'condition' | 'delay' | 'action';
interface FlowChip { kind: ChipKind; text: string; icon: LucideIcon }

const str = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : String(v));
const humanize = (s: string) => {
  const spaced = s.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};
/** "Lead Stage Changed" -> "Lead stage changed", to match the rest of the chips. */
const sentence = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace('ai sdr', 'AI SDR');
const user = (id: unknown) => {
  const name = userDisplayName(str(id));
  return name === '—' ? undefined : name;
};

function triggerText(a: Automation, l: Lookups): string {
  const c = a.triggerConfig ?? {};
  const fallback = sentence(TRIGGER_OPTIONS.find((o) => o.value === a.triggerType)?.label ?? humanize(a.triggerType));
  switch (a.triggerType) {
    case 'no_activity':
      return c.days ? `No activity for ${c.days} ${Number(c.days) === 1 ? 'day' : 'days'}` : fallback;
    case 'lead_score_threshold': {
      const n = str(c.scoreGt) ?? str(c.threshold);
      return n ? `Lead score above ${n}` : fallback;
    }
    case 'lead_stage_changed': {
      const from = l.stage(c.fromStageId);
      const to = l.stage(c.toStageId);
      if (from && to) return `Stage ${from} → ${to}`;
      if (to) return `Moved to ${to}`;
      if (from) return `Moved out of ${from}`;
      return fallback;
    }
    case 'tag_added': {
      const t = l.tag(c.tagId);
      return t ? `Tagged ${t}` : fallback;
    }
    case 'form_submitted': {
      const f = l.form(c.formId);
      return f ? `${f} submitted` : fallback;
    }
    default:
      return fallback;
  }
}

function delayText(c: Record<string, unknown>): string {
  const unit = str(c.unit) ?? (c.days ? 'days' : c.hours ? 'hours' : c.minutes ? 'minutes' : 'hours');
  const amount = Number(c.amount ?? c[unit] ?? 1);
  return `Wait ${amount}${unit.charAt(0)}`;
}

const OPERATOR: Record<string, string> = { gte: '≥', gt: '>', lte: '≤', lt: '<', eq: '=', equals: '=', neq: '≠', contains: 'contains' };

function conditionText(c: Record<string, unknown>, l: Lookups): string {
  const value = str(c.value);
  const field = str(c.fieldName) ?? str(c.field);
  switch (c.conditionType) {
    case 'source_is': return `Source is ${value ?? '…'}`;
    case 'source_is_not': return `Source is not ${value ?? '…'}`;
    case 'ad_form_is':
    case 'ad_form_is_not': {
      const n = Array.isArray(c.values) ? c.values.length : 0;
      return `Ad form ${c.conditionType === 'ad_form_is' ? 'is' : 'is not'} one of ${n}`;
    }
    case 'has_tag': return `Has tag ${l.tag(value) ?? '…'}`;
    case 'not_has_tag': return `Lacks tag ${l.tag(value) ?? '…'}`;
    case 'field_equals': return `${humanize(field ?? 'field')} = ${value ?? '…'}`;
    case 'field_contains': return `${humanize(field ?? 'field')} contains ${value ?? '…'}`;
    case 'field_is_empty': return `${humanize(field ?? 'field')} is empty`;
    case 'score_gt': return `Score > ${value ?? '…'}`;
    case 'score_lt': return `Score < ${value ?? '…'}`;
    case 'assigned_to': return `Assigned to ${user(value) ?? 'a user'}`;
    case 'unassigned': return 'Unassigned';
  }
  if (field) return `${humanize(field)} ${OPERATOR[str(c.operator) ?? 'eq'] ?? str(c.operator)} ${value ?? ''}`.trim();
  return sentence(CONDITION_OPTIONS.find((o) => o.value === c.conditionType)?.label ?? 'Condition');
}

const ACTION_ICON: Record<string, LucideIcon> = {
  assign_lead: UserCog, assign: UserCog, add_tag: Tag, remove_tag: Tag, change_stage: GitBranch, update_field: PenLine,
  set_priority: PenLine, create_followup: CalendarPlus, create_follow_up: CalendarPlus, send_email: Mail,
  enroll_in_sdr_agent: Bot, enroll_in_sequence: ListOrdered,
};

function actionText(c: Record<string, unknown>, l: Lookups): string {
  const action = str(c.action) ?? '';
  switch (action) {
    case 'assign_lead':
    case 'assign': {
      const mode = str(c.assignMode) ?? str(c.mode);
      const ids = Array.isArray(c.assignUserIds) ? (c.assignUserIds as string[]) : [];
      if (mode === 'specific') return `Assign to ${user(ids[0]) ?? 'a user'}`;
      if (mode === 'round_robin') return ids.length ? `Round-robin across ${ids.length}` : 'Assign round-robin';
      if (mode === 'sequence') return 'Assign in turn';
      if (mode === 'team') return `Assign to ${refTeams.find((t) => t.id === c.assignTeamId)?.name ?? 'a team'}`;
      if (mode === 'hierarchy') return `Assign within ${user(c.assignManagerId) ?? 'a manager'}'s team`;
      return 'Assign lead';
    }
    case 'add_tag': return `Add tag ${l.tag(c.tagId) ?? '…'}`;
    case 'remove_tag': return `Remove tag ${l.tag(c.tagId) ?? '…'}`;
    case 'change_stage': return `Move to ${l.stage(c.stageId) ?? 'a stage'}`;
    case 'update_field': return `Set ${humanize(str(c.field) ?? 'field')} to ${str(c.value) ?? '…'}`;
    case 'set_priority': return `Set priority ${humanize(str(c.priority) ?? '…')}`;
    case 'create_followup':
    case 'create_follow_up': return str(c.title) ? `Follow-up: ${c.title}` : 'Create follow-up';
    case 'send_email': return str(c.subject) ? `Email: ${c.subject}` : 'Send email';
  }
  return sentence(ACTION_OPTIONS.find((o) => o.value === action)?.label ?? (action ? humanize(action) : 'Action'));
}

function flowOf(a: Automation, l: Lookups): FlowChip[] {
  const steps = [...a.steps].sort((x, y) => (x.sortOrder ?? 0) - (y.sortOrder ?? 0));
  return [
    { kind: 'trigger', text: triggerText(a, l), icon: Zap },
    ...steps.map((s: AutomationStep): FlowChip => {
      const c = s.config ?? {};
      if (s.type === 'delay') return { kind: 'delay', text: delayText(c), icon: Clock3 };
      if (s.type === 'condition') return { kind: 'condition', text: `If ${conditionText(c, l)}`, icon: Filter };
      return { kind: 'action', text: actionText(c, l), icon: ACTION_ICON[str(c.action) ?? ''] ?? Zap };
    }),
  ];
}

const CHIP_STYLE: Record<ChipKind, string> = {
  trigger: 'border-warning-100 bg-warning-50 text-warning-700',
  condition: 'border-info-100 bg-info-50 text-info-700',
  delay: 'border-dashed border-line-strong bg-surface text-ink-subtle',
  action: 'border-success-100 bg-success-50 text-success-700',
};

/** The automation drawn left to right: trigger, then each step, joined by short rules. */
function Flow({ chips }: { chips: FlowChip[] }) {
  return (
    // A column on a phone (joined by short vertical rules), a row from sm up.
    <ol className="flex flex-col items-start sm:flex-row sm:flex-wrap sm:items-center sm:gap-y-2" aria-label="Steps">
      {chips.map((c, i) => (
        <li key={i} className="flex min-w-0 max-w-full flex-col items-start sm:flex-row sm:items-center">
          {i > 0 && <span aria-hidden="true" className="ml-3.5 h-2 w-px shrink-0 bg-line-strong sm:ml-0 sm:h-px sm:w-4" />}
          <span
            title={c.text}
            className={cn('inline-flex h-7 min-w-0 max-w-[18rem] items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium', CHIP_STYLE[c.kind])}
          >
            <c.icon size={12} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{c.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------------------------

export function Automations() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Automation | null>(null);
  const [tab, setTab] = useState('automations');
  const [runAutomationFilter, setRunAutomationFilter] = useState('all');
  const [runStatusFilter, setRunStatusFilter] = useState<AutomationRunEntry['status'] | 'all'>('all');
  const [runPage, setRunPage] = useState(1);

  const { data: automations, isLoading } = useAsync(() => listAutomations(), [reloadKey]);
  const runParams = { page: runPage, pageSize: RUNS_PAGE_SIZE, automationId: runAutomationFilter, status: runStatusFilter, sortBy: 'ranAt', sortDir: 'desc' as const };
  const { data: runs, isLoading: runsLoading } = useAsync(() => listAutomationRuns(runParams), [JSON.stringify(runParams), reloadKey]);

  // Names for the ids a trigger or step points at, so a card reads "Move to Qualified", not an id.
  const { stageById, tags } = usePipelineReferenceData();
  const needsForms = (automations ?? []).some((a) => a.triggerType === 'form_submitted' && a.triggerConfig?.formId);
  const { data: forms } = useAsync(() => (needsForms ? listForms({ pageSize: 200 }) : Promise.resolve(null)), [needsForms]);
  const lookups = useMemo<Lookups>(
    () => ({
      stage: (id) => stageById(str(id))?.name,
      tag: (id) => tags.find((t) => t.id === str(id))?.name,
      form: (id) => forms?.items.find((f) => f.id === str(id))?.name,
    }),
    [stageById, tags, forms]
  );

  const activeCount = (automations ?? []).filter((a) => a.enabled).length;
  const totalRuns = (automations ?? []).reduce((sum, a) => sum + (a.runCount ?? 0), 0);

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

  const runColumns: DataTableColumn<AutomationRunEntry>[] = [
    {
      key: 'ranAt',
      header: 'When',
      render: (r) => <span className="whitespace-nowrap tabular-nums text-ink-muted" title={formatDateTime(r.ranAt)}>{formatRelativeTime(r.ranAt)}</span>,
    },
    { key: 'automation', header: 'Automation', render: (r) => <span className="font-medium text-ink">{r.automationName}</span> },
    {
      key: 'lead',
      header: 'Lead',
      render: (r) => (
        <Link to={`/crm/leads/${r.leadId}`} className="rounded text-ink hover:text-brand-700 hover:underline focus-ring">
          {r.leadName || r.leadId}
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge dot tone={r.status === 'success' ? 'success' : r.status === 'failed' ? 'danger' : r.status === 'waiting' ? 'info' : 'neutral'}>
          {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
        </Badge>
      ),
    },
    {
      key: 'message',
      header: 'Detail',
      render: (r) => (
        <span className="text-xs text-ink-muted">
          {r.message}
          {r.status === 'waiting' && r.resumeAt && <span className="text-info-700"> · resumes {formatDateTime(r.resumeAt)}</span>}
        </span>
      ),
    },
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

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: 'automations', label: 'Automations', icon: <Zap size={14} />, badge: automations?.length },
          { key: 'runs', label: 'Run History', icon: <History size={14} />, badge: runs?.total },
        ]}
      >
        {(active) => (
          <div className="pt-1">
            {active === 'automations' && (
              isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
                </div>
              ) : !automations || automations.length === 0 ? (
                <Card padded={false}>
                  <EmptyState
                    icon={Zap}
                    title="No automations yet"
                    description="Create one to assign, tag, or follow up on leads automatically."
                    action={<Button variant="primary" size="sm" leftIcon={<Plus size={13} />} onClick={() => navigate('/crm/automation/new')}>New Automation</Button>}
                  />
                </Card>
              ) : (
                <>
                  <p className="mb-2.5 text-xs tabular-nums text-ink-subtle">
                    {activeCount} of {automations.length} active · {totalRuns.toLocaleString('en-IN')} runs in total
                  </p>
                  <ul className="space-y-3">
                    {automations.map((a) => {
                      const steps = a.steps.length;
                      return (
                        <li key={a.id}>
                          <Card
                            padded={false}
                            onClick={() => navigate(`/crm/automation/${a.id}/edit`)}
                            className="cursor-pointer px-4 py-3.5 transition-colors duration-100 hover:border-line-strong"
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Link
                                    to={`/crm/automation/${a.id}/edit`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="rounded text-[13px] font-semibold text-ink hover:text-brand-700 focus-ring"
                                  >
                                    {a.name}
                                  </Link>
                                </div>
                                {a.description && <p className="mt-0.5 text-sm text-ink-muted">{a.description}</p>}
                                <p className="mt-1 text-xs tabular-nums text-ink-subtle">
                                  {(a.runCount ?? 0).toLocaleString('en-IN')} {a.runCount === 1 ? 'run' : 'runs'}
                                  {' · '}{steps} {steps === 1 ? 'step' : 'steps'}
                                  {a.respectBusinessHours && ' · business hours respected'}
                                  {' · '}updated {formatRelativeTime(a.updatedAt)}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <Toggle label={`${a.name} active`} showLabel={false} checked={a.enabled} onChange={() => handleToggle(a)} />
                                <span className="mr-2 w-11 text-xs text-ink-muted">{a.enabled ? 'Active' : 'Paused'}</span>
                                <Button variant="ghost" size="sm" leftIcon={<Pencil size={13} />} onClick={() => navigate(`/crm/automation/${a.id}/edit`)}>
                                  Edit
                                </Button>
                                <Button variant="ghost" size="sm" className="text-danger-600" leftIcon={<Trash2 size={13} />} onClick={() => setDeleteTarget(a)}>
                                  Delete
                                </Button>
                              </div>
                            </div>
                            <div className={cn('mt-3', !a.enabled && 'opacity-70')}>
                              <Flow chips={flowOf(a, lookups)} />
                            </div>
                          </Card>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )
            )}

            {active === 'runs' && (
              <Card padded={false}>
                <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5 lg:flex-row lg:items-center">
                  <Select
                    aria-label="Automation"
                    value={runAutomationFilter}
                    onChange={(e) => { setRunAutomationFilter(e.target.value); setRunPage(1); }}
                    options={[{ value: 'all', label: 'All Automations' }, ...(automations ?? []).map((a) => ({ value: a.id, label: a.name }))]}
                    wrapperClassName="w-full sm:w-56"
                  />
                  <FilterChips
                    label="Run status"
                    items={STATUS_CHIPS}
                    value={runStatusFilter}
                    onChange={(k) => { setRunStatusFilter(k as AutomationRunEntry['status'] | 'all'); setRunPage(1); }}
                  />
                  <span className="text-xs text-ink-faint lg:ml-auto">
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
                {runs && runs.total > RUNS_PAGE_SIZE && <Pagination page={runPage} pageSize={RUNS_PAGE_SIZE} total={runs.total} onPageChange={setRunPage} />}
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
