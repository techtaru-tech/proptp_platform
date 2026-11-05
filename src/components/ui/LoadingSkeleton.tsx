import { cn } from '../../utils/cn';

export function Skeleton({ className }: { className?: string }) {
  // Static on purpose: a page of pulsing blocks reads busier than the data it stands in for.
  return <div className={cn('rounded-md bg-surface-muted', className)} />;
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="w-full">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-line px-3 py-2.5">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn('h-3', c === 0 ? 'w-8' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
      <Skeleton className="h-7 w-24" />
    </div>
  );
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-xl border border-line bg-surface p-4', className)}>
      <Skeleton className="mb-4 h-4 w-32" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
