import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CalendarClock, MessageSquare, Pencil, Trash2, UserRound } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Select } from '../../components/ui/Select';
import { Avatar } from '../../components/ui/Avatar';
import { Textarea } from '../../components/ui/Textarea';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { formatDate, formatDateTime, formatRelativeTime } from '../../utils/format';
import type { TaskStatus } from '../../types';
import {
  TASK_PRIORITY_LABEL,
  TASK_PRIORITY_TONE,
  TASK_STATUS_LABEL,
  TASK_STATUS_OPTIONS,
  TASK_STATUS_TONE,
  addTaskComment,
  deleteTask,
  getTask,
  updateTask,
} from '../../services/taskService';

export function TaskDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [reloadKey, setReloadKey] = useState(0);
  const [comment, setComment] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const detail = useAsync(() => getTask(id), [id, reloadKey]);
  const reload = () => setReloadKey((k) => k + 1);

  const handleStatusChange = async (status: TaskStatus) => {
    try {
      await updateTask(id, { status });
      toast({ title: `Moved to ${TASK_STATUS_LABEL[status]}`, variant: 'success' });
      reload();
    } catch (err) {
      toast({ title: 'Could not update task', description: (err as Error).message, variant: 'error' });
    }
  };

  const handleComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;
    setIsPosting(true);
    try {
      await addTaskComment(id, comment.trim());
      setComment('');
      reload();
    } catch (err) {
      toast({ title: 'Could not post comment', description: (err as Error).message, variant: 'error' });
    } finally {
      setIsPosting(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteTask(id);
      toast({ title: 'Task deleted', variant: 'success' });
      navigate('/tasks');
    } catch (err) {
      toast({ title: 'Could not delete task', description: (err as Error).message, variant: 'error' });
      setIsConfirmingDelete(false);
    }
  };

  if (detail.isLoading) return <CardSkeleton />;
  if (detail.error) return <ErrorState description={detail.error.message} onRetry={reload} />;
  if (!detail.data) return null;

  const { task, comments } = detail.data;

  return (
    <div>
      <PageHeader
        title={task.title}
        description={`Raised by ${task.createdByName} · ${formatRelativeTime(task.createdAt)}`}
        breadcrumb={[{ label: 'Tasks', to: '/tasks' }, { label: 'Task' }]}
        actions={
          <>
            <Button variant="outline" leftIcon={<Pencil size={14} />} onClick={() => navigate(`/tasks/${id}/edit`)}>
              Edit
            </Button>
            <Button variant="outline" leftIcon={<Trash2 size={14} />} onClick={() => setIsConfirmingDelete(true)}>
              Delete
            </Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          <Card>
            <CardHeader title="Description" />
            {task.description ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">{task.description}</p>
            ) : (
              <p className="text-sm text-ink-faint">No description was added.</p>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Comments"
              subtitle={comments.length === 1 ? '1 comment' : `${comments.length} comments`}
            />

            <div className="flex flex-col gap-4">
              {comments.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-ink-faint">
                  <MessageSquare size={14} />
                  Nothing discussed yet.
                </p>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className="flex gap-3">
                    <Avatar name={c.authorName} src={c.authorAvatarUrl} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-sm font-medium text-ink">{c.authorName}</span>
                        <span className="text-xs text-ink-faint">{formatDateTime(c.createdAt)}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">{c.body}</p>
                    </div>
                  </div>
                ))
              )}

              <form onSubmit={handleComment} className="border-t border-line pt-4">
                <Textarea label="Add a comment" value={comment} onChange={setComment} rows={3} placeholder="Leave an update..." />
                <div className="mt-3 flex justify-end">
                  <Button type="submit" size="sm" isLoading={isPosting} disabled={!comment.trim()}>
                    Post comment
                  </Button>
                </div>
              </form>
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Status" />
            <Select
              aria-label="Status"
              value={task.status}
              onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
              options={TASK_STATUS_OPTIONS}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone={TASK_STATUS_TONE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Badge>
              <Badge tone={TASK_PRIORITY_TONE[task.priority]} dot>
                {TASK_PRIORITY_LABEL[task.priority]}
              </Badge>
              {task.isOverdue && <Badge tone="danger">Overdue</Badge>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Details" />
            <dl className="flex flex-col gap-3.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-1.5 text-ink-muted">
                  <UserRound size={14} className="text-ink-faint" />
                  Assignee
                </dt>
                <dd className="flex min-w-0 items-center gap-2">
                  <Avatar name={task.assigneeName} src={task.assigneeAvatarUrl} size="xs" />
                  <span className="truncate font-medium text-ink">{task.assigneeName}</span>
                </dd>
              </div>

              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-1.5 text-ink-muted">
                  <CalendarClock size={14} className="text-ink-faint" />
                  Due
                </dt>
                <dd className={task.isOverdue ? 'font-medium text-danger-600' : 'text-ink'}>
                  {task.dueAt ? formatDate(task.dueAt) : '—'}
                </dd>
              </div>

              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-muted">Created by</dt>
                <dd className="truncate text-ink">{task.createdByName}</dd>
              </div>

              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-muted">Created</dt>
                <dd className="text-ink">{formatDate(task.createdAt)}</dd>
              </div>

              {task.completedAt && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-ink-muted">Completed</dt>
                  <dd className="text-success-700">{formatDate(task.completedAt)}</dd>
                </div>
              )}
            </dl>
          </Card>
        </div>
      </div>

      <ConfirmationDialog
        isOpen={isConfirmingDelete}
        onClose={() => setIsConfirmingDelete(false)}
        onConfirm={handleDelete}
        title="Delete task"
        description={`"${task.title}" will be removed permanently, along with its comments.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
