import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MessageCircle, Pause, Pencil, Play, Square, UserPlus } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { StatCard } from '../../components/ui/StatCard';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { usePipelineReferenceData } from '../../hooks/usePipelineReferenceData';
import { LEAD_PRIORITY_OPTIONS, LEAD_STATUS_OPTIONS } from '../../services/leadService';
import {
  countAudience, DRIP_ENROLLMENT_TONE, DRIP_STATUS_TONE, enrollByFilter, getDrip, listDripEnrollments, listDripSends,
  setDripStatus, stopDripEnrollment,
} from '../../services/whatsappDripService';
import { formatDateTime, formatRelativeTime } from '../../utils/format';
import type { BroadcastLeadFilter, WhatsAppDripEnrollment } from '../../types';

const SOURCE_OPTIONS = [
  { value: 'all', label: 'All Sources' },
  { value: 'meta', label: 'Meta Lead Ads' },
  { value: 'web_form', label: 'Web Form' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'manual', label: 'Manual' },
  { value: 'referral', label: 'Referral' },
];

export function WhatsAppDripDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { pipelines, stagesForPipeline } = usePipelineReferenceData();
  const [reloadKey, setReloadKey] = useState(0);
  const [threadFor, setThreadFor] = useState<WhatsAppDripEnrollment | null>(null);
  const [filter, setFilter] = useState<BroadcastLeadFilter>({});
  const [audience, setAudience] = useState<{ count: number; overLimit: boolean; limit: number } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const reload = () => setReloadKey((k) => k + 1);

  const { data: drip, isLoading, error } = useAsync(() => getDrip(id ?? ''), [id, reloadKey]);
  const { data: enrollments, isLoading: enrollmentsLoading } = useAsync(() => listDripEnrollments(id ?? ''), [id, reloadKey]);
  const { data: sends } = useAsync(() => (threadFor ? listDripSends(threadFor.id) : Promise.resolve([])), [threadFor?.id]);

  const filterKey = useMemo(() => JSON.stringify(filter), [filter]);
  // Recount whenever the filter changes, so Enrol always states a number that is current.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      countAudience(filter)
        .then((r) => !cancelled && setAudience(r))
        .catch(() => !cancelled && setAudience(null));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  if (isLoading) return <CardSkeleton />;
  if (error || !drip) return <ErrorState title="Campaign not found" description={error?.message ?? 'It may have been deleted.'} />;

  const patchFilter = (next: Partial<BroadcastLeadFilter>) => setFilter((prev) => ({ ...prev, ...next }));
  const steps = drip.steps ?? [];

  const toggle = async () => {
    const next = drip.status === 'active' ? 'paused' : 'active';
    try {
      await setDripStatus(drip.id, next);
      toast({ title: next === 'active' ? 'Campaign is live' : 'Campaign paused', variant: 'success' });
      reload();
    } catch (err) {
      toast({ title: 'Could not change status', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    }
  };

  const enroll = async () => {
    setConfirmOpen(false);
    setEnrolling(true);
    try {
      const result = await enrollByFilter(drip.id, filter);
      toast({ title: result.message, variant: result.enrolled > 0 ? 'success' : 'warning' });
      reload();
    } catch (err) {
      toast({ title: 'Could not enrol', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setEnrolling(false);
    }
  };

  const columns: DataTableColumn<WhatsAppDripEnrollment>[] = [
    {
      key: 'lead',
      header: 'Lead',
      render: (e) => (
        <div>
          <p className="font-medium text-ink">{e.leadName}</p>
          <p className="text-xs text-ink-faint">{e.leadPhone}</p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (e) => <Badge tone={DRIP_ENROLLMENT_TONE[e.status]}>{e.status}</Badge> },
    { key: 'progress', header: 'Progress', align: 'center', render: (e) => <span className="text-sm text-ink">{e.sendCount}<span className="text-ink-faint"> / {drip.stepCount} sent</span></span> },
    {
      key: 'next',
      header: 'Next step',
      render: (e) =>
        e.status !== 'active' ? <span className="text-xs text-ink-faint">{e.stoppedReason ?? '—'}</span>
          : e.nextSendAt ? <span className="text-sm text-ink-muted">{formatRelativeTime(e.nextSendAt)}</span> : '—',
    },
    { key: 'enrolled', header: 'Enrolled', render: (e) => formatDateTime(e.createdAt) },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (e) => (
        <div className="flex justify-end gap-1" onClick={(evt) => evt.stopPropagation()}>
          <Button variant="ghost" size="sm" leftIcon={<MessageCircle size={13} />} onClick={() => setThreadFor(e)}>Messages</Button>
          {e.status === 'active' && (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Square size={13} />}
              onClick={async () => {
                await stopDripEnrollment(e.id);
                toast({ title: 'Stopped', description: `${e.leadName} will get no further steps.`, variant: 'success' });
                reload();
              }}
            >
              Stop
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={drip.name}
        description={drip.description}
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'WhatsApp Drips', to: '/crm/whatsapp-drips' }, { label: drip.name }]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" leftIcon={drip.status === 'active' ? <Pause size={14} /> : <Play size={14} />} onClick={toggle}>
              {drip.status === 'active' ? 'Pause' : 'Start'}
            </Button>
            <Button variant="outline" leftIcon={<Pencil size={14} />} onClick={() => navigate(`/crm/whatsapp-drips/${drip.id}/edit`)}>Edit</Button>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Status" value={drip.status} tone={DRIP_STATUS_TONE[drip.status] === 'success' ? 'success' : 'neutral'} />
        <StatCard label="Steps" value={String(drip.stepCount)} />
        <StatCard label="Active" value={String(drip.activeEnrollments)} tone="info" />
        <StatCard label="Completed" value={String(drip.completedEnrollments)} tone="success" />
      </div>

      {drip.status !== 'active' && (
        <p className="mb-5 rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          This campaign is {drip.status}. Leads you enrol wait where they are — nothing is sent until you press Start.
        </p>
      )}

      <Card className="mb-5">
        <CardHeader title="The sequence" subtitle="What each lead receives, in order" />
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={s.id ?? i} className="flex flex-wrap items-baseline gap-2 text-sm">
              <Badge tone="brand">Step {i + 1}</Badge>
              <span className="font-medium text-ink">{s.templateName}</span>
              <span className="text-ink-muted">
                {i === 0 ? 'after enrolment' : 'after the previous step'}: {s.delayDays}d {s.delayHours}h
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <Card className="mb-5">
        <CardHeader title="Enrol leads" subtitle="Everyone matching this filter joins the campaign. Leads already in it, or without a valid mobile number, are skipped." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Select label="Status" value={filter.status ?? 'all'} onChange={(e) => patchFilter({ status: e.target.value })} options={LEAD_STATUS_OPTIONS} />
          <Select label="Priority" value={filter.priority ?? 'all'} onChange={(e) => patchFilter({ priority: e.target.value })} options={LEAD_PRIORITY_OPTIONS} />
          <Select label="Source" value={filter.source ?? 'all'} onChange={(e) => patchFilter({ source: e.target.value })} options={SOURCE_OPTIONS} />
          <Select
            label="Pipeline"
            value={filter.pipelineId ?? 'all'}
            onChange={(e) => patchFilter({ pipelineId: e.target.value, stageId: 'all' })}
            options={[{ value: 'all', label: 'All Pipelines' }, ...pipelines.map((p) => ({ value: p.id, label: p.name }))]}
          />
          <Select
            label="Stage"
            value={filter.stageId ?? 'all'}
            onChange={(e) => patchFilter({ stageId: e.target.value })}
            options={[
              { value: 'all', label: 'All Stages' },
              ...(filter.pipelineId && filter.pipelineId !== 'all' ? stagesForPipeline(filter.pipelineId).map((s) => ({ value: s.id, label: s.name })) : []),
            ]}
          />
          <Input label="Search" value={filter.search ?? ''} onChange={(e) => patchFilter({ search: e.target.value })} placeholder="Name, phone or email" />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-subtle px-3.5 py-3">
          <span className="text-sm">
            {audience ? (
              <span className={audience.overLimit ? 'text-warning-700' : 'text-ink'}>
                <strong>{audience.count}</strong> lead{audience.count === 1 ? '' : 's'} match{audience.count === 1 ? 'es' : ''}
                {audience.overLimit && ` — over the limit of ${audience.limit}, narrow the filter`}
              </span>
            ) : (
              <span className="text-ink-faint">Counting…</span>
            )}
          </span>
          <Button variant="primary" leftIcon={<UserPlus size={14} />} isLoading={enrolling} disabled={!audience || audience.count === 0 || audience.overLimit} onClick={() => setConfirmOpen(true)}>
            Enrol {audience?.count ?? 0}
          </Button>
        </div>
      </Card>

      <Card padded={false}>
        <DataTable columns={columns} rows={enrollments ?? []} rowKey={(e) => e.id} isLoading={enrollmentsLoading} emptyTitle="No leads enrolled" emptyDescription="Use the filter above to enrol leads." />
      </Card>

      <ConfirmationDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={enroll}
        title={`Enrol ${audience?.count ?? 0} lead${audience?.count === 1 ? '' : 's'}?`}
        description={drip.status === 'active' ? 'These are real WhatsApp messages to real people, starting as soon as the first step is due.' : 'The campaign is not started yet, so nothing is sent until you press Start.'}
        confirmLabel="Enrol them"
      />

      <Modal isOpen={!!threadFor} onClose={() => setThreadFor(null)} title={threadFor ? `Messages to ${threadFor.leadName}` : ''} size="lg">
        {(sends ?? []).length === 0 ? (
          <p className="text-sm text-ink-faint">Nothing has gone out for this lead yet.</p>
        ) : (
          <div className="space-y-3">
            {(sends ?? []).map((send) => (
              <div key={send.id} className="rounded-lg border border-line p-3">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-ink">Step {send.stepIndex + 1} · {send.templateName}</p>
                  <Badge tone={send.status === 'sent' ? 'success' : 'danger'}>{send.status}</Badge>
                </div>
                {send.body && <p className="whitespace-pre-wrap text-sm text-ink-muted">{send.body}</p>}
                <p className="mt-2 text-xs text-ink-faint">{formatDateTime(send.sentAt)}{send.message ? ` · ${send.message}` : ''}</p>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
