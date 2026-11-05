import type { ReactNode } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { SearchInput } from '../ui/SearchInput';

interface FilterBarProps {
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  children?: ReactNode;
  onReset?: () => void;
  hasActiveFilters?: boolean;
  actions?: ReactNode;
}

export function FilterBar({ search, onSearchChange, searchPlaceholder, children, onReset, hasActiveFilters, actions }: FilterBarProps) {
  return (
    <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {onSearchChange && <SearchInput value={search ?? ''} onChange={onSearchChange} placeholder={searchPlaceholder} className="w-full sm:w-72" />}
        {children}
        {onReset && hasActiveFilters && (
          <Button variant="ghost" size="sm" leftIcon={<X size={13} />} onClick={onReset}>
            Clear filters
          </Button>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function FilterIcon() {
  return <SlidersHorizontal size={13} className="text-ink-faint" />;
}
