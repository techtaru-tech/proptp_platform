import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Avatar } from '../ui/Avatar';
import { SearchInput } from '../ui/SearchInput';
import { Skeleton } from '../ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../context/ToastContext';
import { createFollowUp } from '../../services/followUpService';
import { listLeads, listAssignableUsers } from '../../services/leadService';
import { leadFullName } from '../../utils/format';
import type { Lead, LeadFollowUp, LeadPriority } from '../../types';

/** When the owner gets nudged, counted back from the due time. */
const REMINDER_OPTIONS = [
  { value: '0', label: 'At the due time' },
  { value: '15', label: '15 minutes before' },
  { value: '30', label: '30 minutes before' },
  { value: '60', label: '1 hour before' },
  { value: '180', label: '3 hours before' },
  { value: '1440', label: '1 day before' },
];

const PRIORITY_OPTIONS: { value: LeadPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

/** The lead a task is being created against — either picked in here, or fixed by the caller. */
export interface TaskLead {
  id: string;
  name: string;
  phone?: string;
  priority?: LeadPriority;
  assignedUserId?: string;
}

interface AddTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Fires after a successful create so the caller can refetch and, if it wants, jump to the new date. */
  onCreated: (task: LeadFollowUp) => void;
  /** `datetime-local` value to start from — the calendar passes the day that was clicked. */
  defaultDueAt?: string;
  /** Pass a lead to skip the picker entirely (e.g. from a lead's own page). */
  lead?: TaskLead;
}

export function AddTaskModal({ isOpen, onClose, onCreated, defaultDueAt, lead }: AddTaskModalProps) {
  const { toast } = useToast();
  const assignableUsers = listAssignableUsers();

  // Callers mount this only while it is open, so plain initial state is already a fresh form on
  // every open — no reset effect needed, and a cancelled attempt can't leak into the next one.
  const [selectedLead, setSelectedLead] = useState<TaskLead | null>(lead ?? null);
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState(defaultDueAt ?? '');
  const [priority, setPriority] = useState<LeadPriority>(lead?.priority ?? 'normal');
  const [assignedUserId, setAssignedUserId] = useState(lead?.assignedUserId ?? '');
  const [remindBefore, setRemindBefore] = useState('0');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const debouncedQuery = useDebounce(query, 300);
  // With no query this lists the newest leads, so the picker is useful before anyone types.
  const { data: leadResults, isLoading: isSearching } = useAsync(
    () => (isOpen && !selectedLead ? listLeads({ search: debouncedQuery.trim() || undefined, pageSize: 8 }) : Promise.resolve(null)),
    [isOpen, selectedLead, debouncedQuery]
  );

  const pickLead = (row: Lead) => {
    setSelectedLead({
      id: row.id,
      name: leadFullName(row),
      phone: row.phone,
      priority: row.priority,
      assignedUserId: row.assignedUserId,
    });
    // The lead's own priority/owner are the right defaults for a task about that lead.
    setPriority(row.priority ?? 'normal');
    setAssignedUserId(row.assignedUserId ?? '');
  };

  const canSubmit = !!selectedLead && !!title.trim() && !!dueAt && !isSubmitting;

  const handleSubmit = async () => {
    if (!selectedLead || !title.trim() || !dueAt) return;
    setIsSubmitting(true);
    try {
      const created = await createFollowUp({
        leadId: selectedLead.id,
        title: title.trim(),
        description: description.trim() || undefined,
        dueAt: new Date(dueAt).toISOString(),
        priority,
        assignedUserId: assignedUserId || undefined,
        remindBeforeMinutes: Number(remindBefore),
      });
      toast({ title: 'Task created', description: `${title.trim()} — for ${selectedLead.name}`, variant: 'success' });
      onCreated(created);
      onClose();
    } catch (err) {
      toast({ title: 'Could not create task', description: (err as Error).message, variant: 'error' });
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New Task"
      description="Schedule a follow-up against a lead."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit} isLoading={isSubmitting}>
            Create task
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">
            Lead<span className="text-danger-500"> *</span>
          </span>

          {selectedLead ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-subtle px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                <Avatar name={selectedLead.name} size="xs" />
                <span className="truncate text-sm text-ink">{selectedLead.name}</span>
                {selectedLead.phone && <span className="shrink-0 text-xs text-ink-faint">{selectedLead.phone}</span>}
              </span>
              {!lead && (
                <Button variant="ghost" size="sm" onClick={() => setSelectedLead(null)}>
                  Change
                </Button>
              )}
            </div>
          ) : (
            <>
              <SearchInput value={query} onChange={setQuery} placeholder="Search by name, phone or email" />
              <div className="max-h-44 overflow-y-auto rounded-lg border border-line">
                {isSearching ? (
                  <div className="flex flex-col gap-2 p-3">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-4 w-3/5" />
                  </div>
                ) : !leadResults || leadResults.items.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-ink-muted">No leads match this search.</p>
                ) : (
                  leadResults.items.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => pickLead(row)}
                      className="flex w-full items-center justify-between gap-2 border-b border-line px-3 py-2 text-left last:border-b-0 hover:bg-surface-subtle focus-ring"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Avatar name={leadFullName(row)} size="xs" />
                        <span className="truncate text-sm text-ink">{leadFullName(row)}</span>
                      </span>
                      <span className="shrink-0 text-xs text-ink-faint">{row.phone}</span>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        <Input
          label="Title"
          name="taskTitle"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Confirm site visit"
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Due date & time" name="taskDueAt" required type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          <Select
            label="Remind"
            name="taskRemindBefore"
            value={remindBefore}
            onChange={(e) => setRemindBefore(e.target.value)}
            options={REMINDER_OPTIONS}
            hint={assignedUserId ? undefined : 'Goes to whoever owns the lead.'}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Priority"
            name="taskPriority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as LeadPriority)}
            options={PRIORITY_OPTIONS}
          />
          <Select
            label="Assign to"
            name="taskAssignedUserId"
            value={assignedUserId}
            onChange={(e) => setAssignedUserId(e.target.value)}
            options={[{ value: '', label: 'Unassigned' }, ...assignableUsers.map((u) => ({ value: u.id, label: u.name }))]}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="task-description" className="text-sm font-medium text-ink">
            Description
          </label>
          <textarea
            id="task-description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Anything the person handling this should know."
            className="w-full rounded-lg border border-line-strong bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors hover:border-ink-faint focus-ring"
          />
        </div>
      </div>
    </Modal>
  );
}
