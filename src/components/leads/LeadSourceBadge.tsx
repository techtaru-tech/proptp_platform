import { LEAD_SOURCE_META } from '../../constants/leadSources';
import type { LeadSource } from '../../types';

export function LeadSourceBadge({ source, otherSource }: { source: LeadSource; otherSource?: string }) {
  const meta = LEAD_SOURCE_META[source] ?? LEAD_SOURCE_META.other;
  const label = source === 'other' && otherSource ? otherSource : meta.label;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm bg-surface-muted px-1.5 py-px text-xs font-medium text-ink-muted">
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
      {label}
    </span>
  );
}
