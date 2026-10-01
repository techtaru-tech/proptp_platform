import { mayAssignLeads, mayUnassignLeads, userDisplayName } from '../../data/referenceData';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Phone, MessageCircle, Edit2, Star, Plus, Check, X as XIcon, RotateCcw,
  UserCog, GitBranch, Flag, StickyNote, Activity as ActivityIcon, MoonStar,
} from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Input } from '../../components/ui/Input';
import { Avatar } from '../../components/ui/Avatar';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Badge } from '../../components/ui/Badge';
import { Tabs, type TabItem } from '../../components/ui/Tabs';
import { Modal } from '../../components/ui/Modal';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { Timeline, type TimelineEntry } from '../../components/ui/Timeline';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { LeadSourceBadge } from '../../components/leads/LeadSourceBadge';
import {
  LeadContactFields, LeadRequirementFields, LeadDetailsFields, LeadDealFields,
  leadToFormValues, validateLeadForm, leadFormValuesToPayload, type LeadFormValues,
} from './LeadForm';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  getLead, updateLead, updateLeadStatus, moveLeadStage, assignLead, toggleStar, listAssignableUsers, getLeadHistory,
} from '../../services/leadService';
import { getLeadActivities, getLeadNotes, addLeadNote, logManualActivity } from '../../services/activityService';
import { getFollowUpsForLead, createFollowUp, updateFollowUpStatus, rescheduleFollowUp } from '../../services/followUpService';
import { usePipelineReferenceData } from '../../hooks/usePipelineReferenceData';
import { getConnection } from '../../services/integrationService';
import { getTelephonySettings, placeCall } from '../../services/callService';
import { formatCurrency, formatDate, formatDateTime, formatRelativeTime, leadFullName } from '../../utils/format';
import type { LeadActivityType, LeadStatus } from '../../types';

const ACTIVITY_TYPE_OPTIONS: { value: LeadActivityType; label: string }[] = [
  { value: 'call_logged', label: 'Call' },
  { value: 'email_sent', label: 'Email Sent' },
  { value: 'email_received', label: 'Email Received' },
  { value: 'meeting_scheduled', label: 'Meeting / Site Visit Scheduled' },
];

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

