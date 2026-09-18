import { Eye } from 'lucide-react';
import type { TaskScopeKind } from '../../types';

const NOTES: Record<TaskScopeKind, string | null> = {
  // An admin sees everything, which needs no explaining.
  all: null,
  team: 'You are seeing your own tasks and your team’s.',
  own: 'You are seeing your own tasks. Ask an admin to assign work to someone else.',
};

/**
 * Says out loud how wide the current user's view is.
 *
 * Without it, an employee looking at an empty board cannot tell whether there is no work or
 * whether they simply cannot see anyone else's — and the two call for very different reactions.
 */
export function TaskScopeNote({ scope }: { scope: TaskScopeKind }) {
  const note = NOTES[scope];
  if (!note) return null;

  return (
    <div className="mb-5 flex items-center gap-2.5 rounded-lg border border-line bg-surface-subtle px-4 py-2.5 text-sm text-ink-muted">
      <Eye size={15} className="shrink-0 text-ink-faint" />
      <p>{note}</p>
    </div>
  );
}
