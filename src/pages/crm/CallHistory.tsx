import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Info, Phone, PhoneCall, PhoneIncoming, PhoneOutgoing, RefreshCw } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Avatar } from '../../components/ui/Avatar';
import { StatCard } from '../../components/ui/StatCard';
import { Select } from '../../components/ui/Select';
import { SearchInput } from '../../components/ui/SearchInput';
import { Drawer } from '../../components/ui/Drawer';
import { Pagination } from '../../components/ui/Pagination';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import {
  getCall, getTelephonySettings, listCalls,
  CALL_DIRECTION_OPTIONS, CALL_STATUS_OPTIONS, CALL_STATUS_TONE,
  type CallListParams,
} from '../../services/callService';
import { formatDateTime, formatDateTimeExact, formatRelativeTime } from '../../utils/format';
import type { CallLog, CallStatus } from '../../types';

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * DeepCall reports a finished, answered call as "completed", which the shared status list does
 * not carry; it is offered here so it can be filtered on, and counted as connected below.
 */
const STATUS_OPTIONS = CALL_STATUS_OPTIONS.some((o) => o.value === ('completed' as CallStatus))
  ? CALL_STATUS_OPTIONS
  : [...CALL_STATUS_OPTIONS.slice(0, 3), { value: 'completed' as CallStatus, label: 'Completed' }, ...CALL_STATUS_OPTIONS.slice(3)];
const CONNECTED = new Set<string>(['answered', 'completed']);
const statusTone = (s: string) => CALL_STATUS_TONE[s as CallStatus] ?? (s === 'completed' ? 'success' : 'neutral');

/** "4m 05s", "55s", "1h 12m"; a dash for a call that never connected. */
function talk(seconds: number | undefined): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** The list endpoint's page-size ceiling; the figures read the newest calls up to this many. */
const SAMPLE = 200;

