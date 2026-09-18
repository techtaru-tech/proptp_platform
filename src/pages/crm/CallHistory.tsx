import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Info, PhoneIncoming, PhoneOutgoing, RefreshCw, Radio } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Select } from '../../components/ui/Select';
import { SearchInput } from '../../components/ui/SearchInput';
import { Drawer } from '../../components/ui/Drawer';
import { Pagination } from '../../components/ui/Pagination';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import {
  getCall, getTelephonySettings, listCalls, listExtensionStatus,
  CALL_DIRECTION_OPTIONS, CALL_STATUS_OPTIONS, CALL_STATUS_TONE, formatCallDuration,
  type CallListParams,
} from '../../services/callService';
import { formatDateTime, formatDateTimeExact, formatRelativeTime } from '../../utils/format';
import type { CallLog } from '../../types';

export function CallHistory() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<CallListParams>({ page: 1, pageSize: 20, direction: 'all', status: 'all' });
  const [search, setSearch] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showExtensions, setShowExtensions] = useState(false);

  const params: CallListParams = { ...filters, search: search.trim() || undefined };
  const { data, isLoading } = useAsync(() => listCalls(params), [JSON.stringify(params), reloadKey]);
  const { data: settings } = useAsync(() => getTelephonySettings(), []);
  const { data: selected } = useAsync(() => (selectedId ? getCall(selectedId) : Promise.resolve(undefined)), [selectedId]);
  const { data: extensions, isLoading: extensionsLoading, error: extensionsError } = useAsync(
    () => (showExtensions ? listExtensionStatus() : Promise.resolve([])),
    [showExtensions, reloadKey]
  );

  const patch = (next: Partial<CallListParams>) => setFilters((prev) => ({ ...prev, ...next, page: 1 }));

  const columns: DataTableColumn<CallLog>[] = [
    {
      key: 'lead',
      header: 'Lead',
      render: (c) =>
        c.leadId ? (
          <button
            className="font-medium text-brand-600 hover:underline focus-ring"
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
    { key: 'agent', header: 'Agent', render: (c) => c.agentName ?? <span className="text-ink-faint">—</span> },
    {
      key: 'direction',
      header: 'Direction',
      render: (c) => (
        <span className="inline-flex items-center gap-1.5 text-sm text-ink-muted">
          {c.direction === 'incoming' ? <PhoneIncoming size={13} /> : <PhoneOutgoing size={13} />}
          {c.direction === 'incoming' ? 'Incoming' : 'Outgoing'}
        </span>
      ),
    },
    { key: 'from', header: 'From', render: (c) => c.callerNumber },
    { key: 'to', header: 'To', render: (c) => c.agentNumber ?? '—' },
    { key: 'duration', header: 'Duration', align: 'right', sortable: true, render: (c) => formatCallDuration(c.durationSeconds) },
    {
      key: 'status',
      header: 'Status',
      render: (c) => <Badge tone={CALL_STATUS_TONE[c.status] ?? 'neutral'}>{c.status.replace('_', ' ')}</Badge>,
    },
    { key: 'when', header: 'When', sortable: true, render: (c) => <span title={formatDateTime(c.startedAt)}>{formatRelativeTime(c.startedAt)}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Calls"
        description="Every call that went through the virtual number — routed to an agent by the CRM, then logged by the provider after hangup."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Calls' }]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" leftIcon={<Radio size={14} />} onClick={() => setShowExtensions((v) => !v)}>
              {showExtensions ? 'Hide' : 'Live'} Extensions
            </Button>
            <Button variant="outline" leftIcon={<RefreshCw size={14} />} onClick={() => setReloadKey((k) => k + 1)}>
              Refresh
            </Button>
          </div>
        }
      />

      {settings?.testRouteNumber && (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          <Info size={16} className="mt-0.5 shrink-0" />
          <p>
            <strong>Test routing is on.</strong> Every incoming call is going to{' '}
            <strong>{settings.testRouteNumber}</strong> regardless of who owns the lead, so no agent
            is credited with these calls. Clear it in{' '}
            <a className="underline" href="/settings/telephony">Settings → Telephony</a> when the test is done.
          </p>
        </div>
      )}

      {settings && !settings.enabled && (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          <Info size={16} className="mt-0.5 shrink-0" />
          <p>
            <strong>Telephony is turned off.</strong> Calls will not be routed or logged until it is enabled and the two
            webhook URLs are registered with the provider — see <a className="underline" href="/settings/telephony">Settings → Telephony</a>.
          </p>
        </div>
      )}

      {showExtensions && (
        <Card className="mb-5">
          <p className="mb-3 text-sm font-medium text-ink">Live extension status</p>
          {extensionsError ? (
            <p className="text-sm text-danger-600">{extensionsError.message}</p>
          ) : extensionsLoading ? (
            <p className="text-sm text-ink-faint">Checking with the provider...</p>
          ) : (extensions ?? []).length === 0 ? (
            <p className="text-sm text-ink-faint">
              No extensions mapped. Set a user's extension on their profile to see them here.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(extensions ?? []).map((e) => (
                <span key={e.userId} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm">
                  <span
                    className={
                      e.onCall ? 'h-2 w-2 rounded-full bg-warning-500'
                      : e.state === 'online' ? 'h-2 w-2 rounded-full bg-success-500'
                      : 'h-2 w-2 rounded-full bg-ink-faint'
                    }
                  />
                  <span className="text-ink">{e.userName}</span>
                  <span className="text-ink-faint">{e.extension}</span>
                  <span className="text-xs text-ink-muted">{e.onCall ? 'on call' : e.state}</span>
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-3">
          <div className="flex flex-wrap gap-2">
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
              options={CALL_STATUS_OPTIONS}
            />
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
          emptyTitle="No Calls"
          emptyDescription="Calls appear here once the provider starts routing through the CRM."
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
            <Row label="Direction" value={selected.direction} />
            <Row label="Status" value={selected.status.replace('_', ' ')} />
            <Row label="From" value={selected.callerNumber} />
            <Row label="To" value={selected.agentNumber ?? '—'} />
            <Row label="Virtual number" value={selected.virtualNumber ?? '—'} />
            <Row label="Duration" value={formatCallDuration(selected.durationSeconds)} />
            <Row label="Started" value={formatDateTimeExact(selected.startedAt)} />
            {selected.endedAt && <Row label="Ended" value={formatDateTimeExact(selected.endedAt)} />}
            {selected.dtmf && <Row label="DTMF" value={selected.dtmf} />}
            {selected.feedback && <Row label="Feedback" value={selected.feedback} />}
            <Row label="Provider call id" value={selected.uniqueId ?? '—'} />

            {selected.recordingUrl && (
              <div className="border-t border-line pt-3">
                <p className="mb-2 text-sm font-medium text-ink">
                  Recording <span className="text-ink-faint">({formatCallDuration(selected.recordingDurationSeconds)})</span>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line pb-2.5 last:border-0">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}
