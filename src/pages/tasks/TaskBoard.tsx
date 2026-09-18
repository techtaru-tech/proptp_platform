import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, MessageSquare, Plus } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Select } from '../../components/ui/Select';
import { Avatar } from '../../components/ui/Avatar';
import { FilterBar } from '../../components/tables/FilterBar';
import { ErrorState } from '../../components/ui/ErrorState';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../context/ToastContext';
import { cn } from '../../utils/cn';
import { formatDate } from '../../utils/format';
import type { Task, TaskPriority, TaskStatus } from '../../types';
import {
  TASK_BOARD_STATUSES,
  TASK_PRIORITY_BAR,
  TASK_PRIORITY_LABEL,
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_LABEL,
  getTaskAccess,
  getTaskBoard,
  moveTask,
  type TaskFilters,
} from '../../services/taskService';
import { TaskScopeNote } from './TaskScopeNote';

/**
 * The kanban board — one column per status, cards dragged between them.
 *
 * Columns are whatever the server returned, and a drop is a single-field PATCH, so a card the
 * user is not allowed to move comes back 403 and the board reloads to the truth rather than
 * keeping an optimistic lie on screen.
 */
export function TaskBoard() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const access = useAsync(() => getTaskAccess(), []);
  const currentUserId = access.data?.currentUserId;
  const scope = access.data?.scope ?? 'own';

  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState<TaskPriority | 'all'>('all');
  const [assigneeId, setAssigneeId] = useState<string>('all');
  const [reloadKey, setReloadKey] = useState(0);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  const filters: TaskFilters = useMemo(
    () => ({ search: debouncedSearch, priority, assigneeId }),
    [debouncedSearch, priority, assigneeId]
  );
  const filterKey = JSON.stringify(filters);

  const board = useAsync(
    () => (access.data ? getTaskBoard(filters) : Promise.resolve(undefined)),
    [filterKey, access.data, reloadKey]
  );

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const handleDrop = async (status: TaskStatus) => {
    const id = draggingId;
    setDraggingId(null);
    setDragOverStatus(null);
    if (!id) return;

    // Nothing to do when a card is dropped back where it started.
    const current = board.data?.columns.find((c) => c.items.some((t) => t.id === id));
    if (current?.status === status) return;

    try {
      await moveTask(id, status);
      toast({ title: `Moved to ${TASK_STATUS_LABEL[status]}`, variant: 'success' });
    } catch (err) {
      toast({ title: 'Could not move task', description: (err as Error).message, variant: 'error' });
    } finally {
      reload();
    }
  };

  const columns = board.data?.columns ?? TASK_BOARD_STATUSES.map((status) => ({ status, total: 0, items: [] as Task[] }));
  const hasActiveFilters = !!search || priority !== 'all' || assigneeId !== 'all';

  return (
    <div>
      <PageHeader
        title="Task Board"
        description="Drag a card to move it through the workflow."
        breadcrumb={[{ label: 'Tasks', to: '/tasks' }, { label: 'Board' }]}
        actions={
          <Button leftIcon={<Plus size={15} />} onClick={() => navigate('/tasks/new')}>
            New Task
          </Button>
        }
      />

      <TaskScopeNote scope={scope} />

      <Card padded={false} className="mb-5">
        <FilterBar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search tasks or assignee..."
          onReset={() => {
            setSearch('');
            setPriority('all');
            setAssigneeId('all');
          }}
          hasActiveFilters={hasActiveFilters}
        >
          <Select
            aria-label="Priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority | 'all')}
            options={[{ value: 'all', label: 'All priorities' }, ...TASK_PRIORITY_OPTIONS]}
            wrapperClassName="w-40"
          />
          {scope !== 'own' && (
            <Select
              aria-label="Assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              options={[
                { value: 'all', label: 'All assignees' },
                ...(access.data?.users ?? []).map((u) => ({
                  value: u.id,
                  label: u.id === currentUserId ? `${u.name} (me)` : u.name,
                })),
              ]}
              wrapperClassName="w-52"
            />
          )}
        </FilterBar>
      </Card>

      {board.error ? (
        <ErrorState description={board.error.message} onRetry={reload} />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((column) => (
            <BoardColumn
              key={column.status}
              status={column.status}
              total={column.total}
              items={column.items}
              isLoading={board.isLoading || access.isLoading}
              isDragOver={dragOverStatus === column.status}
              onDragOverColumn={() => setDragOverStatus(column.status)}
              onDropColumn={() => handleDrop(column.status)}
              onDragStartCard={setDraggingId}
              onCardClick={(id) => navigate(`/tasks/${id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const COLUMN_ACCENT: Record<TaskStatus, string> = {
  todo: 'bg-shell-400',
  in_progress: 'bg-accent-500',
  blocked: 'bg-danger-500',
  done: 'bg-success-500',
  cancelled: 'bg-line-strong',
};

interface BoardColumnProps {
  status: TaskStatus;
  total: number;
  items: Task[];
  isLoading: boolean;
  isDragOver: boolean;
  onDragOverColumn: () => void;
  onDropColumn: () => void;
  onDragStartCard: (id: string) => void;
  onCardClick: (id: string) => void;
}

function BoardColumn({
  status,
  total,
  items,
  isLoading,
  isDragOver,
  onDragOverColumn,
  onDropColumn,
  onDragStartCard,
  onCardClick,
}: BoardColumnProps) {
  return (
    <div
      onDragOver={(e) => {
        // Without this the browser refuses the drop outright.
        e.preventDefault();
        onDragOverColumn();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropColumn();
      }}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-xl border bg-surface-subtle transition-colors',
        isDragOver ? 'border-brand-400 bg-brand-50/60' : 'border-line'
      )}
    >
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-3">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', COLUMN_ACCENT[status])} />
        <h3 className="text-sm font-semibold text-ink">{TASK_STATUS_LABEL[status]}</h3>
        <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs font-medium text-ink-muted">{total}</span>
      </div>

      <div className="flex min-h-[120px] flex-col gap-2.5 p-3">
        {isLoading ? (
          <>
            <div className="h-20 animate-pulse rounded-lg bg-surface-muted" />
            <div className="h-20 animate-pulse rounded-lg bg-surface-muted" />
          </>
        ) : items.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-ink-faint">Nothing here</p>
        ) : (
          items.map((task) => (
            <TaskCard key={task.id} task={task} onDragStart={() => onDragStartCard(task.id)} onClick={() => onCardClick(task.id)} />
          ))
        )}

        {/* The column is capped, so say so rather than quietly showing a partial pile. */}
        {!isLoading && total > items.length && (
          <p className="px-1 pt-1 text-center text-xs text-ink-faint">
            +{total - items.length} more — narrow the filters to see them
          </p>
        )}
      </div>
    </div>
  );
}

function TaskCard({ task, onDragStart, onClick }: { task: Task; onDragStart: () => void; onClick: () => void }) {
  return (
    <article
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="group cursor-pointer overflow-hidden rounded-lg border border-line bg-white shadow-card transition-shadow hover:shadow-popover"
    >
      <div className="flex">
        <span
          className={cn('w-1 shrink-0', TASK_PRIORITY_BAR[task.priority])}
          title={`${TASK_PRIORITY_LABEL[task.priority]} priority`}
        />
        <div className="min-w-0 flex-1 p-3">
          <p className="line-clamp-2 text-sm font-medium text-ink">{task.title}</p>

          <div className="mt-2.5 flex items-center gap-2 text-xs text-ink-faint">
            <Avatar name={task.assigneeName} src={task.assigneeAvatarUrl} size="xs" />
            <span className="truncate">{task.assigneeName}</span>
          </div>

          {(task.dueAt || task.commentCount > 0) && (
            <div className="mt-2.5 flex items-center gap-3 text-xs">
              {task.dueAt && (
                <span className={cn('flex items-center gap-1', task.isOverdue ? 'font-medium text-danger-600' : 'text-ink-faint')}>
                  <CalendarClock size={12} />
                  {formatDate(task.dueAt)}
                </span>
              )}
              {task.commentCount > 0 && (
                <span className="flex items-center gap-1 text-ink-faint">
                  <MessageSquare size={12} />
                  {task.commentCount}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
