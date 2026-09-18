import { useState, type ReactNode } from 'react';
import { BellOff, BellRing, Clock, Plus, Users2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Drawer } from '../../components/ui/Drawer';
import { Pagination } from '../../components/ui/Pagination';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { FilterBar } from '../../components/tables/FilterBar';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { listNotifications, getPushStatus } from '../../services/notificationService';
import { AUDIENCE_LABEL } from '../../services/notificationService';
import { NotificationComposer } from './NotificationComposer';
import { formatDateTime } from '../../utils/format';
import type { AppNotification } from '../../types';

export function Notifications() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [reloadKey, setReloadKey] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);

  const [selected, setSelected] = useState<AppNotification | null>(null);

  const params = { page, pageSize: 10, search: debouncedSearch, sortBy: 'createdAt', sortDir: 'desc' as const };
  const { data, isLoading, error } = useAsync(() => listNotifications(params), [JSON.stringify(params), reloadKey]);
  const { data: push } = useAsync(() => getPushStatus().catch(() => undefined), [reloadKey]);


  const columns: DataTableColumn<AppNotification>[] = [
    { key: 'title', header: 'Title', render: (n) => <span className="font-medium text-ink">{n.title}</span> },
    { key: 'audience', header: 'Audience', render: (n) => <span className="flex items-center gap-1.5"><Users2 size={13} className="text-ink-faint" />{AUDIENCE_LABEL[n.audience]}</span> },
    {
      key: 'when',
      header: 'When',
      render: (n) =>
        n.scheduledFor ? (
          <span className="flex items-center gap-1.5 text-warning-700">
            <Clock size={13} />
            {formatDateTime(n.scheduledFor)}
          </span>
        ) : (
          formatDateTime(n.sentAt ?? n.createdAt)
        ),
    },
    { key: 'status', header: 'Delivery Status', render: (n) => <StatusBadge kind="notification" status={n.deliveryStatus} /> },
    { key: 'recipients', header: 'Recipients', align: 'right', render: (n) => n.recipientCount },
    { key: 'delivered', header: 'Delivered', align: 'right', render: (n) => n.deliveredCount },
    { key: 'failed', header: 'Failed', align: 'right', render: (n) => n.failedCount },
  ];

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Send and track operational notifications to Agents, Employees and Leaders."
        actions={
          <Button variant="primary" leftIcon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>
            Create Notification
          </Button>
        }
      />

      {push && (
        <div
          className={
            push.configured
              ? 'mb-5 flex flex-wrap items-center gap-2.5 rounded-lg border border-success-100 bg-success-50 px-4 py-3 text-sm text-success-700'
              : 'mb-5 flex flex-wrap items-start gap-2.5 rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-700'
          }
        >
          {push.configured ? <BellRing size={16} className="shrink-0" /> : <BellOff size={16} className="mt-0.5 shrink-0" />}
          {push.configured ? (
            <p>
              Push is live on <strong>{push.projectId}</strong>. {push.devicesRegistered} of {push.partnersActive} active
              partners have the app open on a device — the rest see notifications in the app's feed when they next sign in.
            </p>
          ) : (
            <p>
              <strong>Push is not configured.</strong> Notifications are still recorded and appear in the app's feed, but
              nobody's phone will light up. The server needs its Firebase service account file before that works.
            </p>
          )}
        </div>
      )}

      <Card padded={false}>
        <FilterBar search={search} onSearchChange={(v) => { setSearch(v); setPage(1); }} searchPlaceholder="Search notifications..." />
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(n) => n.id}
          isLoading={isLoading}
          error={error}
          onRowClick={(n) => setSelected(n)}
        />
        {data && data.total > 0 && <Pagination page={page} pageSize={10} total={data.total} onPageChange={setPage} />}
      </Card>

      {createOpen && (
        <NotificationComposer
          onClose={() => setCreateOpen(false)}
          onSent={() => {
            setCreateOpen(false);
            setReloadKey((k) => k + 1);
          }}
        />
      )}

      <Drawer isOpen={!!selected} onClose={() => setSelected(null)} title={selected?.title}>
        {selected && (
          <div className="space-y-4 text-sm">
            <p className="leading-relaxed text-ink-muted">{selected.body}</p>
            <dl className="space-y-2.5 border-t border-line pt-4">
              <Row label="Audience" value={AUDIENCE_LABEL[selected.audience]} />
              <Row label="Created" value={formatDateTime(selected.createdAt)} />
              <Row label="Delivery Status" value={<StatusBadge kind="notification" status={selected.deliveryStatus} />} />
              <Row label="Recipients" value={selected.recipientCount} />
              <Row label="Delivered" value={selected.deliveredCount} />
              <Row label="Failed" value={selected.failedCount} />
            </dl>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}
