import { useState, type ReactNode } from 'react';
import { cn } from '../../utils/cn';

export interface TabItem {
  key: string;
  label: string;
  icon?: ReactNode;
  badge?: number | string;
}

interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (key: string) => void;
  children?: (activeKey: string) => ReactNode;
}

export function Tabs({ items, value, defaultValue, onChange, children }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue ?? items[0]?.key);
  const active = value ?? internal;

  const select = (key: string) => {
    setInternal(key);
    onChange?.(key);
  };

  return (
    <div>
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line scrollbar-none">
        {items.map((item) => (
          <button
            key={item.key}
            role="tab"
            type="button"
            aria-selected={active === item.key}
            onClick={() => select(item.key)}
            className={cn(
              'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors duration-150 focus-ring',
              active === item.key ? 'text-ink' : 'text-ink-subtle hover:text-ink'
            )}
          >
            {item.icon}
            {item.label}
            {item.badge !== undefined && (
              <span className="rounded-sm bg-surface-muted px-1.5 text-2xs font-semibold tabular-nums text-ink-muted">{item.badge}</span>
            )}
            {active === item.key && <span className="absolute inset-x-2 -bottom-px h-0.5 bg-brand-600" />}
          </button>
        ))}
      </div>
      {children && <div className="pt-3">{children(active)}</div>}
    </div>
  );
}
