import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../utils/cn';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Passing this shows a rows-per-page picker; leaving it off keeps the old fixed size. */
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
}

export function Pagination({
  page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions = [10, 25, 50, 100],
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  const pageNumbers = (): (number | 'ellipsis')[] => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const nums = new Set<number>([1, totalPages, page, page - 1, page + 1]);
    const sorted = [...nums].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
    const result: (number | 'ellipsis')[] = [];
    sorted.forEach((n, i) => {
      if (i > 0 && n - (sorted[i - 1] as number) > 1) result.push('ellipsis');
      result.push(n);
    });
    return result;
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2">
      <div className="flex items-center gap-3">
        <p className="text-xs text-ink-muted">
          Showing <span className="font-medium text-ink">{start}</span>–<span className="font-medium text-ink">{end}</span> of{' '}
          <span className="font-medium text-ink">{total}</span>
        </p>
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            Rows
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              aria-label="Rows per page"
              className="rounded-md border border-line-strong bg-surface px-1.5 py-1 text-xs text-ink focus-ring"
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted disabled:opacity-40 disabled:pointer-events-none focus-ring"
        >
          <ChevronLeft size={16} />
        </button>
        {pageNumbers().map((n, i) =>
          n === 'ellipsis' ? (
            <span key={`e-${i}`} className="px-1 text-xs text-ink-faint">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              onClick={() => onPageChange(n)}
              className={cn(
                'flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-xs font-medium focus-ring',
                n === page ? 'bg-shell-800 text-white' : 'text-ink-muted hover:bg-surface-muted'
              )}
            >
              {n}
            </button>
          )
        )}
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
          className="flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted disabled:opacity-40 disabled:pointer-events-none focus-ring"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
