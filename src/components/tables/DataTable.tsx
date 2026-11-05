import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '../../utils/cn';
import { TableSkeleton } from '../ui/LoadingSkeleton';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  width?: string;
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  isLoading?: boolean;
  error?: Error;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (row: T) => void;
  /**
   * Where a row points. A row is a <tr>, not a link, so the browser has nothing to act on
   * when somebody ctrl/cmd- or middle-clicks it to open a record in a new tab: the click
   * handler fires instead and drags the tab they were working in off the list. Given this,
   * those clicks open a new tab and leave the current one alone, as a link would.
   */
  rowHref?: (row: T) => string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  onSortChange?: (key: string) => void;
}

const ALIGN_CLASSES = { left: 'text-left', right: 'text-right', center: 'text-center' };

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isLoading,
  error,
  onRetry,
  emptyTitle = 'No records found',
  emptyDescription = 'Try adjusting your filters or search terms.',
  onRowClick,
  rowHref,
  sortBy,
  sortDir,
  onSortChange,
}: DataTableProps<T>) {
  const openInNewTab = (row: T) => {
    if (!rowHref) return;
    window.open(rowHref(row), '_blank', 'noopener');
  };

  /** Anything but a plain left click is the browser's business, not the row handler's. */
  const wantsNewTab = (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; button: number }) =>
    e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1;

  /**
   * True when the click landed on a real link inside the row. The browser is already opening
   * that link; opening it again here would hand back two tabs showing the same record, which
   * is exactly what it looks like when the wrong one appears to have followed the right one.
   *
   * A middle click is why this cannot be left to stopPropagation: it fires `auxclick`, not
   * `click`, so a handler the link put on `onClick` never runs and the row hears it anyway.
   */
  const insideLink = (e: { target: EventTarget | null }) =>
    e.target instanceof Element && !!e.target.closest('a[href]');

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-subtle">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                style={col.width ? { width: col.width } : undefined}
                className={cn('whitespace-nowrap px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-ink-subtle', ALIGN_CLASSES[col.align ?? 'left'])}
              >
                {col.sortable && onSortChange ? (
                  <button
                    type="button"
                    onClick={() => onSortChange(col.key)}
                    className="inline-flex items-center gap-1 rounded uppercase tracking-wider hover:text-ink focus-ring"
                  >
                    {col.header}
                    {sortBy === col.key ? sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowUpDown size={12} className="opacity-40" />}
                  </button>
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        {!isLoading && !error && rows.length > 0 && (
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={(e) => {
                  if (insideLink(e)) return;
                  if (wantsNewTab(e)) {
                    // Without this the current tab would follow the row as well.
                    e.preventDefault();
                    openInNewTab(row);
                    return;
                  }
                  onRowClick?.(row);
                }}
                onAuxClick={(e) => {
                  if (e.button === 1 && !insideLink(e)) {
                    e.preventDefault();
                    openInNewTab(row);
                  }
                }}
                className={cn('border-b border-line transition-colors duration-100 last:border-0', onRowClick && 'cursor-pointer hover:bg-surface-subtle')}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn('px-3 py-2 align-middle text-ink', ALIGN_CLASSES[col.align ?? 'left'], col.className)}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        )}
      </table>
      {isLoading && <TableSkeleton cols={columns.length} />}
      {!isLoading && error && (
        <div className="border-t border-line">
          <ErrorState onRetry={onRetry} />
        </div>
      )}
      {!isLoading && !error && rows.length === 0 && (
        <div className="border-t border-line">
          <EmptyState title={emptyTitle} description={emptyDescription} />
        </div>
      )}
    </div>
  );
}
