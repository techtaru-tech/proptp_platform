import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Phone, Mail, StickyNote, GitBranch, UserCog, TrendingUp, Tag as TagIcon,
  CalendarClock, UserPlus, FileDown,
} from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { Avatar } from '../../components/ui/Avatar';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { TableSkeleton } from '../../components/ui/LoadingSkeleton';
import { FilterBar } from '../../components/tables/FilterBar';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { listActivities, type ActivityListParams } from '../../services/activityService';
import { formatDateTime } from '../../utils/format';
import type { LeadActivityType } from '../../types';

const TYPE_OPTIONS: { value: LeadActivityType | 'all'; label: string }[] = [
  { value: 'all', label: 'All Types' },
  { value: 'created', label: 'Created' },
  { value: 'imported', label: 'Imported' },
  { value: 'status_changed', label: 'Status Changed' },
  { value: 'stage_moved', label: 'Stage Moved' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'note_added', label: 'Note Added' },
  { value: 'call_logged', label: 'Call Logged' },
  { value: 'email_sent', label: 'Email Sent' },
  { value: 'email_received', label: 'Email Received' },
  { value: 'tag_applied', label: 'Tag Applied' },
  { value: 'tag_removed', label: 'Tag Removed' },
  { value: 'meeting_scheduled', label: 'Meeting Scheduled' },
];

const TYPE_ICON: Record<LeadActivityType, typeof Phone> = {
  created: UserPlus,
  imported: FileDown,
  status_changed: TrendingUp,
  stage_moved: GitBranch,
  assigned: UserCog,
  score_changed: TrendingUp,
  note_added: StickyNote,
  call_logged: Phone,
  email_sent: Mail,
  email_received: Mail,
  tag_applied: TagIcon,
  tag_removed: TagIcon,
  meeting_scheduled: CalendarClock,
  meeting_rescheduled: CalendarClock,
  meeting_cancelled: CalendarClock,
};

export function LeadActivities() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<LeadActivityType | 'all'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const params: ActivityListParams = { page, pageSize: 20, search: debouncedSearch, type, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined };
  const { data, isLoading, error } = useAsync(() => listActivities(params), [JSON.stringify(params)]);

  return (
    <div>
      <PageHeader title="Activities" description="A live, cross-lead feed of everything happening across the CRM." breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Activities' }]} />

      <Card padded={false}>
        <FilterBar search={search} onSearchChange={(v) => { setSearch(v); setPage(1); }} searchPlaceholder="Search activity or user...">
          <Select value={type} onChange={(e) => { setType(e.target.value as LeadActivityType | 'all'); setPage(1); }} options={TYPE_OPTIONS} wrapperClassName="w-48" />
          <DatePicker value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} wrapperClassName="w-40" aria-label="From date" />
          <DatePicker value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} wrapperClassName="w-40" aria-label="To date" />
        </FilterBar>

        {isLoading ? (
          <TableSkeleton cols={1} />
        ) : error ? (
          <ErrorState />
        ) : !data || data.items.length === 0 ? (
          <EmptyState title="No activity found" description="Try adjusting your filters." />
        ) : (
          <ul className="divide-y divide-line">
            {data.items.map((a) => {
              const Icon = TYPE_ICON[a.type] ?? StickyNote;
              return (
                <li
                  key={a.id}
                  onClick={() => navigate(`/crm/leads/${a.leadId}`)}
                  className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-surface-subtle"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-faint">
                    <Icon size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">
                      {a.leadName && <span className="font-medium">{a.leadName}</span>} — {a.description}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-ink-faint">
                      {a.userName && (
                        <span className="flex items-center gap-1">
                          <Avatar name={a.userName} size="xs" />
                          {a.userName}
                        </span>
                      )}
                      {formatDateTime(a.createdAt)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {data && data.total > 0 && <Pagination page={page} pageSize={20} total={data.total} onPageChange={setPage} />}
      </Card>
    </div>
  );
}
