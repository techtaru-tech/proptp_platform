import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CalendarCheck, CalendarDays, Check, ChevronLeft, ChevronRight,
  Clock3, ExternalLink, Plus, RotateCcw, X as XIcon,
} from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Input } from '../../components/ui/Input';
import { StatCard } from '../../components/ui/StatCard';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Avatar } from '../../components/ui/Avatar';
import { Drawer } from '../../components/ui/Drawer';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/LoadingSkeleton';
import { AddTaskModal } from '../../components/leads/AddTaskModal';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  listFollowUpsInRange, updateFollowUpStatus, rescheduleFollowUp,
  type FollowUpWithLeadName,
} from '../../services/followUpService';
import { listAssignableUsers } from '../../services/leadService';
import { formatTime } from '../../utils/format';
import { cn } from '../../utils/cn';
import type { FollowUpStatus, LeadFollowUp, LeadPriority } from '../../types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Six weeks always — a month grid that changes height as you page through the year reads as a glitch. */
const GRID_DAYS = 42;

const STATUS_OPTIONS: { value: FollowUpStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
  { value: 'missed', label: 'Missed' },
  { value: 'rescheduled', label: 'Rescheduled' },
];

/**
 * What a task looks like on the calendar. Derived, not stored: `overdue` is a pending task whose
 * `dueAt` has passed, which no column in the table records.
 */
type TaskState = 'upcoming' | 'overdue' | 'missed' | 'completed';

const STATE_CHIP: Record<TaskState, string> = {
  upcoming: 'border-info-100 bg-info-50 text-info-700',
  overdue: 'border-danger-100 bg-danger-50 text-danger-700',
  missed: 'border-line bg-surface-muted text-ink-muted line-through',
  completed: 'border-success-100 bg-success-50 text-success-700',
};

function taskState(task: FollowUpWithLeadName, now: number): TaskState {
  if (task.completed || task.status === 'completed') return 'completed';
  if (task.status === 'missed') return 'missed';
  return new Date(task.dueAt).getTime() < now ? 'overdue' : 'upcoming';
}

function isOpen(task: FollowUpWithLeadName): boolean {
  return task.status === 'pending' || task.status === 'rescheduled';
}

/** Local Y-M-D. Tasks group by the day the user sees in their timezone, not by the UTC date. */
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Day label for a local `Date`. Deliberately not `formatDate(date.toISOString())`: east of UTC
 * (IST included) a local midnight serialises to the previous day, so that route labels 3 Sep as
 * "02 Sep 2026".
 */
