import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

export interface FilterChip {
  key: string;
  label: string;
  /** Optional count shown after the label. */
  count?: number;
  /** Optional leading dot or icon, e.g. a type colour. */
  icon?: ReactNode;
}

/**
 * One-click views above a list ("All · Hot · Won · Unassigned"). Exactly one is on at a time;
 * the selected chip is filled, the rest are outlined.
 */
export function FilterChips({ items, value, onChange, label = 'Quick filters', className }: {
  items: FilterChip[];
  value: string;
  onChange: (key: string) => void;
  /** Accessible name for the group. */
  label?: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {items.map((c) => {
        const on = c.key === value;
        return (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(c.key)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-100 focus-ring',
              on ? 'border-ink bg-ink text-surface' : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink'
            )}
          >
            {c.icon}
            {c.label}
            {c.count !== undefined && (
              <span className={cn('tabular-nums', on ? 'opacity-70' : 'text-ink-faint')}>{c.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
