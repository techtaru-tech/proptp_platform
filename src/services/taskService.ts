import type { Task, TaskAssignee, TaskComment, TaskPriority, TaskScopeKind, TaskStatus } from '../types';
import { api, toQueryString } from './apiClient';
import type { ListResult } from './mockClient';

/**
 * Task management (server/src/routes/tasks.ts).
 *
 * Nothing here decides who may see or assign what — the server resolves that from the
 * signed-in user's role and this layer simply renders what comes back. `getTaskAccess()` is
 * how a screen learns which filters and pickers are worth showing.
 */

export interface TaskFilters {
  search?: string;
  status?: TaskStatus | 'all';
  priority?: TaskPriority | 'all';
  assigneeId?: string | 'all';
  createdById?: string | 'all';
  dueFrom?: string;
  dueTo?: string;
  /** Only tasks past their due date and still open. */
  overdue?: boolean;
}

export interface TaskListParams extends TaskFilters {
  page?: number;
  pageSize?: number;
  sortBy?: 'dueAt' | 'title' | 'createdAt';
  sortDir?: 'asc' | 'desc';
}

/** Filters, minus the "all" sentinels the server has no use for. */
function toQuery(params: object): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '' || value === 'all' || value === false) continue;
    clean[key] = value;
  }
  return clean;
}

export interface TaskAccess {
  /** 'all' = every task, 'team' = mine and my team's, 'own' = only mine. */
  scope: TaskScopeKind;
  currentUserId: string;
  users: TaskAssignee[];
}

export async function getTaskAccess(): Promise<TaskAccess> {
  return api.get<TaskAccess>('/tasks/assignable');
}

export interface TaskStats {
  total: number;
  open: number;
  overdue: number;
  dueToday: number;
  completed: number;
}

export async function getTaskStats(filters: TaskFilters = {}): Promise<TaskStats> {
  return api.get<TaskStats>(`/tasks/stats${toQueryString(toQuery(filters))}`);
}

export async function listTasks(params: TaskListParams = {}): Promise<ListResult<Task>> {
  return api.get<ListResult<Task>>(`/tasks${toQueryString(toQuery(params))}`);
}

export interface TaskBoardColumn {
  status: TaskStatus;
  /** How many tasks the column holds in total, which can exceed `items` on a busy board. */
  total: number;
  items: Task[];
}

export async function getTaskBoard(filters: TaskFilters = {}): Promise<{ columns: TaskBoardColumn[] }> {
  return api.get<{ columns: TaskBoardColumn[] }>(`/tasks/board${toQueryString(toQuery(filters))}`);
}

export async function getTask(id: string): Promise<{ task: Task; comments: TaskComment[] }> {
  return api.get<{ task: Task; comments: TaskComment[] }>(`/tasks/${id}`);
}

export interface TaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueAt?: string | null;
  /** Left off, the server assigns it to whoever is creating it. */
  assigneeId?: string;
}

export async function createTask(input: TaskInput): Promise<Task> {
  return api.post<Task>('/tasks', input);
}

export async function updateTask(id: string, input: Partial<TaskInput>): Promise<Task> {
  return api.patch<Task>(`/tasks/${id}`, input);
}

/** The board's drag-and-drop. Separate from `updateTask` so a drop can only move a card. */
export async function moveTask(id: string, status: TaskStatus): Promise<Task> {
  return api.patch<Task>(`/tasks/${id}/status`, { status });
}

export async function addTaskComment(id: string, body: string): Promise<TaskComment> {
  return api.post<TaskComment>(`/tasks/${id}/comments`, { body });
}

export async function deleteTask(id: string): Promise<void> {
  await api.delete(`/tasks/${id}`);
}

// ---------------------------------------------------------------------------
// Display helpers — one definition each, shared by the list, the board and the detail page.
// ---------------------------------------------------------------------------

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

/** The board's columns, in order. `cancelled` is deliberately not one — it is not a stage of work. */
export const TASK_BOARD_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'done'];

export const TASK_STATUS_OPTIONS = (Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map((value) => ({
  value,
  label: TASK_STATUS_LABEL[value],
}));

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

export const TASK_PRIORITY_OPTIONS = (Object.keys(TASK_PRIORITY_LABEL) as TaskPriority[]).map((value) => ({
  value,
  label: TASK_PRIORITY_LABEL[value],
}));

export const TASK_STATUS_TONE: Record<TaskStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  todo: 'neutral',
  in_progress: 'info',
  blocked: 'danger',
  done: 'success',
  cancelled: 'neutral',
};

export const TASK_PRIORITY_TONE: Record<TaskPriority, 'neutral' | 'info' | 'warning' | 'danger'> = {
  low: 'neutral',
  normal: 'info',
  high: 'warning',
  urgent: 'danger',
};

/** The colour strip on a board card — priority, because that is what you scan a board for. */
export const TASK_PRIORITY_BAR: Record<TaskPriority, string> = {
  low: 'bg-line-strong',
  normal: 'bg-accent-500',
  high: 'bg-warning-500',
  urgent: 'bg-danger-500',
};
