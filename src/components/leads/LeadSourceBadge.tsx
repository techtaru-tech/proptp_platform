import { LEAD_SOURCE_META } from '../../constants/leadSources';
import type { LeadSource } from '../../types';

/** Near-black brand colours (TikTok, X, website) vanish on a dark background; they take the text colour instead. */
function isNearBlack(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 48;
}

export function LeadSourceBadge({ source, otherSource }: { source: LeadSource; otherSource?: string }) {
  const meta = LEAD_SOURCE_META[source] ?? LEAD_SOURCE_META.other;
  const label = source === 'other' && otherSource ? otherSource : meta.label;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm bg-surface-muted px-1.5 py-px text-xs font-medium text-ink-muted">
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: isNearBlack(meta.color) ? 'currentColor' : meta.color }} />
      {label}
    </span>
  );
}
