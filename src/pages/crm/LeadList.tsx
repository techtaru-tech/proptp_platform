import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Bot, Download, Filter, GitBranch, MailPlus, MoonStar, Plus, Star, Tag as TagIcon, Trash2, Upload, UserCog, X, Zap } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { TemperatureBadge } from '../../components/leads/TemperatureBadge';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Input } from '../../components/ui/Input';
import { Avatar } from '../../components/ui/Avatar';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Drawer } from '../../components/ui/Drawer';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { Pagination } from '../../components/ui/Pagination';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { FilterBar } from '../../components/tables/FilterBar';
import { LeadSourceBadge } from '../../components/leads/LeadSourceBadge';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../context/ToastContext';
import {
  listLeads, listAssignableUsers, listSourceOptions, LEAD_TEMPERATURE_OPTIONS, toggleStar, deleteLead,
  bulkAssign, bulkChangeStatus, bulkChangePriority, bulkChangeSource, bulkAddTag, bulkRemoveTag, bulkMoveStage, bulkDelete,
  listLeadIds,
  listAdSources,
  type LeadListParams,
  LEAD_STATUS_OPTIONS,
  LEAD_PRIORITY_OPTIONS,
} from '../../services/leadService';
import { listManualAutomations, runAutomationOnLeads } from '../../services/leadAutomationService';
import { mayAssignLeads, mayUnassignLeads } from '../../data/referenceData';
import { enrollLeadsInSdrAgent, listSdrAgents } from '../../services/aiSdrService';
import { enrollLeadsInSequence, listEmailSequences } from '../../services/emailSequenceService';
import { usePipelineReferenceData } from '../../hooks/usePipelineReferenceData';
import { exportToCsv } from '../../services/reportService';
import { formatDate, formatTime, leadFullName } from '../../utils/format';
import type { Automation, EmailSequence, Lead, LeadPriority, LeadSource, LeadStatus, LeadTemperature } from '../../types';