export function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const refetch = () => setReloadKey((k) => k + 1);

  const handleClickToCall = async () => {
    if (!lead) return;
    setCalling(true);
    try {
      const result = await placeCall({ leadId: lead.id });
      toast({ title: 'Call placed', description: `${result.message} Answer your phone — it rings you first.`, variant: 'success' });
      refetch();
    } catch (err) {
      toast({ title: 'Could not place the call', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setCalling(false);
    }
  };

  const { data: lead, isLoading, error } = useAsync(() => getLead(id ?? ''), [id, reloadKey]);
  const { data: telephony } = useAsync(() => getTelephonySettings().catch(() => undefined), []);
  const [calling, setCalling] = useState(false);
  const { data: activities } = useAsync(() => getLeadActivities(id ?? ''), [id, reloadKey]);
  const { data: notes } = useAsync(() => getLeadNotes(id ?? ''), [id, reloadKey]);
  const { data: followUps } = useAsync(() => getFollowUpsForLead(id ?? ''), [id, reloadKey]);
  const { data: history } = useAsync(() => getLeadHistory(id ?? ''), [id, reloadKey]);
  const { data: connection } = useAsync(
    () => (lead?.sourceConnectionId ? getConnection(lead.sourceConnectionId) : Promise.resolve(undefined)),
    [lead?.sourceConnectionId]
  );

  const assignableUsers = listAssignableUsers();
  const { pipelines, stageById, pipelineById, tagsByIds, stagesForPipeline } = usePipelineReferenceData();

  // ---- Edit modal ----
  const [editOpen, setEditOpen] = useState(false);
  const [editValues, setEditValues] = useState<LeadFormValues | null>(null);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // ---- Assign / stage / status drawers-as-modals ----
  const [assignValue, setAssignValue] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [stagePipeline, setStagePipeline] = useState('');
  const [stageValue, setStageValue] = useState('');
  const [stageOpen, setStageOpen] = useState(false);
  const [statusValue, setStatusValue] = useState<LeadStatus>('new');
  const [lostReason, setLostReason] = useState('');
  const [statusOpen, setStatusOpen] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState(false);

  // ---- Note / Activity / Follow-up composers ----
  const [noteBody, setNoteBody] = useState('');
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityType, setActivityType] = useState<LeadActivityType>('call_logged');
  const [activityDesc, setActivityDesc] = useState('');
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpTitle, setFollowUpTitle] = useState('');
  const [followUpDue, setFollowUpDue] = useState('');
  const [rescheduleTarget, setRescheduleTarget] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');

  const openEdit = () => {
    if (!lead) return;
    setEditValues(leadToFormValues(lead));
    setEditErrors({});
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editValues || !lead) return;
    const errors = validateLeadForm(editValues);
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    try {
      await updateLead(lead.id, leadFormValuesToPayload(editValues));
      toast({ title: 'Lead updated', variant: 'success' });
      setEditOpen(false);
      refetch();
    } finally {
      setSaving(false);
    }
  };

  const handleAssign = async () => {
    if (!lead) return;
    await assignLead(lead.id, assignValue || undefined);
    toast({ title: 'Lead reassigned', variant: 'success' });
    setAssignOpen(false);
    refetch();
  };

  const handleMoveStage = async () => {
    if (!lead || !stagePipeline || !stageValue) return;
    await moveLeadStage(lead.id, stagePipeline, stageValue);
    toast({ title: 'Stage updated', variant: 'success' });
    setStageOpen(false);
    refetch();
  };

  const handleChangeStatus = async () => {
    if (!lead) return;
    await updateLeadStatus(lead.id, statusValue, statusValue === 'lost' ? lostReason : undefined);
    toast({ title: 'Status updated', variant: 'success' });
    setStatusOpen(false);
    refetch();
  };

  const handleToggleStar = async () => {
    if (!lead) return;
    await toggleStar(lead.id);
    refetch();
  };

  const handleAddNote = async () => {
    if (!lead || !noteBody.trim()) return;
    await addLeadNote(lead.id, noteBody.trim());
    setNoteBody('');
    toast({ title: 'Note added', variant: 'success' });
    refetch();
  };

  const handleAddActivity = async () => {
    if (!lead || !activityDesc.trim()) return;
    await logManualActivity(lead.id, activityType, activityDesc.trim());
    setActivityDesc('');
    setActivityOpen(false);
    toast({ title: 'Activity logged', variant: 'success' });
    refetch();
  };

  const handleAddFollowUp = async () => {
    if (!lead || !followUpTitle.trim() || !followUpDue) return;
    await createFollowUp({
      leadId: lead.id,
      title: followUpTitle.trim(),
      dueAt: new Date(followUpDue).toISOString(),
      priority: lead.priority,
      assignedUserId: lead.assignedUserId,
    });
    setFollowUpTitle('');
    setFollowUpDue('');
    setFollowUpOpen(false);
    toast({ title: 'Follow-up scheduled', variant: 'success' });
    refetch();
  };

  const handleCompleteFollowUp = async (taskId: string) => {
    await updateFollowUpStatus(taskId, 'completed');
    toast({ title: 'Follow-up completed', variant: 'success' });
    refetch();
  };

  const handleCancelFollowUp = async (taskId: string) => {
    await updateFollowUpStatus(taskId, 'missed');
    toast({ title: 'Follow-up marked as missed', variant: 'info' });
    refetch();
  };

  const handleReschedule = async () => {
    if (!rescheduleTarget || !rescheduleDate) return;
    await rescheduleFollowUp(rescheduleTarget, new Date(rescheduleDate).toISOString());
    setRescheduleTarget(null);
    setRescheduleDate('');
    toast({ title: 'Follow-up rescheduled', variant: 'success' });
    refetch();
  };

  const historyEntries: TimelineEntry[] = useMemo(() => {
    if (!history) return [];
    const userName = (userId?: string) => (userId ? assignableUsers.find((u) => u.id === userId)?.name ?? userId : 'Unassigned');
    const stageEntries = history.stageHistory.map((h) => ({
      id: h.id,
      title: `Stage: ${h.fromStageName ?? 'Unassigned'} → ${h.toStageName}`,
      description: h.actorName ? `by ${h.actorName}` : undefined,
      timestamp: h.createdAt,
      tone: 'info' as const,
    }));
    const assignmentEntries = history.assignmentHistory.map((h) => ({
      id: h.id,
      title: `Assigned: ${userName(h.fromUserId)} → ${userName(h.toUserId)}`,
      description: h.actorName ? `by ${h.actorName}` : undefined,
      timestamp: h.createdAt,
      tone: 'neutral' as const,
    }));
    return [...stageEntries, ...assignmentEntries].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Lead" breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Leads', to: '/crm/leads' }, { label: id ?? '' }]} />
        <CardSkeleton />
      </div>
    );
  }

  if (error || !lead) {
    return (
      <div>
        <PageHeader title="Lead" breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Leads', to: '/crm/leads' }]} />
        <Card>
          {error ? (
            <ErrorState onRetry={refetch} />
          ) : (
            <EmptyState
              title="Lead not found"
              description="This lead does not exist or may have been removed."
              action={
                <Button variant="outline" onClick={() => navigate('/crm/leads')}>
                  Back to Leads
                </Button>
              }
            />
          )}
        </Card>
      </div>
    );
  }

  const stage = lead.pipelineStageId ? stageById(lead.pipelineStageId) : undefined;
  const pipeline = lead.pipelineId ? pipelineById(lead.pipelineId) : undefined;
  const assignee = assignableUsers.find((u) => u.id === lead.assignedUserId);
  const tags = tagsByIds(lead.tagIds);
  const stagesForCurrentPipeline = stagePipeline ? stagesForPipeline(stagePipeline) : lead.pipelineId ? stagesForPipeline(lead.pipelineId) : [];

  const tabItems: TabItem[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'activities', label: 'Activities', icon: <ActivityIcon size={13} />, badge: activities?.length || undefined },
    { key: 'followups', label: 'Follow-ups', badge: followUps?.filter((f) => f.status === 'pending').length || undefined },
    { key: 'notes', label: 'Notes', icon: <StickyNote size={13} />, badge: notes?.length || undefined },
    { key: 'history', label: 'History', icon: <GitBranch size={13} /> },
  ];

  return (
    <div>
      <PageHeader
        title={leadFullName(lead)}
        description={`Lead ${lead.id} · Created ${formatDate(lead.createdAt)}`}
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Leads', to: '/crm/leads' }, { label: leadFullName(lead) }]}
        actions={
          <>
            <StatusBadge kind="leadStatus" status={lead.status} />
            <StatusBadge kind="leadPriority" status={lead.priority} dot={false} />
            {lead.receivedOutsideBusinessHours && (
              <span title="This lead arrived while Business Hours (Settings > Business Hours) marked the office closed.">
                <Badge tone="shell">
                  <MoonStar size={12} />
                  Outside Business Hours
                </Badge>
              </span>
            )}
          </>
        }
      />

      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <Avatar name={leadFullName(lead)} size="lg" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-ink">{leadFullName(lead)}</h2>
                <button onClick={handleToggleStar} aria-label="Toggle star" className="text-ink-faint hover:text-warning-500 focus-ring rounded">
                  <Star size={16} className={lead.isStarred ? 'fill-warning-500 text-warning-500' : ''} />
                </button>
              </div>
              <p className="mt-0.5 text-sm text-ink-muted">
                {lead.phone} {lead.email && `· ${lead.email}`} {lead.city && `· ${lead.city}`}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <LeadSourceBadge source={lead.source} otherSource={lead.otherSource} />
                {stage && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink-muted">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: stage.color }} />
                    {pipeline?.name} · {stage.name}
                  </span>
                )}
                {tags.map((t) => (
                  <span key={t.id} className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `${t.color}1a`, color: t.color }}>
                    {t.name}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Click-to-call through the virtual number: the provider rings the agent first,
                then the customer, and the call lands in Call History. Falls back to the
                handset dialler when telephony is off. */}
            {telephony?.enabled ? (
              <Button variant="outline" size="sm" leftIcon={<Phone size={13} />} isLoading={calling} onClick={handleClickToCall}>
                Call
              </Button>
            ) : (
              <a href={`tel:${lead.phone}`}>
                <Button variant="outline" size="sm" leftIcon={<Phone size={13} />}>
                  Call
                </Button>
              </a>
            )}
            <a href={`https://wa.me/${whatsAppNumber(lead.phone)}`} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm" leftIcon={<MessageCircle size={13} />}>
                WhatsApp
              </Button>
            </a>
            <Button variant="outline" size="sm" leftIcon={<Edit2 size={13} />} onClick={openEdit}>
              Edit
            </Button>
          </div>
        </div>
      </Card>

      <Tabs items={tabItems}>
        {(activeKey) => (
          <>
            {activeKey === 'overview' && (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Deal Information" subtitle="Expected value and timeline" />
                  <dl className="space-y-2.5 text-sm">
                    <Row label="Deal Value" value={lead.dealValue ? formatCurrency(lead.dealValue) : '—'} />
                    <Row label="Expected Close" value={lead.expectedCloseDate ? formatDate(lead.expectedCloseDate) : '—'} />
                    <Row label="Lead Score" value={lead.leadScore} />
                    <Row label="Next Follow-up" value={lead.nextFollowUpAt ? formatDate(lead.nextFollowUpAt) : '—'} />
                    {lead.status === 'won' && <Row label="Won Value" value={lead.wonValue ? formatCurrency(lead.wonValue) : '—'} />}
                    {lead.status === 'lost' && <Row label="Lost Reason" value={lead.lostReason ?? '—'} />}
                  </dl>
                  {lead.notes && (
                    <div className="mt-4 border-t border-line pt-4">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Notes (from creation)</p>
                      <p className="text-sm text-ink-muted">{lead.notes}</p>
                    </div>
                  )}
                </Card>

                <Card>
                  <CardHeader title="Lead Management" subtitle="Ownership, stage and status" />
                  <div className="space-y-3">
                    <ManagementRow icon={UserCog} label="Assigned To" value={assignee?.name ?? (lead.assignedUserId ? userDisplayName(lead.assignedUserId) : lead.assignedTo ?? 'Unassigned')} onClick={mayAssignLeads() ? () => { setAssignValue(lead.assignedUserId ?? ''); setAssignOpen(true); } : undefined} />
                    <ManagementRow icon={GitBranch} label="Pipeline Stage" value={stage ? `${pipeline?.name} · ${stage.name}` : 'Unassigned'} onClick={() => { setStagePipeline(lead.pipelineId ?? pipelines[0]?.id ?? ""); setStageValue(lead.pipelineStageId ?? ''); setStageOpen(true); }} />
                    <ManagementRow icon={Flag} label="Status" value={<StatusBadge kind="leadStatus" status={lead.status} dot={false} />} onClick={() => { setStatusValue(lead.status); setLostReason(lead.lostReason ?? ''); setStatusOpen(true); }} />
                  </div>
                </Card>

                <Card className="lg:col-span-2">
                  <CardHeader title="Requirement" subtitle="What they are looking for" />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                    <Row label="Purpose" value={lead.purpose ?? '—'} />
                    <Row label="Property Type" value={lead.propertyType ?? '—'} />
                    <Row label="Budget Range" value={lead.budgetRange ?? '—'} />
                    <Row label="Preferred Location" value={lead.preferredLocations?.length ? lead.preferredLocations.join(', ') : '—'} />
                  </div>
                </Card>

                {(lead.source === 'meta' || lead.adDetail) && (
                  <Card className="lg:col-span-2">
                    <CardHeader
                      title="Which ad this came from"
                      subtitle="Straight from Meta, recorded when the lead arrived"
                    />
                    {lead.adDetail ? (
                      // Only what Meta actually told us. Campaign, ad set and ad arrive only for a
                      // connection carrying `ads_read`; until then a row each of dashes says nothing.
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Row label="Lead Form" value={lead.adDetail.formName ?? '—'} hint={lead.adDetail.formId ?? undefined} />
                        {lead.adDetail.campaignName && (
                          <Row label="Campaign" value={lead.adDetail.campaignName} hint={lead.adDetail.campaignId ?? undefined} />
                        )}
                        {lead.adDetail.adsetName && (
                          <Row label="Ad Set" value={lead.adDetail.adsetName} hint={lead.adDetail.adsetId ?? undefined} />
                        )}
                        {lead.adDetail.adName && (
                          <Row label="Ad" value={lead.adDetail.adName} hint={lead.adDetail.adId ?? undefined} />
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <Row label="Campaign" value={lead.utmCampaign ?? '—'} />
                        <div className="sm:col-span-2 text-sm text-ink-faint">
                          Ad set and ad were not recorded for this lead — it arrived before the CRM
                          started keeping them. Everything from here on has the full breakdown.
                        </div>
                      </div>
                    )}
                  </Card>
                )}

                {(lead.customFields?.length ?? 0) > 0 && (
                  <Card className="lg:col-span-2">
                    <CardHeader
                      title="Form Answers"
                      subtitle="Questions the lead form asked that the built-in fields have no home for"
                    />
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      {lead.customFields!.map((f) => (
                        <Row key={f.key} label={f.label} value={f.value || '—'} />
                      ))}
                    </div>
                  </Card>
                )}

                {(lead.utmSource || lead.externalLeadId || lead.sourceConnectionId) && (
                  <Card className="lg:col-span-2">
                    <CardHeader
                      title="Lead Attribution"
                      subtitle="Which campaign and connection this lead came from — read-only, matching how the source system captures it"
                    />
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <Row label="Campaign" value={lead.utmCampaign ?? '—'} />
                      <Row label="Medium" value={lead.utmMedium ?? '—'} />
                      <Row label="Content" value={lead.utmContent ?? '—'} />
                      <Row label="Term" value={lead.utmTerm ?? '—'} />
                      <Row label="Landing Page" value={lead.landingPage ?? '—'} />
                      <Row label="Referrer" value={lead.referrerUrl ?? '—'} />
                      <Row label="External Lead ID" value={lead.externalLeadId ?? '—'} />
                      <Row
                        label="Received Via"
                        value={
                          connection ? (
                            <Link to="/crm/integrations" className="text-brand-600 hover:text-brand-700">
                              {connection.name}
                            </Link>
                          ) : (
                            '—'
                          )
                        }
                      />
                    </div>
                  </Card>
                )}
              </div>
            )}

            {activeKey === 'activities' && (
              <Card>
                <CardHeader
                  title="Activity Timeline"
                  subtitle="Everything that has happened on this lead"
                  action={
                    <Button variant="outline" size="sm" leftIcon={<Plus size={13} />} onClick={() => setActivityOpen(true)}>
                      Add Activity
                    </Button>
                  }
                />
                {!activities || activities.length === 0 ? (
                  <EmptyState title="No activity yet" description="Calls, emails, notes and stage changes will appear here." />
                ) : (
                  <Timeline
                    entries={activities.map((a) => ({
                      id: a.id,
                      title: a.description,
                      description: a.userName ? `by ${a.userName}` : undefined,
                      timestamp: a.createdAt,
                      tone: a.type === 'status_changed' && a.metadata?.to === 'lost' ? 'danger' : a.type === 'status_changed' && a.metadata?.to === 'won' ? 'success' : 'neutral',
                    }))}
                  />
                )}
              </Card>
            )}

            {activeKey === 'followups' && (
              <Card>
                <CardHeader
                  title="Follow-ups"
                  subtitle="Scheduled tasks for this lead"
                  action={
                    <Button variant="outline" size="sm" leftIcon={<Plus size={13} />} onClick={() => setFollowUpOpen(true)}>
                      Add Follow-up
                    </Button>
                  }
                />
                {!followUps || followUps.length === 0 ? (
                  <EmptyState title="No follow-ups scheduled" description="Add one to keep this lead moving." />
                ) : (
                  <div className="space-y-2.5">
                    {followUps.map((t) => (
                      <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3.5 py-2.5">
                        <div>
                          <p className="text-sm font-medium text-ink">{t.title}</p>
                          <p className="text-xs text-ink-faint">Due {formatDateTime(t.dueAt)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge kind="followUpStatus" status={t.status} />
                          {(t.status === 'pending' || t.status === 'rescheduled') && (
                            <>
                              <Button variant="outline" size="sm" leftIcon={<Check size={12} />} onClick={() => handleCompleteFollowUp(t.id)}>
                                Complete
                              </Button>
                              <Button variant="ghost" size="sm" leftIcon={<RotateCcw size={12} />} onClick={() => { setRescheduleTarget(t.id); setRescheduleDate(''); }}>
                                Reschedule
                              </Button>
                              <Button variant="ghost" size="sm" leftIcon={<XIcon size={12} />} onClick={() => handleCancelFollowUp(t.id)} className="text-danger-600">
                                Cancel
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {activeKey === 'notes' && (
              <Card>
                <CardHeader title="Notes" subtitle="Manual notes added by the team" />
                <div className="mb-4 flex items-end gap-2.5">
                  <Input wrapperClassName="flex-1" value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder="Write a note..." />
                  <Button variant="primary" onClick={handleAddNote} disabled={!noteBody.trim()}>
                    Add Note
                  </Button>
                </div>
                {!notes || notes.length === 0 ? (
                  <EmptyState title="No notes yet" description="Notes added by the team will show up here." />
                ) : (
                  <div className="space-y-3">
                    {notes.map((n) => (
                      <div key={n.id} className="rounded-lg bg-surface-subtle px-3.5 py-2.5">
                        <p className="text-sm text-ink">{n.body}</p>
                        <p className="mt-1 text-xs text-ink-faint">
                          {n.userName} · {formatRelativeTime(n.createdAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {activeKey === 'history' && (
              <Card>
                <CardHeader title="Stage & Assignment History" subtitle="Audit trail of ownership and pipeline movement" />
                {historyEntries.length === 0 ? (
                  <EmptyState title="No history yet" description="Stage and assignment changes will be recorded here." />
                ) : (
                  <Timeline entries={historyEntries} />
                )}
              </Card>
            )}
          </>
        )}
      </Tabs>

      {/* Edit modal */}
      {editValues && (
        <Modal
          isOpen={editOpen}
          onClose={() => setEditOpen(false)}
          title="Edit Lead"
          size="lg"
          footer={
            <>
              <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSaveEdit} isLoading={saving}>
                Save Changes
              </Button>
            </>
          }
        >
          <div className="space-y-6">
            <LeadContactFields values={editValues} errors={editErrors} onChange={(p) => setEditValues((v) => (v ? { ...v, ...p } : v))} />
            <div className="border-t border-line pt-5">
              <LeadRequirementFields values={editValues} errors={editErrors} onChange={(p) => setEditValues((v) => (v ? { ...v, ...p } : v))} />
            </div>
            <div className="border-t border-line pt-5">
              <LeadDetailsFields values={editValues} onChange={(p) => setEditValues((v) => (v ? { ...v, ...p } : v))} />
            </div>
            <div className="border-t border-line pt-5">
              <LeadDealFields values={editValues} errors={editErrors} onChange={(p) => setEditValues((v) => (v ? { ...v, ...p } : v))} />
            </div>
          </div>
        </Modal>
      )}

      {/* Assign modal */}
      <Modal
        isOpen={assignOpen}
        onClose={() => setAssignOpen(false)}
        title="Reassign Lead"
        footer={
          <>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleAssign}>
              Save
            </Button>
          </>
        }
      >
        <Select label="Assigned to" value={assignValue} onChange={(e) => setAssignValue(e.target.value)} options={[...(mayUnassignLeads() ? [{ value: '', label: 'Unassigned' }] : []), ...assignableUsers.map((u) => ({ value: u.id, label: u.name }))]} />
      </Modal>

      {/* Stage modal */}
      <Modal
        isOpen={stageOpen}
        onClose={() => setStageOpen(false)}
        title="Change Pipeline Stage"
        footer={
          <>
            <Button variant="outline" onClick={() => setStageOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleMoveStage} disabled={!stagePipeline || !stageValue}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select label="Pipeline" value={stagePipeline} onChange={(e) => { setStagePipeline(e.target.value); setStageValue(''); }} options={pipelines.map((p) => ({ value: p.id, label: p.name }))} />
          <Select
            label="Stage"
            value={stageValue}
            onChange={(e) => setStageValue(e.target.value)}
            disabled={!stagePipeline}
            hint={!stagePipeline ? 'Choose a pipeline first.' : undefined}
            options={[{ value: '', label: 'Select a stage' }, ...stagesForCurrentPipeline.map((s) => ({ value: s.id, label: s.name }))]}
          />
        </div>
      </Modal>

      {/* Status modal */}
      <Modal
        isOpen={statusOpen}
        onClose={() => setStatusOpen(false)}
        title="Change Status"
        footer={
          <>
            <Button variant="outline" onClick={() => setStatusOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => { setStatusOpen(false); setConfirmStatus(true); }} disabled={statusValue === 'lost' && !lostReason.trim()}>
              Continue
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select label="New status" value={statusValue} onChange={(e) => setStatusValue(e.target.value as LeadStatus)} options={STATUS_OPTIONS} />
          {statusValue === 'lost' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-ink">
                Lost reason<span className="text-danger-500"> *</span>
              </label>
              <textarea
                rows={3}
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                className="w-full rounded-lg border border-line-strong bg-white px-3 py-2 text-sm text-ink focus-ring"
                placeholder="Why was this lead lost?"
              />
            </div>
          )}
        </div>
      </Modal>

      <ConfirmationDialog
        isOpen={confirmStatus}
        onClose={() => setConfirmStatus(false)}
        onConfirm={handleChangeStatus}
        title="Confirm status change"
        description={`Change ${leadFullName(lead)}'s status from "${lead.status}" to "${statusValue}"?`}
        confirmLabel="Confirm"
        variant={statusValue === 'lost' ? 'danger' : 'primary'}
        audited
      />

      {/* Add activity modal */}
      <Modal
        isOpen={activityOpen}
        onClose={() => setActivityOpen(false)}
        title="Add Activity"
        footer={
          <>
            <Button variant="outline" onClick={() => setActivityOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleAddActivity} disabled={!activityDesc.trim()}>
              Log Activity
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select label="Type" value={activityType} onChange={(e) => setActivityType(e.target.value as LeadActivityType)} options={ACTIVITY_TYPE_OPTIONS} />
          <Input label="Description" value={activityDesc} onChange={(e) => setActivityDesc(e.target.value)} placeholder="e.g. Discussed pricing, will follow up Friday" />
        </div>
      </Modal>

      {/* Add follow-up modal */}
      <Modal
        isOpen={followUpOpen}
        onClose={() => setFollowUpOpen(false)}
        title="Add Follow-up"
        footer={
          <>
            <Button variant="outline" onClick={() => setFollowUpOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleAddFollowUp} disabled={!followUpTitle.trim() || !followUpDue}>
              Schedule
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Title" value={followUpTitle} onChange={(e) => setFollowUpTitle(e.target.value)} placeholder="e.g. Confirm site visit" />
          <Input label="Due date & time" type="datetime-local" value={followUpDue} onChange={(e) => setFollowUpDue(e.target.value)} />
        </div>
      </Modal>

      {/* Reschedule modal */}
      <Modal
        isOpen={!!rescheduleTarget}
        onClose={() => setRescheduleTarget(null)}
        title="Reschedule Follow-up"
        footer={
          <>
            <Button variant="outline" onClick={() => setRescheduleTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleReschedule} disabled={!rescheduleDate}>
              Save
            </Button>
          </>
        }
      >
        <Input label="New due date & time" type="datetime-local" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} />
      </Modal>
    </div>
  );
}

/**
 * wa.me wants digits with a country code and nothing else. Leads arrive with theirs written
 * every possible way — `+919799224345` from Meta, ten bare digits typed by hand — and pasting
 * a `+` or a second 91 into the URL is what was sending people to WhatsApp's 404 page.
 */
function whatsAppNumber(phone: string): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;
}

function Row({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-medium text-ink" title={hint}>
        {value}
      </dd>
    </div>
  );
}

function ManagementRow({ icon: Icon, label, value, onClick }: { icon: typeof UserCog; label: string; value: ReactNode; onClick?: () => void }) {
  // Without a handler the row is information, not a control — an Employee can read who owns a
  // lead but has no way to hand it on, so it must not look like it opens something.
  if (!onClick) {
    return (
      <div className="flex w-full items-center justify-between gap-3 rounded-lg border border-line px-3.5 py-2.5">
        <span className="flex items-center gap-2.5 text-sm text-ink-muted">
          <Icon size={15} className="text-ink-faint" />
          {label}
        </span>
        <span className="text-sm font-medium text-ink">{value}</span>
      </div>
    );
  }
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between gap-3 rounded-lg border border-line px-3.5 py-2.5 text-left hover:border-brand-300 focus-ring">
      <span className="flex items-center gap-2.5 text-sm text-ink-muted">
        <Icon size={15} className="text-ink-faint" />
        {label}
      </span>
      <span className="text-sm font-medium text-ink">{value}</span>
    </button>
  );
}
