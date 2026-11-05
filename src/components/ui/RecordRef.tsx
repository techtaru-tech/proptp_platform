import { cn } from '../../utils/cn';

interface RecordLike {
  id: string;
  /** Human reference the server issues, e.g. "BKG-20501". Preferred whenever it exists. */
  reference?: string;
  bookingReference?: string;
}

/**
 * How a record is named in a table. Database ids are 25-character cuids that nobody reads, so a
 * record without a reference shows the last six characters, with the full id on hover.
 */
export function RecordRef({ row, className }: { row: RecordLike; className?: string }) {
  // Some rows already carry a readable id ("BKG-20521"); only a cuid needs shortening.
  const isCuid = /^c[a-z0-9]{20,}$/.test(row.id);
  const ref = row.reference || row.bookingReference || (isCuid ? undefined : row.id);
  return (
    <span className={cn('whitespace-nowrap font-mono text-xs text-ink-muted', className)} title={row.id}>
      {ref ?? `#${row.id.slice(-6).toUpperCase()}`}
    </span>
  );
}