/** The server caps a page at 100, so the picker must not offer more. */
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function LeadList() {
  const navigate = useNavigate();
  // The Team Leaders and Hierarchy pages link here with `?assignedUserId=` to show one person's leads.
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { pipelines, tags, stageById, stagesForPipeline } = usePipelineReferenceData();

  const [page, setPage] = useState(1);
  // Remembered per browser: an admin who works fifty at a time should not re-pick every visit.
  const [pageSize, setPageSize] = useState(() => {
    const saved = Number(localStorage.getItem('crm.leads.pageSize'));
    return PAGE_SIZE_OPTIONS.includes(saved) ? saved : 10;
  });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<LeadStatus | 'all'>('all');
  const [priority, setPriority] = useState<LeadPriority | 'all'>('all');
  const [temperature, setTemperature] = useState<LeadTemperature | 'none' | 'all'>('all');
  const [source, setSource] = useState('all');
  const [pipelineId, setPipelineId] = useState('all');
  const [stageId, setStageId] = useState('all');
  const [assignedUserId, setAssignedUserId] = useState(searchParams.get('assignedUserId') || 'all');
  const [starredOnly, setStarredOnly] = useState(false);
  const [campaignName, setCampaignName] = useState('all');
  const [adName, setAdName] = useState('all');
  const [formName, setFormName] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [lastActivityFrom, setLastActivityFrom] = useState('');
  const [lastActivityTo, setLastActivityTo] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);

  const [bulkModal, setBulkModal] = useState<'assign' | 'status' | 'priority' | 'source' | 'tag' | 'remove_tag' | 'move_stage' | 'run_automation' | 'enroll_sdr' | 'enroll_sequence' | null>(null);
  const [bulkValue, setBulkValue] = useState('');
  const [bulkStagePipeline, setBulkStagePipeline] = useState('');
  const [sequences, setSequences] = useState<EmailSequence[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [rowDeleteTarget, setRowDeleteTarget] = useState<Lead | null>(null);
  const [manualAutomations, setManualAutomations] = useState<Automation[]>([]);
  const [sdrAgents, setSdrAgents] = useState<{ id: string; name: string; active: boolean }[]>([]);

  const debouncedSearch = useDebounce(search, 300);
  const assignableUsers = listAssignableUsers();

  const params: LeadListParams = {
    page,
    pageSize,
    search: debouncedSearch,
    status,
    priority,
    temperature,
    source: source as LeadListParams['source'],
    pipelineId,
    stageId,
    assignedUserId,
    starred: starredOnly || undefined,
    campaignName,
    adName,
    formName,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    lastActivityFrom: lastActivityFrom || undefined,
    lastActivityTo: lastActivityTo || undefined,
    sortBy,
    sortDir,
  };

  const { data, isLoading, error } = useAsync(() => listLeads(params), [JSON.stringify(params), reloadKey]);
  // Loaded once: the list of ads that have produced leads changes far more slowly than the list.
  const { data: adSources } = useAsync(() => listAdSources().catch(() => undefined), [reloadKey]);

  const stagesForSelectedPipeline = pipelineId !== 'all' ? stagesForPipeline(pipelineId) : [];

  const hasActiveFilters = useMemo(
    () => !!(search || status !== 'all' || priority !== 'all' || temperature !== 'all' || source !== 'all' || pipelineId !== 'all' || stageId !== 'all' || assignedUserId !== 'all' || starredOnly || campaignName !== 'all' || adName !== 'all' || formName !== 'all' || dateFrom || dateTo || lastActivityFrom || lastActivityTo),
    [search, status, priority, temperature, source, pipelineId, stageId, assignedUserId, starredOnly, campaignName, adName, formName, dateFrom, dateTo, lastActivityFrom, lastActivityTo]
  );

  const resetFilters = () => {
    setSearch('');
    setStatus('all');
    setPriority('all');
    setSource('all');
    setPipelineId('all');
    setStageId('all');
    setAssignedUserId('all');
    setStarredOnly(false);
    setDateFrom('');
    setDateTo('');
    setLastActivityFrom('');
    setLastActivityTo('');
    setPage(1);
  };

  const activeFilterChips = [
    status !== 'all' && { key: 'status', label: `Status: ${status}`, clear: () => setStatus('all') },
    priority !== 'all' && { key: 'priority', label: `Priority: ${priority}`, clear: () => setPriority('all') },
    temperature !== 'all' && { key: 'temperature', label: `Temperature: ${temperature === 'none' ? 'not rated' : temperature}`, clear: () => setTemperature('all') },
    source !== 'all' && { key: 'source', label: `Source: ${listSourceOptions().find((s) => s.value === source)?.label ?? source}`, clear: () => setSource('all') },
    pipelineId !== 'all' && { key: 'pipeline', label: `Pipeline: ${pipelines.find((p) => p.id === pipelineId)?.name}`, clear: () => { setPipelineId('all'); setStageId('all'); } },
    stageId !== 'all' && { key: 'stage', label: `Stage: ${stageById(stageId)?.name}`, clear: () => setStageId('all') },
    assignedUserId !== 'all' && { key: 'assignee', label: `Assigned: ${assignedUserId === 'none' ? 'Unassigned' : assignableUsers.find((u) => u.id === assignedUserId)?.name ?? '…'}`, clear: () => setAssignedUserId('all') },
    starredOnly && { key: 'starred', label: 'Starred only', clear: () => setStarredOnly(false) },
    campaignName !== 'all' && { key: 'campaign', label: `Campaign: ${campaignName}`, clear: () => setCampaignName('all') },
    adName !== 'all' && { key: 'ad', label: `Ad: ${adName}`, clear: () => setAdName('all') },
    formName !== 'all' && { key: 'form', label: `Form: ${formName}`, clear: () => setFormName('all') },
    (dateFrom || dateTo) && {
      key: 'created',
      label: `Created: ${dateFrom || 'any'} → ${dateTo || 'any'}`,
      clear: () => { setDateFrom(''); setDateTo(''); },
    },
    (lastActivityFrom || lastActivityTo) && {
      key: 'lastActivity',
      label: `Last activity: ${lastActivityFrom || 'any'} → ${lastActivityTo || 'any'}`,
      clear: () => { setLastActivityFrom(''); setLastActivityTo(''); },
    },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[];

  const handleSortChange = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(key);
      setSortDir('asc');
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleSelected = (data?.items.length ?? 0) > 0 && data!.items.every((l) => selectedIds.has(l.id));
  /** True once every lead the filter matches is selected, not just the page on screen. */
  const allMatchingSelected = !!data && selectedIds.size >= data.total;
  const [selectingAll, setSelectingAll] = useState(false);

  const selectAllMatching = async () => {
    setSelectingAll(true);
    try {
      const { ids, total, capped, limit } = await listLeadIds(params);
      setSelectedIds(new Set(ids));
      toast({
        title: `${ids.length} leads selected`,
        description: capped
          ? `The filter matches ${total}, and a bulk action takes ${limit} at a time. Narrow it to reach the rest.`
          : undefined,
        variant: capped ? 'warning' : 'success',
      });
    } catch (err) {
      toast({ title: 'Could not select them all', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setSelectingAll(false);
    }
  };
  const toggleSelectAll = () => {
    if (!data) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) data.items.forEach((l) => next.delete(l.id));
      else data.items.forEach((l) => next.add(l.id));
      return next;
    });
  };

  const openBulkModal = async (modal: NonNullable<typeof bulkModal>) => {
    setBulkModal(modal);
    setBulkValue('');
    setBulkStagePipeline('');
    if (modal === 'run_automation') {
      setManualAutomations(await listManualAutomations());
    }
    if (modal === 'enroll_sequence') {
      setSequences((await listEmailSequences()).filter((q) => q.status === 'active' && q.stepCount > 0));
    }
    if (modal === 'enroll_sdr') {
      setSdrAgents((await listSdrAgents()).filter((a) => a.active).map((a) => ({ id: a.id, name: a.name, active: a.active })));
    }
  };

  const runBulkAction = async () => {
    const ids = Array.from(selectedIds);
    if (bulkModal === 'assign' && bulkValue) {
      const { assigned, skipped } = await bulkAssign(ids, bulkValue);
      toast({
        title: `${assigned} lead(s) assigned`,
        description: skipped > 0 ? `${skipped} were outside your team and left alone.` : undefined,
        variant: 'success',
      });
    } else if (bulkModal === 'status' && bulkValue) {
      await bulkChangeStatus(ids, bulkValue as LeadStatus);
      toast({ title: `${ids.length} lead(s) status updated`, variant: 'success' });
    } else if (bulkModal === 'priority' && bulkValue) {
      await bulkChangePriority(ids, bulkValue as LeadPriority);
      toast({ title: `${ids.length} lead(s) priority updated`, variant: 'success' });
    } else if (bulkModal === 'source' && bulkValue) {
      await bulkChangeSource(ids, bulkValue as LeadSource);
      toast({ title: `${ids.length} lead(s) source updated`, variant: 'success' });
    } else if (bulkModal === 'tag' && bulkValue) {
      await bulkAddTag(ids, bulkValue);
      toast({ title: `Tag added to ${ids.length} lead(s)`, variant: 'success' });
    } else if (bulkModal === 'remove_tag' && bulkValue) {
      await bulkRemoveTag(ids, bulkValue);
      toast({ title: `Tag removed from ${ids.length} lead(s)`, variant: 'success' });
    } else if (bulkModal === 'move_stage' && bulkValue) {
      await bulkMoveStage(ids, bulkStagePipeline, bulkValue);
      toast({ title: `${ids.length} lead(s) moved to a new stage`, variant: 'success' });
    } else if (bulkModal === 'enroll_sdr' && bulkValue) {
      const result = await enrollLeadsInSdrAgent(bulkValue, ids);
      toast({
        title: `${result.enrolled} lead(s) enrolled`,
        description: result.skipped > 0 ? `${result.skipped} skipped — already enrolled with this agent.` : undefined,
        variant: 'success',
      });
    } else if (bulkModal === 'enroll_sequence' && bulkValue) {
      const result = await enrollLeadsInSequence(bulkValue, ids);
      toast({
        title: `${result.enrolled} lead(s) enrolled`,
        description: result.skipped > 0 ? result.message : undefined,
        variant: 'success',
      });
    } else if (bulkModal === 'run_automation' && bulkValue) {
      const result = await runAutomationOnLeads(bulkValue, ids);
      toast({
        title: `Automation queued for ${result.queued} lead(s)`,
        description: result.skipped > 0 ? `${result.skipped} lead(s) were skipped (already assigned, or no eligible assignee).` : undefined,
        variant: 'success',
      });
    }
    setBulkModal(null);
    setBulkValue('');
    setSelectedIds(new Set());
    setReloadKey((k) => k + 1);
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    await bulkDelete(ids);
    toast({ title: `${ids.length} lead(s) deleted`, variant: 'success' });
    setSelectedIds(new Set());
    setReloadKey((k) => k + 1);
  };

  const handleToggleStar = async (lead: Lead) => {
    await toggleStar(lead.id);
    setReloadKey((k) => k + 1);
  };

  const handleRowDelete = async () => {
    if (!rowDeleteTarget) return;
    await deleteLead(rowDeleteTarget.id);
    toast({ title: 'Lead deleted', variant: 'success' });
    setRowDeleteTarget(null);
    setReloadKey((k) => k + 1);
  };

  const handleExport = () => {
    exportToCsv(
      'leads.csv',
      (data?.items ?? []).map((l) => ({
        id: l.id,
        name: leadFullName(l),
        phone: l.phone,
        email: l.email ?? '',
        source: l.source,
        status: l.status,
        priority: l.priority,
        temperature: l.temperature ?? '',
        originalSource: l.originalSource ?? '',
        dealValue: l.dealValue ?? '',
        createdAt: l.createdAt,
      }))
    );
  };

  const columns: DataTableColumn<Lead>[] = [
    {
      key: 'select',
      header: (
        <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} aria-label="Select all leads on this page" className="h-4 w-4 rounded border-line-strong text-brand-600 focus-ring" />
      ),
      width: '40px',
      render: (l) => (
        <input
          type="checkbox"
          checked={selectedIds.has(l.id)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleSelected(l.id)}
          aria-label={`Select ${leadFullName(l)}`}
          className="h-4 w-4 rounded border-line-strong text-brand-600 focus-ring"
        />
      ),
    },
    {
      key: 'name',
      header: 'Lead',
      sortable: true,
      render: (l) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={leadFullName(l)} size="sm" />
          {/* A real link, so the browser's own "open in new tab" works on the row. The whole
              block, not just the name: a lead without one would leave an empty link behind. */}
          <Link to={`/crm/leads/${l.id}`} onClick={(e) => e.stopPropagation()} className="min-w-0 rounded focus-ring">
            <p className="flex items-center gap-1 font-medium text-ink">
              {leadFullName(l)}
              {l.isStarred && <Star size={12} className="fill-warning-500 text-warning-500" />}
              {l.receivedOutsideBusinessHours && (
                <MoonStar size={12} className="text-shell-400" aria-label="Received outside business hours" />
              )}
            </p>
            <p className="text-xs text-ink-faint">{l.phone}</p>
          </Link>
        </div>
      ),
    },
    { key: 'source', header: 'Source', render: (l) => <LeadSourceBadge source={l.source} otherSource={l.otherSource} /> },
    { key: 'status', header: 'Status', render: (l) => <StatusBadge kind="leadStatus" status={l.status} /> },
    { key: 'priority', header: 'Priority', render: (l) => <StatusBadge kind="leadPriority" status={l.priority} dot={false} /> },
    { key: 'temperature', header: 'Temperature', render: (l) => <TemperatureBadge value={l.temperature} /> },
    {
      key: 'stage',
      header: 'Stage',
      render: (l) => {
        const stage = l.pipelineStageId ? stageById(l.pipelineStageId) : undefined;
        return stage ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: stage.color }} />
            {stage.name}
          </span>
        ) : (
          <span className="text-xs text-ink-faint">Unassigned</span>
        );
      },
    },
    {
      key: 'assignedTo',
      header: 'Assigned To',
      render: (l) => {
        const user = assignableUsers.find((u) => u.id === l.assignedUserId);
        return user ? user.name : l.assignedTo ? <span className="text-ink-faint">{l.assignedTo}</span> : <span className="text-ink-faint">Unassigned</span>;
      },
    },
    { key: 'nextFollowUpAt', header: 'Next Follow-up', sortable: true, render: (l) => (l.nextFollowUpAt ? formatDate(l.nextFollowUpAt) : '—') },
    {
      key: 'createdAt',
      header: 'Created',
      sortable: true,
      render: (l) => (
        <span className="whitespace-nowrap">
          {formatDate(l.createdAt)}
          <span className="block text-xs text-ink-faint">{formatTime(l.createdAt)}</span>
        </span>
      ),
    },
    {
      key: 'lastActivity',
      header: 'Last Activity',
      render: (l) =>
        l.lastActivity ? (
          <span className="whitespace-nowrap" title={l.lastActivity.description}>
            {formatDate(l.lastActivity.at)}
            <span className="block text-xs text-ink-faint">{formatTime(l.lastActivity.at)}</span>
          </span>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (l) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => handleToggleStar(l)}
            aria-label={l.isStarred ? 'Unstar lead' : 'Star lead'}
            className="rounded p-1.5 text-ink-faint hover:bg-surface-muted hover:text-warning-500 focus-ring"
          >
            <Star size={14} className={l.isStarred ? 'fill-warning-500 text-warning-500' : ''} />
          </button>
          <button
            type="button"
            onClick={() => setRowDeleteTarget(l)}
            aria-label="Delete lead"
            className="rounded p-1.5 text-ink-faint hover:bg-danger-50 hover:text-danger-600 focus-ring"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Leads"
        description="All incoming leads across every source, pipeline and stage."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Leads' }]}
        actions={
          <>
            <Button variant="outline" leftIcon={<Upload size={14} />} onClick={() => navigate('/crm/leads/import')}>
              Import
            </Button>
            <Button variant="outline" leftIcon={<Download size={14} />} onClick={handleExport}>
              Export
            </Button>
            <Button variant="primary" leftIcon={<Plus size={15} />} onClick={() => navigate('/crm/leads/new')}>
              Add Lead
            </Button>
          </>
        }
      />

      {selectedIds.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2.5">
          <span className="text-sm font-medium text-brand-700">{selectedIds.size} selected</span>
          {/* Only offered once the page is fully ticked — before that, "select all" is a
              surprise rather than the obvious next step. */}
          {allVisibleSelected && !allMatchingSelected && (data?.total ?? 0) > selectedIds.size && (
            <button
              type="button"
              onClick={selectAllMatching}
              disabled={selectingAll}
              className="text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 focus-ring disabled:opacity-60"
            >
              {selectingAll ? 'Selecting…' : `Select all ${data?.total} matching this filter`}
            </button>
          )}
          {allMatchingSelected && (
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 focus-ring"
            >
              Clear selection
            </button>
          )}
          {mayAssignLeads() && (
            <Button variant="outline" size="sm" leftIcon={<UserCog size={13} />} onClick={() => openBulkModal('assign')}>
              Assign
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => openBulkModal('status')}>
            Change Status
          </Button>
          <Button variant="outline" size="sm" onClick={() => openBulkModal('priority')}>
            Change Priority
          </Button>
          <Button variant="outline" size="sm" onClick={() => openBulkModal('source')}>
            Change Source
          </Button>
          <Button variant="outline" size="sm" leftIcon={<GitBranch size={13} />} onClick={() => openBulkModal('move_stage')}>
            Move Stage
          </Button>
          <Button variant="outline" size="sm" leftIcon={<TagIcon size={13} />} onClick={() => openBulkModal('tag')}>
            Add Tag
          </Button>
          <Button variant="outline" size="sm" leftIcon={<TagIcon size={13} />} onClick={() => openBulkModal('remove_tag')}>
            Remove Tag
          </Button>
          <Button variant="outline" size="sm" leftIcon={<Bot size={13} />} onClick={() => openBulkModal('enroll_sdr')}>
            Enroll in AI SDR
          </Button>
          <Button variant="outline" size="sm" leftIcon={<MailPlus size={13} />} onClick={() => openBulkModal('enroll_sequence')}>
            Enroll in Sequence
          </Button>
          <Button variant="outline" size="sm" leftIcon={<Zap size={13} />} onClick={() => openBulkModal('run_automation')}>
            Run Automation
          </Button>
          <Button variant="danger" size="sm" leftIcon={<Trash2 size={13} />} onClick={() => setBulkDeleteOpen(true)}>
            Delete
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<X size={13} />} onClick={() => setSelectedIds(new Set())} className="ml-auto">
            Clear selection
          </Button>
        </div>
      )}

      <Card padded={false}>
        <FilterBar
          search={search}
          onSearchChange={(v) => { setSearch(v); setPage(1); }}
          searchPlaceholder="Search by name, phone, email or lead ID..."
          onReset={resetFilters}
          hasActiveFilters={hasActiveFilters}
          actions={
            <Button variant="outline" leftIcon={<Filter size={14} />} onClick={() => setFiltersOpen(true)}>
              Filters {hasActiveFilters && `(${activeFilterChips.length})`}
            </Button>
          }
        />

        {activeFilterChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
            {activeFilterChips.map((chip) => (
              <button
                key={chip.key}
                onClick={() => { chip.clear(); setPage(1); }}
                className="flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink-muted hover:bg-line-DEFAULT"
              >
                {chip.label}
                <X size={11} />
              </button>
            ))}
          </div>
        )}

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(l) => l.id}
          isLoading={isLoading}
          error={error}
          onRetry={() => setReloadKey((k) => k + 1)}
          onRowClick={(l) => navigate(`/crm/leads/${l.id}`)}
          rowHref={(l) => `/crm/leads/${l.id}`}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={handleSortChange}
          emptyTitle="No leads found"
          emptyDescription="Try adjusting your filters, or add a new lead."
        />

        {data && data.total > 0 && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={data.total}
            onPageChange={setPage}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageSizeChange={(size) => {
              setPageSize(size);
              // Page 9 of ten-at-a-time does not exist at a hundred at a time.
              setPage(1);
              localStorage.setItem('crm.leads.pageSize', String(size));
            }}
          />
        )}
      </Card>

      <Drawer isOpen={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        <div className="space-y-4">
          <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value as LeadStatus | 'all'); setPage(1); }} options={LEAD_STATUS_OPTIONS} />
          <Select label="Temperature" name="temperatureFilter" value={temperature} onChange={(e) => { setTemperature(e.target.value as LeadTemperature | 'none' | 'all'); setPage(1); }} options={LEAD_TEMPERATURE_OPTIONS} />
          <Select label="Priority" value={priority} onChange={(e) => { setPriority(e.target.value as LeadPriority | 'all'); setPage(1); }} options={LEAD_PRIORITY_OPTIONS} />
          <Select
            label="Ad form"
            value={formName}
            onChange={(e) => { setFormName(e.target.value); setPage(1); }}
            options={[
              { value: 'all', label: 'All Forms' },
              ...(adSources?.forms ?? []).map((f) => ({ value: f.name, label: `${f.name} (${f.count})` })),
            ]}
            hint="Each ad runs its own lead form, so this is the closest thing to filtering by ad."
          />
          {/* Both appear on their own the day Meta starts naming campaigns and ads for this
              connection. Until then they would be dropdowns with one empty option. */}
          {(adSources?.campaigns.length ?? 0) > 0 && (
            <Select
              label="Ad campaign"
              value={campaignName}
              onChange={(e) => { setCampaignName(e.target.value); setPage(1); }}
              options={[
                { value: 'all', label: 'All Campaigns' },
                ...(adSources?.campaigns ?? []).map((c) => ({ value: c.name, label: `${c.name} (${c.count})` })),
              ]}
            />
          )}
          {(adSources?.ads.length ?? 0) > 0 && (
            <Select
              label="Ad"
              value={adName}
              onChange={(e) => { setAdName(e.target.value); setPage(1); }}
              options={[
                { value: 'all', label: 'All Ads' },
                ...(adSources?.ads ?? []).map((a) => ({ value: a.name, label: `${a.name} (${a.count})` })),
              ]}
            />
          )}
          <Select
            label="Source"
            value={source}
            onChange={(e) => { setSource(e.target.value); setPage(1); }}
            options={[{ value: 'all', label: 'All Sources' }, ...listSourceOptions()]}
          />
          <Select
            label="Pipeline"
            value={pipelineId}
            onChange={(e) => { setPipelineId(e.target.value); setStageId('all'); setPage(1); }}
            options={[{ value: 'all', label: 'All Pipelines' }, ...pipelines.map((p) => ({ value: p.id, label: p.name }))]}
          />
          <Select
            label="Stage"
            value={stageId}
            onChange={(e) => { setStageId(e.target.value); setPage(1); }}
            disabled={pipelineId === 'all'}
            hint={pipelineId === 'all' ? 'Choose a pipeline first.' : undefined}
            options={[{ value: 'all', label: 'All Stages' }, ...stagesForSelectedPipeline.map((s) => ({ value: s.id, label: s.name }))]}
          />
          <Select
            label="Assigned To"
            name="assignedUserId"
            value={assignedUserId}
            onChange={(e) => { setAssignedUserId(e.target.value); setPage(1); }}
            options={[
              { value: 'all', label: 'Anyone' },
              ...(mayUnassignLeads() ? [{ value: 'none', label: 'Unassigned' }] : []),
              ...assignableUsers.map((u) => ({ value: u.id, label: u.name })),
            ]}
          />
          <div className="space-y-2 border-t border-line pt-4">
            <p className="text-sm font-medium text-ink">Created</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="From" type="date" max={dateTo || undefined} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
              <Input label="To" type="date" min={dateFrom || undefined} value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Last activity</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="From" type="date" max={lastActivityTo || undefined} value={lastActivityFrom} onChange={(e) => { setLastActivityFrom(e.target.value); setPage(1); }} />
              <Input label="To" type="date" min={lastActivityFrom || undefined} value={lastActivityTo} onChange={(e) => { setLastActivityTo(e.target.value); setPage(1); }} />
            </div>
            <p className="text-xs text-ink-faint">
              Matches the lead's newest activity, so a lead last touched before this window is left out.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={starredOnly}
              onChange={(e) => { setStarredOnly(e.target.checked); setPage(1); }}
              className="h-4 w-4 rounded border-line-strong text-brand-600 focus-ring"
            />
            Starred only
          </label>
          <div className="flex gap-2 border-t border-line pt-4">
            <Button variant="outline" className="flex-1" onClick={resetFilters}>
              Clear all
            </Button>
            <Button variant="primary" className="flex-1" onClick={() => setFiltersOpen(false)}>
              Apply
            </Button>
          </div>
        </div>
      </Drawer>

      <Drawer
        isOpen={bulkModal !== null}
        onClose={() => setBulkModal(null)}
        title={
          bulkModal === 'assign' ? 'Bulk Assign'
          : bulkModal === 'status' ? 'Bulk Change Status'
          : bulkModal === 'priority' ? 'Bulk Change Priority'
          : bulkModal === 'source' ? 'Bulk Change Source'
          : bulkModal === 'tag' ? 'Bulk Add Tag'
          : bulkModal === 'remove_tag' ? 'Bulk Remove Tag'
          : bulkModal === 'move_stage' ? 'Bulk Move Stage'
          : bulkModal === 'enroll_sdr' ? 'Enroll in AI SDR Agent'
          : bulkModal === 'enroll_sequence' ? 'Enroll in Email Sequence'
          : 'Run Automation'
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">This will apply to {selectedIds.size} selected lead(s).</p>
          {bulkModal === 'assign' && (
            <Select label="Assign to" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} options={[{ value: '', label: 'Select a user' }, ...assignableUsers.map((u) => ({ value: u.id, label: u.name }))]} />
          )}
          {bulkModal === 'status' && (
            <Select label="New status" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} options={[{ value: '', label: 'Select a status' }, ...LEAD_STATUS_OPTIONS.filter((o) => o.value !== 'all')]} />
          )}
          {bulkModal === 'priority' && (
            <Select label="New priority" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} options={[{ value: '', label: 'Select a priority' }, ...LEAD_PRIORITY_OPTIONS.filter((o) => o.value !== 'all')]} />
          )}
          {bulkModal === 'source' && (
            <Select label="New source" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} options={[{ value: '', label: 'Select a source' }, ...listSourceOptions()]} />
          )}
          {bulkModal === 'tag' && (
            <Select label="Tag" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} options={[{ value: '', label: 'Select a tag' }, ...tags.map((t) => ({ value: t.id, label: t.name }))]} />
          )}
          {bulkModal === 'remove_tag' && (
            <Select label="Tag" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} options={[{ value: '', label: 'Select a tag' }, ...tags.map((t) => ({ value: t.id, label: t.name }))]} />
          )}
          {bulkModal === 'move_stage' && (
            <>
              <Select
                label="Pipeline"
                value={bulkStagePipeline}
                onChange={(e) => { setBulkStagePipeline(e.target.value); setBulkValue(''); }}
                options={[{ value: '', label: 'Select a pipeline' }, ...pipelines.map((p) => ({ value: p.id, label: p.name }))]}
              />
              <Select
                label="Stage"
                value={bulkValue}
                onChange={(e) => setBulkValue(e.target.value)}
                disabled={!bulkStagePipeline}
                hint={!bulkStagePipeline ? 'Choose a pipeline first.' : undefined}
                options={
                  bulkStagePipeline
                    ? [{ value: '', label: 'Select a stage' }, ...stagesForPipeline(bulkStagePipeline).map((s) => ({ value: s.id, label: s.name }))]
                    : [{ value: '', label: '—' }]
                }
              />
            </>
          )}
          {bulkModal === 'enroll_sequence' && (
            <>
              <Select
                label="Email sequence"
                value={bulkValue}
                onChange={(e) => setBulkValue(e.target.value)}
                options={[{ value: '', label: 'Select a sequence' }, ...sequences.map((q) => ({ value: q.id, label: `${q.name} (${q.stepCount} steps)` }))]}
              />
              <p className="text-xs text-ink-faint">
                {sequences.length === 0
                  ? 'No active sequences with steps. Create one under CRM \u2192 Email Sequences and set its status to Active.'
                  : 'The first step is scheduled from its own delay. Leads without an email address, and leads already active in this sequence, are skipped.'}
              </p>
            </>
          )}
          {bulkModal === 'enroll_sdr' && (
            <>
              <Select
                label="AI SDR Agent"
                value={bulkValue}
                onChange={(e) => setBulkValue(e.target.value)}
                options={[{ value: '', label: 'Select an agent' }, ...sdrAgents.map((a) => ({ value: a.id, label: a.name }))]}
              />
              {sdrAgents.length === 0 ? (
                <p className="text-xs text-ink-faint">
                  No active agents. Create one under CRM → AI SDR Agents.
                </p>
              ) : (
                <p className="text-xs text-ink-faint">
                  The agent's guardrails (follow-up ceiling, cadence, business hours) apply from the moment a lead is enrolled.
                  Leads already enrolled with this agent are skipped.
                </p>
              )}
            </>
          )}
          {bulkModal === 'run_automation' && (
            <>
              <Select
                label="Automation"
                value={bulkValue}
                onChange={(e) => setBulkValue(e.target.value)}
                options={[{ value: '', label: 'Select an automation' }, ...manualAutomations.map((a) => ({ value: a.id, label: a.name }))]}
              />
              {manualAutomations.length === 0 && (
                <p className="text-xs text-ink-faint">
                  No manually-triggerable automations are configured. Create one under CRM → Automation with trigger "Manual".
                </p>
              )}
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setBulkModal(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={runBulkAction} disabled={!bulkValue}>
              Apply
            </Button>
          </div>
        </div>
      </Drawer>

      <ConfirmationDialog
        isOpen={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={async () => {
          await handleBulkDelete();
          setBulkDeleteOpen(false);
        }}
        title="Delete selected leads"
        description={`This will delete ${selectedIds.size} selected lead(s). This action can be recovered by an administrator from the backend, but is not reversible from this screen.`}
        confirmLabel="Delete"
        variant="danger"
        audited
      />

      <ConfirmationDialog
        isOpen={!!rowDeleteTarget}
        onClose={() => setRowDeleteTarget(null)}
        onConfirm={handleRowDelete}
        title="Delete lead"
        description={rowDeleteTarget ? `This will delete "${leadFullName(rowDeleteTarget)}" (${rowDeleteTarget.id}).` : undefined}
        confirmLabel="Delete"
        variant="danger"
        audited
      />
    </div>
  );
}
