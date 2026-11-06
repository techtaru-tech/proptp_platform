import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../utils/cn';

/** A dashboard section: hairline border, no shadow, the same 8px radius as every other panel. */
export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('flex flex-col rounded-xl border border-line bg-surface', className)}>{children}</section>;
}

export function PanelHeader({ title, meta, action, ask }: { title: string; meta?: ReactNode; action?: ReactNode; ask?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className="shrink-0 font-sans text-[13px] font-semibold tracking-normal text-ink">{title}</h2>
        {meta && <span className="truncate text-xs text-ink-subtle">{meta}</span>}
      </div>
      {(ask || action) && <span className="flex shrink-0 items-center gap-1.5">{ask}{action}</span>}
    </header>
  );
}

export function ViewAll({ to, label = 'View all' }: { to: string; label?: string }) {
  return (
    <Link to={to} className="shrink-0 rounded text-xs font-medium text-ink-subtle hover:text-brand-700 focus-ring">
      {label} →
    </Link>
  );
}

/** "↑ 12.4%" in green or "↓ 3.0%" in red; the arrow carries the direction, not just the colour. */
export function Delta({ value, className }: { value: number | null; className?: string }) {
  if (value == null || !Number.isFinite(value)) return null;
  const up = value >= 0;
  return (
    <span className={cn('font-medium tabular-nums', up ? 'text-success-700' : 'text-danger-600', className)}>
      {up ? '↑' : '↓'} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

/** One figure in the stat strip. */
export function Stat({ label, value, meta, to, tone }: { label: string; value: ReactNode; meta?: ReactNode; to?: string; tone?: 'danger' }) {
  const body = (
    <>
      <p className="text-xs text-ink-subtle">{label}</p>
      <p className={cn('mt-1 text-xl font-semibold leading-none tracking-tight tabular-nums', tone === 'danger' ? 'text-danger-700' : 'text-ink')}>{value}</p>
      {meta && <p className="mt-1.5 truncate text-xs text-ink-subtle">{meta}</p>}
    </>
  );
  const cls = 'block min-w-0 px-4 py-3';
  return to
    ? <Link to={to} className={cn(cls, 'transition-colors duration-150 hover:bg-surface-subtle focus-ring')}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

/** A label/value line in a definition list, linking to the records behind the number. */
export function Row({ to, label, value, sub, danger }: { to: string; label: string; value: ReactNode; sub?: string; danger?: boolean }) {
  return (
    <li>
      <Link to={to} className="flex items-baseline justify-between gap-3 px-4 py-2 text-[13px] transition-colors duration-100 hover:bg-surface-subtle focus-ring">
        <span className="truncate text-ink-muted">{label}</span>
        <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
          {sub && <span className="text-xs text-ink-faint">{sub}</span>}
          <span className={cn('font-semibold', danger ? 'text-danger-700' : 'text-ink')}>{value}</span>
        </span>
      </Link>
    </li>
  );
}