export function CallHistory() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<CallListParams>({ page: 1, pageSize: 20, direction: 'all', status: 'all' });
  const [search, setSearch] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const params: CallListParams = { ...filters, search: search.trim() || undefined };
  const { data, isLoading } = useAsync(() => listCalls(params), [JSON.stringify(params), reloadKey]);
  const { data: settings } = useAsync(() => getTelephonySettings(), []);
  const { data: selected } = useAsync(() => (selectedId ? getCall(selectedId) : Promise.resolve(undefined)), [selectedId]);

  // The figures follow the same filters as the table, over every page rather than the one shown.
  const kpiParams: CallListParams = { direction: filters.direction, status: filters.status, search: params.search, page: 1, pageSize: SAMPLE };
  const kpi = useAsync(() => listCalls(kpiParams), [JSON.stringify(kpiParams), reloadKey]);
  const figures = kpi.data && summarise(kpi.data.items);
  const sampled = !!kpi.data && kpi.data.total > kpi.data.items.length;
  const filtered = filters.direction !== 'all' || filters.status !== 'all' || !!params.search;

  const patch = (next: Partial<CallListParams>) => setFilters((prev) => ({ ...prev, ...next, page: 1 }));

  const columns: DataTableColumn<CallLog>[] = [
    {
      key: 'lead',
      header: 'Lead',
      render: (c) =>
        c.leadId ? (
          <button
            className="whitespace-nowrap rounded text-left font-medium text-brand-700 hover:underline focus-ring"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/crm/leads/${c.leadId}`);
            }}
          >
            {c.leadName}
          </button>
        ) : (
          <span className="text-ink-faint">Unknown caller</span>
        ),
    },
    {
      key: 'agent',
      header: 'Agent',
      render: (c) =>
        c.agentName ? (
          <span className="flex items-center gap-2 whitespace-nowrap">
            <Avatar name={c.agentName} size="xs" />
            {c.agentName}
          </span>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
    {
      key: 'direction',
      header: 'Direction',
      render: (c) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-muted">
          {c.direction === 'incoming' ? <PhoneIncoming size={13} className="text-info-600" /> : <PhoneOutgoing size={13} className="text-brand-600" />}
          {c.direction === 'incoming' ? 'Incoming' : 'Outgoing'}
        </span>
      ),
    },
    { key: 'from', header: 'From', render: (c) => <span className="tabular-nums text-ink-muted">{c.callerNumber}</span> },
    { key: 'to', header: 'To', render: (c) => <span className="tabular-nums text-ink-muted">{c.agentNumber ?? '—'}</span> },
    {
      key: 'durationSeconds',
      header: 'Duration',
      align: 'right',
      sortable: true,
      render: (c) => <span className={c.durationSeconds ? 'tabular-nums' : 'text-ink-faint'}>{talk(c.durationSeconds)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => <Badge tone={statusTone(c.status)}>{cap(c.status.replace('_', ' '))}</Badge>,
    },
    {
      key: 'startedAt',
      header: 'When',
      sortable: true,
      render: (c) => <span className="whitespace-nowrap text-ink-muted" title={formatDateTime(c.startedAt)}>{formatRelativeTime(c.startedAt)}</span>,
    },
  ];

  const sampleNote = sampled && kpi.data ? ` · newest ${kpi.data.items.length}` : '';

  return (
    <div>
      <PageHeader
        title="Calls"
        description="Every call through the business number and every click-to-call, logged from DeepCall's report after hangup."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Calls' }]}
        actions={
          <Button variant="outline" leftIcon={<RefreshCw size={14} />} onClick={() => setReloadKey((k) => k + 1)}>
            Refresh
          </Button>
        }
      />

      {settings && !settings.enabled && (
        <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-warning-100 bg-warning-50 px-3.5 py-2.5 text-[13px] text-warning-700">
          <Info size={15} className="mt-0.5 shrink-0" />
          <p>
            <strong className="font-semibold">Telephony is turned off.</strong> Calls cannot be placed or logged until it is enabled and the
            webhook URL is registered in DeepCall — see <a className="underline" href="/settings/telephony">Settings → Telephony</a>.
          </p>
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Calls" value={kpi.data?.total ?? '…'} icon={Phone} tone="brand" footer={kpi.data ? (filtered ? 'matching the filters' : 'all logged calls') : undefined} />
        <StatCard
          label="Connected"
          value={figures?.connected ?? '…'}
          icon={PhoneCall}
          tone="success"
          footer={figures ? `${figures.count ? Math.round((figures.connected / figures.count) * 100) : 0}% of calls${sampleNote}` : undefined}
        />
        <StatCard
          label="Average talk time"
          value={figures ? talk(figures.avgTalk) : '…'}
          icon={Clock}
          tone="info"
          footer={figures ? (figures.talked ? `per connected call · ${talk(figures.totalTalk)} in all` : 'no connected calls') : undefined}
        />
        <StatCard
          label="Incoming / outgoing"
          value={figures ? `${figures.incoming} / ${figures.outgoing}` : '…'}
          icon={PhoneIncoming}
          tone="shell"
          footer={
            figures
              ? figures.incomingMissed
                ? <span className="text-danger-700">{figures.incomingMissed} incoming not answered{sampleNote}</span>
                : figures.incoming ? `every incoming call answered${sampleNote}` : `no incoming calls${sampleNote}`
              : undefined
          }
        />
      </div>

      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Direction"
              value={filters.direction ?? 'all'}
              onChange={(e) => patch({ direction: e.target.value as CallListParams['direction'] })}
              options={CALL_DIRECTION_OPTIONS}
            />
            <Select
              aria-label="Status"
              value={filters.status ?? 'all'}
              onChange={(e) => patch({ status: e.target.value as CallListParams['status'] })}
              options={STATUS_OPTIONS}
            />
            {filtered && (
              <Button variant="ghost" size="sm" onClick={() => { setSearch(''); patch({ direction: 'all', status: 'all' }); }}>
                Clear
              </Button>
            )}
          </div>
          <SearchInput value={search} onChange={setSearch} placeholder="Search number, lead or agent..." className="sm:w-72" />
        </div>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(c) => c.id}
          isLoading={isLoading}
          onRowClick={(c) => setSelectedId(c.id)}
          sortBy={filters.sortBy}
          sortDir={filters.sortDir}
          onSortChange={(key) =>
            setFilters((prev) => ({
              ...prev,
              sortBy: key,
              sortDir: prev.sortBy === key && prev.sortDir === 'desc' ? 'asc' : 'desc',
            }))
          }
          emptyTitle={filtered ? 'No calls match' : 'No calls'}
          emptyDescription={filtered ? 'Try another direction, status or search.' : 'Calls appear here once the provider starts routing through the CRM.'}
        />
        {data && data.total > data.pageSize && (
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))}
          />
        )}
      </Card>

      <Drawer isOpen={!!selectedId} onClose={() => setSelectedId(null)} title="Call detail">
        {selected && (
          <dl className="space-y-3 text-sm">
            <Row label="Lead" value={selected.leadName ?? 'Unknown caller'} />
            <Row label="Agent" value={selected.agentName ?? '—'} />
            <Row label="Direction" value={cap(selected.direction)} />
            <Row label="Status" value={cap(selected.status.replace('_', ' '))} />
            <Row label="From" value={selected.callerNumber} />
            <Row label="To" value={selected.agentNumber ?? '—'} />
            <Row label="Virtual number" value={selected.virtualNumber ?? '—'} />
            <Row label="Duration" value={talk(selected.durationSeconds)} />
            <Row label="Started" value={formatDateTimeExact(selected.startedAt)} />
            {selected.endedAt && <Row label="Ended" value={formatDateTimeExact(selected.endedAt)} />}
            {selected.dtmf && <Row label="DTMF" value={selected.dtmf} />}
            {selected.feedback && <Row label="Feedback" value={selected.feedback} />}
            <Row label="Provider call id" value={selected.uniqueId ?? '—'} />

            {selected.recordingUrl && (
              <div className="border-t border-line pt-3">
                <p className="mb-2 text-sm font-medium text-ink">
                  Recording <span className="text-ink-faint">({talk(selected.recordingDurationSeconds)})</span>
                </p>
                {/* Served from the provider's own domain, so it is played, not proxied. */}
                <audio controls preload="none" src={selected.recordingUrl} className="w-full">
                  <a href={selected.recordingUrl}>Download the recording</a>
                </audio>
              </div>
            )}
          </dl>
        )}
      </Drawer>
    </div>
  );
}

/** Connected, talk time and direction split over the calls the figures were read from. */
function summarise(calls: CallLog[]) {
  const connected = calls.filter((c) => CONNECTED.has(c.status));
  const talked = connected.filter((c) => c.durationSeconds > 0);
  const totalTalk = talked.reduce((s, c) => s + c.durationSeconds, 0);
  const incoming = calls.filter((c) => c.direction === 'incoming');
  return {
    count: calls.length,
    connected: connected.length,
    talked: talked.length,
    totalTalk,
    avgTalk: talked.length ? totalTalk / talked.length : 0,
    incoming: incoming.length,
    outgoing: calls.length - incoming.length,
    incomingMissed: incoming.filter((c) => !CONNECTED.has(c.status) && c.status !== 'routing').length,
  };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line pb-2.5 last:border-0">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}
