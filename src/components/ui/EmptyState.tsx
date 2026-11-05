import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 px-6 py-10 text-center">
      <Icon size={18} className="text-ink-faint" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        {description && <p className="mt-0.5 max-w-sm text-xs text-ink-subtle">{description}</p>}
      </div>
      {action}
    </div>
  );
}
