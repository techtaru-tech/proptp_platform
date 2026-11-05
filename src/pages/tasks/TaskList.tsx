import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlarmClock, CalendarClock, CheckCircle2, ListChecks, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { StatCard } from '../../components/ui/StatCard';
import { Badge } from '../../components/ui/Badge';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { Avatar } from '../../components/ui/Avatar';
import { Pagination } from '../../components/ui/Pagination';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { FilterBar } from '../../components/tables/FilterBar';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../context/ToastContext';
import { formatDate, formatRelativeTime } from '../../utils/format';
import type { Task, TaskPriority, TaskStatus } from '../../types';
import {
  TASK_PRIORITY_LABEL,
  TASK_PRIORITY_OPTIONS,
  TASK_PRIORITY_TONE,
  TASK_STATUS_LABEL,
  TASK_STATUS_OPTIONS,
  TASK_STATUS_TONE,
  deleteTask,
  getTaskAccess,
  getTaskStats,
  listTasks,
  type TaskFilters,
} from '../../services/taskService';
import { TaskScopeNote } from './TaskScopeNote';

/**
 * Every task the signed-in user is allowed to see.
 *
 * `mineOnly` is the "My Tasks" entry in the sidebar: the same screen pinned to the current
 * user. It is a prop rather than a separate page because the only difference is one filter
 * that the user is then free to widen — if their role lets them.
 */
