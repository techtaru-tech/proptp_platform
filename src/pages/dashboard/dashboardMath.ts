/** Percentage change, or null when there is no base period to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

/** Axis labels only; tooltips use the full formatter, which also respects the points display. */
export function compactMoney(v: number): string {
  if (v >= 1e7) return `${+(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `${+(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `${+(v / 1e3).toFixed(0)}K`;
  return String(v);
}

/** "just now", "4 min ago", "2 h ago" — for the "Updated" stamp, which never gets older than a day. */
export function sinceLabel(from: number, now: number): string {
  const min = Math.floor((now - from) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)} h ago`;
}
