import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { DatePicker } from '../../components/ui/DatePicker';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import type { TaskPriority, TaskStatus } from '../../types';
import {
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
  createTask,
  getTask,
  getTaskAccess,
  updateTask,
} from '../../services/taskService';

/** A date input wants `yyyy-mm-dd`; the API speaks ISO. */
function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

/**
 * Create or edit a task.
 *
 * The assignee dropdown is filled from `/tasks/assignable`, so an employee is offered only
 * themselves and an agent only their team — the same list the server will accept on save.
 */
export function TaskForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { toast } = useToast();

  const access = useAsync(() => getTaskAccess(), []);
  const existing = useAsync(() => (id ? getTask(id) : Promise.resolve(undefined)), [id]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [dueAt, setDueAt] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Defaults come from two different places — the task being edited, or the current user for a
  // new one — so they are applied once each has arrived rather than in useState initialisers.
  useEffect(() => {
    const task = existing.data?.task;
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description);
    setStatus(task.status);
    setPriority(task.priority);
    setDueAt(toDateInput(task.dueAt));
    setAssigneeId(task.assigneeId);
  }, [existing.data]);

  useEffect(() => {
    if (isEdit || !access.data) return;
    setAssigneeId((current) => current || access.data!.currentUserId);
  }, [access.data, isEdit]);

  const assigneeOptions = (access.data?.users ?? []).map((u) => ({
    value: u.id,
    label: u.id === access.data?.currentUserId ? `${u.name} (me)` : u.name,
  }));
  const canChooseAssignee = (access.data?.scope ?? 'own') !== 'own';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('A title is required.');
      return;
    }

    setError('');
    setIsSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        status,
        priority,
        // A date input gives a local day; send it as the end of that day so a task due "today"
        // is not already overdue the moment it is saved.
        dueAt: dueAt ? new Date(`${dueAt}T23:59:59`).toISOString() : null,
        assigneeId: assigneeId || undefined,
      };

      if (isEdit && id) {
        await updateTask(id, payload);
        toast({ title: 'Task updated', variant: 'success' });
        navigate(`/tasks/${id}`);
      } else {
        const created = await createTask(payload);
        toast({ title: 'Task created', variant: 'success' });
        navigate(`/tasks/${created.id}`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  if (isEdit && existing.isLoading) return <CardSkeleton />;
  if (isEdit && existing.error) return <ErrorState description={existing.error.message} />;

  return (
    <div>
      <PageHeader
        title={isEdit ? 'Edit Task' : 'New Task'}
        description={isEdit ? 'Update the details of this task.' : 'Raise a task for yourself or somebody on your team.'}
        breadcrumb={[
          { label: 'Tasks', to: '/tasks' },
          ...(isEdit ? [{ label: 'Task', to: `/tasks/${id}` }] : []),
          { label: isEdit ? 'Edit' : 'New' },
        ]}
      />

      <form onSubmit={handleSubmit}>
        <Card className="max-w-3xl">
          <CardHeader title="Task details" subtitle="Only a title is required." />

          <div className="flex flex-col gap-5">
            <Input
              label="Title"
              name="taskTitle"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Call back the Vesu site visitors"
            />

            <Textarea
              label="Description"
              value={description}
              onChange={setDescription}
              rows={4}
              placeholder="Any context whoever picks this up will need."
            />

            <div className="grid gap-5 sm:grid-cols-2">
              <Select
                label="Assignee"
                name="taskAssignee"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                options={assigneeOptions}
                disabled={!canChooseAssignee}
                hint={canChooseAssignee ? undefined : 'Your role can only create tasks for yourself.'}
              />
              <DatePicker label="Due date" name="taskDueDate" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Select
                label="Status"
                name="taskStatus"
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                options={TASK_STATUS_OPTIONS}
              />
              <Select
                label="Priority"
                name="taskPriority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                options={TASK_PRIORITY_OPTIONS}
              />
            </div>

            {error && (
              <div className="rounded-lg border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</div>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-2 border-t border-line pt-5">
            <Button type="button" variant="outline" onClick={() => navigate(isEdit ? `/tasks/${id}` : '/tasks')}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSaving}>
              {isEdit ? 'Save changes' : 'Create task'}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