function formatDayLabel(date: Date): string {
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

/** The grid opens on the Sunday at or before the 1st, so the month's first week is never ragged. */
function buildMonthGrid(month: Date): Date[] {
  const first = startOfMonth(month);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: GRID_DAYS }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/** `datetime-local` wants local wall-clock, so an ISO/UTC string can't be handed to it directly. */
function toDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  return `${dayKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function TaskCalendar() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [status, setStatus] = useState<FollowUpStatus | 'all'>('all');
  const [assignedUserId, setAssignedUserId] = useState('all');
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addDefaultDueAt, setAddDefaultDueAt] = useState<string | undefined>(undefined);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [rescheduleAt, setRescheduleAt] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  /**
   * The clock that decides "overdue", held in state rather than read during render — a render-time
   * `Date.now()` is impure and could reclassify a task mid-interaction. Ticked once a minute so a
   * task left on screen turns red the moment it falls due.
   */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const assignableUsers = listAssignableUsers();
  const days = useMemo(() => buildMonthGrid(month), [month]);

  // Fetch the whole visible grid, not just the month — otherwise the leading/trailing days sit empty.
  const params = useMemo(() => {
    const first = days[0];
    const last = days[days.length - 1];
    return {
      from: new Date(first.getFullYear(), first.getMonth(), first.getDate(), 0, 0, 0, 0).toISOString(),
      to: new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59, 999).toISOString(),
      status,
      assignedUserId,
    };
  }, [days, status, assignedUserId]);

  const { data, isLoading, error } = useAsync(() => listFollowUpsInRange(params), [JSON.stringify(params), reloadKey]);
  // Memoized so the groupings below don't rebuild on every unrelated render (drawer, filter focus).
  const tasks = useMemo(() => data ?? [], [data]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, FollowUpWithLeadName[]>();
    for (const task of tasks) {
      const key = dayKey(new Date(task.dueAt));
      const bucket = map.get(key);
      if (bucket) bucket.push(task);
      else map.set(key, [task]);
    }
    return map;
  }, [tasks]);

  const counts = useMemo(() => {
    const tally = { upcoming: 0, overdue: 0, missed: 0, completed: 0 };
    for (const task of tasks) tally[taskState(task, now)] += 1;
    return tally;
  }, [tasks, now]);

  const todayKey = dayKey(new Date());
  const monthLabel = month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const selectedTasks = selectedDay ? tasksByDay.get(dayKey(selectedDay)) ?? [] : [];

  const reload = () => setReloadKey((k) => k + 1);

  const handleComplete = async (id: string) => {
    await updateFollowUpStatus(id, 'completed');
    toast({ title: 'Task completed', variant: 'success' });
    reload();
  };

  const handleMissed = async (id: string) => {
    await updateFollowUpStatus(id, 'missed');
    toast({ title: 'Task marked as missed', variant: 'info' });
    reload();
  };

  const handleReschedule = async (id: string) => {
    if (!rescheduleAt) return;
    await rescheduleFollowUp(id, new Date(rescheduleAt).toISOString());
    toast({ title: 'Task rescheduled', variant: 'success' });
    setReschedulingId(null);
    setRescheduleAt('');
    reload();
  };

  const openReschedule = (task: FollowUpWithLeadName) => {
    setReschedulingId(task.id);
    setRescheduleAt(toDateTimeLocal(task.dueAt));
  };

  /** 10:00 is the default hour: a call or site visit gets scheduled in the morning far more often than at midnight. */
  const openAddTaskOn = (day: Date) => {
    setAddDefaultDueAt(`${dayKey(day)}T10:00`);
    setSelectedDay(null);
    setIsAddOpen(true);
  };

  const openAddTask = () => {
    // Prefer today, but only when the user is actually looking at today's month.
    const today = new Date();
    const inView = today.getMonth() === month.getMonth() && today.getFullYear() === month.getFullYear();
    openAddTaskOn(inView ? today : startOfMonth(month));
  };

  const handleTaskCreated = (task: LeadFollowUp) => {
    const created = new Date(task.dueAt);
    // Follow the task to its own month, otherwise a task dated outside this view appears to vanish.
    if (created.getMonth() !== month.getMonth() || created.getFullYear() !== month.getFullYear()) {
      setMonth(startOfMonth(created));
    } else {
      reload();
    }
  };

  const assigneeName = (userId?: string) => assignableUsers.find((u) => u.id === userId)?.name;

  return (
    <div>
      <PageHeader
        title="Task Calendar"
        description="Every lead follow-up laid out by due date. Click a day to work through it."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Task Calendar' }]}
        actions={
          <>
            <Button variant="outline" leftIcon={<CalendarCheck size={14} />} onClick={() => navigate('/crm/follow-ups')}>
              List view
            </Button>
            <Button variant="primary" leftIcon={<Plus size={14} />} onClick={openAddTask}>
              New Task
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Overdue this view" value={counts.overdue} icon={AlertTriangle} tone="danger" />
        <StatCard label="Upcoming this view" value={counts.upcoming} icon={CalendarDays} tone="info" />
        <StatCard label="Completed this view" value={counts.completed} icon={Check} tone="success" />
      </div>

      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))}>
              <ChevronLeft size={16} />
            </Button>
            <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setMonth((m) => addMonths(m, 1))}>
              <ChevronRight size={16} />
            </Button>
            <h2 className="min-w-[9.5rem] px-1 text-sm font-semibold text-ink">{monthLabel}</h2>
            <Button variant="ghost" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>
              Today
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Select
              aria-label="Assigned to"
              value={assignedUserId}
              onChange={(e) => setAssignedUserId(e.target.value)}
              options={[{ value: 'all', label: 'All Users' }, ...assignableUsers.map((u) => ({ value: u.id, label: u.name }))]}
              wrapperClassName="w-44"
            />
            <Select
              aria-label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value as FollowUpStatus | 'all')}
              options={STATUS_OPTIONS}
              wrapperClassName="w-40"
            />
          </div>
        </div>

        {error ? (
          <ErrorState description={error.message} onRetry={reload} />
        ) : (
          <>
            <div className="grid grid-cols-7 border-b border-line bg-surface-subtle">
              {WEEKDAYS.map((day) => (
                <div key={day} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 [&>*:nth-child(7n)]:border-r-0">
              {days.map((day) => {
                const key = dayKey(day);
                const dayTasks = tasksByDay.get(key) ?? [];
                const inMonth = day.getMonth() === month.getMonth();
                const isToday = key === todayKey;

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedDay(day)}
                    className={cn(
                      'flex min-h-[7rem] flex-col items-stretch gap-1 border-b border-r border-line p-2 text-left align-top transition-colors hover:bg-surface-subtle focus-ring',
                      !inMonth && 'bg-surface-subtle/70'
                    )}
                    aria-label={`${formatDayLabel(day)} — ${dayTasks.length} task${dayTasks.length === 1 ? '' : 's'}`}
                  >
                    <span className="flex items-center justify-between">
                      <span
                        className={cn(
                          'flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold',
                          isToday ? 'bg-shell-900 text-white' : inMonth ? 'text-ink' : 'text-ink-faint'
                        )}
                      >
                        {day.getDate()}
                      </span>
                      {isLoading && <Skeleton className="h-3 w-8" />}
                    </span>

                    {dayTasks.slice(0, 3).map((task) => (
                      <span
                        key={task.id}
                        title={`${task.title}${task.leadName ? ` — ${task.leadName}` : ''} · ${formatTime(task.dueAt)}`}
                        className={cn(
                          'truncate rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4',
                          STATE_CHIP[taskState(task, now)]
                        )}
                      >
                        {formatTime(task.dueAt)} {task.title}
                      </span>
                    ))}

                    {dayTasks.length > 3 && (
                      <span className="px-1 text-[11px] font-medium text-ink-subtle">+{dayTasks.length - 3} more</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-4 px-4 py-3 text-xs text-ink-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-info-500" /> Upcoming
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-danger-500" /> Overdue
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-success-500" /> Completed
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-ink-faint" /> Missed
              </span>
            </div>
          </>
        )}
      </Card>

      <Drawer
        isOpen={!!selectedDay}
        onClose={() => {
          setSelectedDay(null);
          setReschedulingId(null);
        }}
        title={selectedDay ? formatDayLabel(selectedDay) : ''}
        width="sm"
      >
        {selectedTasks.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="No tasks on this day"
            description="Nothing is due here for the current filters."
            action={
              selectedDay && (
                <Button variant="primary" size="sm" leftIcon={<Plus size={13} />} onClick={() => openAddTaskOn(selectedDay)}>
                  New task on this day
                </Button>
              )
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {selectedTasks.map((task) => {
              const state = taskState(task, now);
              const assignee = assigneeName(task.assignedUserId);

              return (
                <div key={task.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-ink">{task.title}</p>
                      {task.leadName && <p className="mt-0.5 text-xs text-ink-muted">{task.leadName}</p>}
                    </div>
                    <StatusBadge kind="followUpStatus" status={task.status} />
                  </div>

                  {task.description && <p className="mt-2 text-xs text-ink-muted">{task.description}</p>}

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-subtle">
                    <span className={cn('inline-flex items-center gap-1', state === 'overdue' && 'font-medium text-danger-600')}>
                      <Clock3 size={12} />
                      {formatTime(task.dueAt)}
                      {state === 'overdue' && ' · overdue'}
                    </span>
                    <StatusBadge kind="leadPriority" status={task.priority as LeadPriority} dot={false} />
                    {assignee ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Avatar name={assignee} size="xs" />
                        {assignee}
                      </span>
                    ) : (
                      <span className="text-ink-faint">Unassigned</span>
                    )}
                  </div>

                  {reschedulingId === task.id ? (
                    <div className="mt-3 flex flex-col gap-2 rounded-lg bg-surface-subtle p-2.5">
                      <Input
                        label="New due date & time"
                        type="datetime-local"
                        value={rescheduleAt}
                        onChange={(e) => setRescheduleAt(e.target.value)}
                      />
                      <div className="flex justify-end gap-1.5">
                        <Button variant="ghost" size="sm" onClick={() => setReschedulingId(null)}>
                          Cancel
                        </Button>
                        <Button variant="primary" size="sm" disabled={!rescheduleAt} onClick={() => handleReschedule(task.id)}>
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {isOpen(task) && (
                        <>
                          <Button variant="outline" size="sm" leftIcon={<Check size={12} />} onClick={() => handleComplete(task.id)}>
                            Complete
                          </Button>
                          <Button variant="ghost" size="sm" leftIcon={<RotateCcw size={12} />} onClick={() => openReschedule(task)}>
                            Reschedule
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-danger-600"
                            leftIcon={<XIcon size={12} />}
                            onClick={() => handleMissed(task.id)}
                          >
                            Cancel
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<ExternalLink size={12} />}
                        onClick={() => navigate(`/crm/leads/${task.leadId}`)}
                      >
                        View lead
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}

            {selectedDay && (
              <Button variant="outline" size="sm" leftIcon={<Plus size={13} />} onClick={() => openAddTaskOn(selectedDay)}>
                Add another task on this day
              </Button>
            )}
          </div>
        )}
      </Drawer>

      {/* Mounted only while open, so each open starts from a clean form. */}
      {isAddOpen && (
        <AddTaskModal
          isOpen
          onClose={() => setIsAddOpen(false)}
          onCreated={handleTaskCreated}
          defaultDueAt={addDefaultDueAt}
        />
      )}
    </div>
  );
}