export function TaskList({ mineOnly = false }: { mineOnly?: boolean }) {
  const navigate = useNavigate();
  const { toast } = useToast();

  const access = useAsync(() => getTaskAccess(), []);
  const currentUserId = access.data?.currentUserId;
  const scope = access.data?.scope ?? 'own';
  // Only worth offering when there is more than one person to choose between.
  const canFilterByAssignee = scope !== 'own';

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TaskStatus | 'all'>('all');
  const [priority, setPriority] = useState<TaskPriority | 'all'>('all');
  const [assigneeId, setAssigneeId] = useState<string>('all');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const debouncedSearch = useDebounce(search, 300);

  // On "My Tasks" the assignee is fixed to the current user until their own filter overrides it.
  const effectiveAssignee = mineOnly && assigneeId === 'all' ? (currentUserId ?? 'all') : assigneeId;

  const filters: TaskFilters = useMemo(
    () => ({
      search: debouncedSearch,
      status,
      priority,
      assigneeId: effectiveAssignee,
      dueFrom,
      dueTo,
      overdue,
    }),
    [debouncedSearch, status, priority, effectiveAssignee, dueFrom, dueTo, overdue]
  );

  const filterKey = JSON.stringify(filters);

  // Stats wait for the access call so "My Tasks" never counts everybody's work for a moment first.
  const stats = useAsync(
    () => (access.data ? getTaskStats(filters) : Promise.resolve(undefined)),
    [filterKey, access.data, reloadKey]
  );
  const list = useAsync(
    () => (access.data ? listTasks({ ...filters, page, pageSize }) : Promise.resolve(undefined)),
    [filterKey, page, pageSize, access.data, reloadKey]
  );

  const resetFilters = useCallback(() => {
    setSearch('');
    setStatus('all');
    setPriority('all');
    setAssigneeId('all');
    setDueFrom('');
    setDueTo('');
    setOverdue(false);
    setPage(1);
  }, []);

  const hasActiveFilters =
    !!search || status !== 'all' || priority !== 'all' || assigneeId !== 'all' || !!dueFrom || !!dueTo || overdue;

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteTask(pendingDelete.id);
      toast({ title: 'Task deleted', variant: 'success' });
      setPendingDelete(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast({ title: 'Could not delete task', description: (err as Error).message, variant: 'error' });
    }
  };

  const columns: DataTableColumn<Task>[] = [
    {
      key: 'title',
      header: 'Task',
      sortable: true,
      render: (t) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{t.title}</p>
          {t.description && <p className="mt-0.5 truncate text-xs text-ink-faint">{t.description}</p>}
        </div>
      ),
    },
    {
      key: 'assignee',
      header: 'Assignee',
      render: (t) => (
        <div className="flex items-center gap-2">
          <Avatar name={t.assigneeName} src={t.assigneeAvatarUrl} size="xs" />
          <span className="truncate text-ink-muted">{t.assigneeName}</span>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (t) => <Badge tone={TASK_STATUS_TONE[t.status]}>{TASK_STATUS_LABEL[t.status]}</Badge> },
    {
      key: 'priority',
      header: 'Priority',
      render: (t) => (
        <Badge tone={TASK_PRIORITY_TONE[t.priority]} dot>
          {TASK_PRIORITY_LABEL[t.priority]}
        </Badge>
      ),
    },
    {
      key: 'dueAt',
      header: 'Due',
      sortable: true,
      render: (t) =>
        t.dueAt ? (
          <span className={t.isOverdue ? 'font-medium text-danger-600' : 'text-ink-muted'}>{formatDate(t.dueAt)}</span>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
    { key: 'createdBy', header: 'Created by', render: (t) => <span className="text-ink-muted">{t.createdByName}</span> },
    { key: 'updatedAt', header: 'Updated', render: (t) => <span className="text-ink-faint">{formatRelativeTime(t.updatedAt)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (t) => (
        <button
          type="button"
          aria-label={`Delete ${t.title}`}
          onClick={(e) => {
            e.stopPropagation();
            setPendingDelete(t);
          }}
          className="rounded-md p-1.5 text-ink-faint hover:bg-danger-50 hover:text-danger-600 focus-ring"
        >
          <Trash2 size={14} />
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={mineOnly ? 'My Tasks' : 'All Tasks'}
        description={
          mineOnly
            ? 'Work assigned to you, and anything you raised yourself.'
            : 'Track and assign work across the team.'
        }
        breadcrumb={[{ label: 'Tasks', to: '/tasks' }, { label: mineOnly ? 'My Tasks' : 'All Tasks' }]}
        actions={
          <Button leftIcon={<Plus size={15} />} onClick={() => navigate('/tasks/new')}>
            New Task
          </Button>
        }
      />

      <TaskScopeNote scope={scope} />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total" value={stats.data?.total ?? 0} icon={ListChecks} tone="brand" />
        <StatCard label="Open" value={stats.data?.open ?? 0} icon={CalendarClock} tone="accent" />
        <StatCard
          label="Overdue"
          value={stats.data?.overdue ?? 0}
          icon={AlarmClock}
          tone="danger"
          onClick={() => {
            setOverdue((v) => !v);
            setPage(1);
          }}
          footer={overdue ? <span className="text-xs text-danger-600">Filtering by overdue</span> : undefined}
        />
        <StatCard label="Completed" value={stats.data?.completed ?? 0} icon={CheckCircle2} tone="success" />
      </div>

      <Card padded={false}>
        <FilterBar
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          searchPlaceholder="Search tasks or assignee..."
          onReset={resetFilters}
          hasActiveFilters={hasActiveFilters}
        >
          <Select
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as TaskStatus | 'all');
              setPage(1);
            }}
            options={[{ value: 'all', label: 'All statuses' }, ...TASK_STATUS_OPTIONS]}
            wrapperClassName="w-40"
          />
          <Select
            aria-label="Priority"
            value={priority}
            onChange={(e) => {
              setPriority(e.target.value as TaskPriority | 'all');
              setPage(1);
            }}
            options={[{ value: 'all', label: 'All priorities' }, ...TASK_PRIORITY_OPTIONS]}
            wrapperClassName="w-40"
          />
          {canFilterByAssignee && (
            <Select
              aria-label="Assignee"
              value={effectiveAssignee}
              onChange={(e) => {
                setAssigneeId(e.target.value);
                setPage(1);
              }}
              options={[
                { value: 'all', label: mineOnly ? 'Everyone I can see' : 'All assignees' },
                ...(access.data?.users ?? []).map((u) => ({
                  value: u.id,
                  label: u.id === currentUserId ? `${u.name} (me)` : u.name,
                })),
              ]}
              wrapperClassName="w-52"
            />
          )}
          <DatePicker
            aria-label="Due from"
            value={dueFrom}
            onChange={(e) => {
              setDueFrom(e.target.value);
              setPage(1);
            }}
            wrapperClassName="w-40"
          />
          <DatePicker
            aria-label="Due to"
            value={dueTo}
            onChange={(e) => {
              setDueTo(e.target.value);
              setPage(1);
            }}
            wrapperClassName="w-40"
          />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={list.data?.items ?? []}
          rowKey={(t) => t.id}
          isLoading={list.isLoading || access.isLoading}
          error={list.error ?? access.error}
          onRowClick={(t) => navigate(`/tasks/${t.id}`)}
          rowHref={(t) => `/tasks/${t.id}`}
          emptyTitle="No tasks"
          emptyDescription={
            hasActiveFilters ? 'No task matches these filters.' : 'Create the first task to get started.'
          }
        />

        {!!list.data?.total && (
          <Pagination
            page={list.data.page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        )}
      </Card>

      <ConfirmationDialog
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDelete}
        title="Delete task"
        description={`"${pendingDelete?.title}" will be removed permanently, along with its comments.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
