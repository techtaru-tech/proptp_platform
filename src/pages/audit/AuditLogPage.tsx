import { useState, type ReactNode } from 'react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { Badge } from '../../components/ui/Badge';
import { Drawer } from '../../components/ui/Drawer';
import { Pagination } from '../../components/ui/Pagination';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { FilterBar } from '../../components/tables/FilterBar';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { listAuditLog, auditModules, auditUsers, type AuditListParams } from '../../services/auditService';
import { formatDateTime } from '../../utils/format';
import type { AuditEntry } from '../../types';

export function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [module, setModule] = useState('all');
  const [userName, setUserName] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState('timestamp');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const debouncedSearch = useDebounce(search, 300);
  const modules = auditModules();
  const users = auditUsers();

  const params: AuditListParams = {
    page,
    pageSize: 10,
    search: debouncedSearch,
    module,
    userName,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    sortBy,
    sortDir,
  };

  const { data, isLoading, error } = useAsync(() => listAuditLog(params), [JSON.stringify(params)]);

  const hasActiveFilters = search !== '' || module !== 'all' || userName !== 'all' || !!dateFrom || !!dateTo;
  const resetFilters = () => {
    setSearch('');
    setModule('all');
    setUserName('all');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const handleSortChange = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(key);
      setSortDir('asc');
    }
  };

  const columns: DataTableColumn<AuditEntry>[] = [
    { key: 'userName', header: 'User', render: (a) => <span className="font-medium text-ink">{a.userName}</span> },
    { key: 'action', header: 'Action', render: (a) => a.action },
    { key: 'module', header: 'Module', render: (a) => <Badge tone="shell">{a.module}</Badge> },
    { key: 'recordLabel', header: 'Record', render: (a) => <span className="line-clamp-1 max-w-xs">{a.recordLabel}</span> },
    { key: 'timestamp', header: 'Timestamp', sortable: true, render: (a) => formatDateTime(a.timestamp) },
  ];

  return (
    <div>
      <PageHeader
        title="Audit Log"
        description="System-wide audit trail of admin actions across bookings, projects, users, payouts, attendance and settings."
        breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'Audit Log' }]}
      />

      <Card padded={false}>
        <FilterBar
          search={search}
          onSearchChange={(v) => { setSearch(v); setPage(1); }}
          searchPlaceholder="Search action, record or description..."
          onReset={resetFilters}
          hasActiveFilters={hasActiveFilters}
        >
          <Select
            aria-label="Module"
            value={module}
            onChange={(e) => { setModule(e.target.value); setPage(1); }}
            options={[{ value: 'all', label: 'All Modules' }, ...modules.map((m) => ({ value: m, label: m }))]}
            wrapperClassName="w-40"
          />
          <Select
            aria-label="User"
            value={userName}
            onChange={(e) => { setUserName(e.target.value); setPage(1); }}
            options={[{ value: 'all', label: 'All Users' }, ...users.map((u) => ({ value: u, label: u }))]}
            wrapperClassName="w-44"
          />
          <DatePicker value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} wrapperClassName="w-40" aria-label="From date" />
          <DatePicker value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} wrapperClassName="w-40" aria-label="To date" />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(a) => a.id}
          isLoading={isLoading}
          error={error}
          onRowClick={setSelected}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={handleSortChange}
        />

        {data && data.total > 0 && <Pagination page={page} pageSize={10} total={data.total} onPageChange={setPage} />}
      </Card>

      <Drawer isOpen={!!selected} onClose={() => setSelected(null)} title="Audit Entry">
        {selected && (
          <dl className="space-y-3 text-sm">
            <Row label="User" value={selected.userName} />
            <Row label="Action" value={selected.action} />
            <Row label="Module" value={<Badge tone="shell">{selected.module}</Badge>} />
            <Row label="Record" value={selected.recordLabel} />
            <Row label="Timestamp" value={formatDateTime(selected.timestamp)} />
            <Row label="Description" value={selected.description} />
            {selected.changes && selected.changes.length > 0 && (
              <div className="mt-2 border-t border-line pt-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">What changed</p>
                <ul className="space-y-2">
                  {selected.changes.map((c, i) => (
                    <li key={i} className="rounded-lg bg-surface-subtle px-3 py-2 text-sm">
                      <span className="font-medium text-ink">{c.field}</span> <span className="text-xs text-ink-faint">· {c.model}</span>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <code className="rounded bg-danger-50 px-1.5 py-0.5 text-xs text-danger-700 line-through">{c.from ?? 'empty'}</code>
                        <span className="text-ink-faint">→</span>
                        <code className="rounded bg-success-50 px-1.5 py-0.5 text-xs text-success-700">{c.to ?? 'empty'}</code>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </dl>
        )}
      </Drawer>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line pb-3 last:border-0">
      <dt className="shrink-0 text-ink-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}
