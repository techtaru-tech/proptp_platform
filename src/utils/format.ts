/** A lead/partner-shaped record's display name — trims a possibly-empty last name cleanly. */
export function leadFullName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`.trim();
}

/**
 * Accepts `null` as well as `undefined` for an "unset" amount — real API responses (Postgres via
 * Prisma/JSON) use `null` for an absent optional field where the old mock data used `undefined`,
 * and a bare `!== undefined` check at a call site lets a `null` slip through to `.toLocaleString()`
 * and throw. Defended here too so that mistake can't crash a page.
 */
/**
 * Money is stored and calculated in rupees. When Settings > Organization turns points on, the
 * panel shows every amount as points instead (1 rupee = `pointsPerRupee` points), with "pts"
 * where the rupee sign would be. Only what is shown changes, never what is stored.
 */
let display = { enabled: false, perRupee: 10 };
export function setMoneyDisplay(s: { pointsEnabled: boolean; pointsPerRupee: number }) {
  display = { enabled: !!s.pointsEnabled, perRupee: s.pointsPerRupee > 0 ? s.pointsPerRupee : 10 };
}
/** Points in one rupee as shown: 1 when points are off. */
export const moneyFactor = () => (display.enabled ? display.perRupee : 1);
/** The unit to put in a label: "₹" or "points". */
export const moneyUnit = () => (display.enabled ? 'points' : '₹');

function money(amount: number, short: boolean): string {
  const v = amount * moneyFactor();
  const sign = display.enabled ? '' : '₹';
  const unit = display.enabled ? ' pts' : '';
  if (short && Math.abs(v) >= 10000000) return `${sign}${(v / 10000000).toFixed(2)} Cr${unit}`;
  if (short && Math.abs(v) >= 100000) return `${sign}${(v / 100000).toFixed(2)} L${unit}`;
  return `${sign}${(display.enabled ? Math.round(v * 100) / 100 : v).toLocaleString('en-IN')}${unit}`;
}

export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return money(amount, true);
}

export function formatFullCurrency(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return money(amount, false);
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '\u00a0');
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** To the second, for anywhere the exact moment matters — a call log, an audit trail. */
export function formatDateTimeExact(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return formatDate(iso);
}

export function maskAccountNumber(acc: string): string {
  if (acc.length <= 4) return acc;
  return `XXXX XXXX ${acc.slice(-4)}`;
}

export function maskPan(pan: string): string {
  if (pan.length < 10) return pan;
  return `${pan.slice(0, 2)}XXXXX${pan.slice(-3)}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function formatHours(hours?: number): string {
  if (hours === undefined) return '—';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
}
