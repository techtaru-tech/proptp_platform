import { NAV_ITEMS } from './navConfig';

export interface CrumbInfo {
  sectionLabel: string;
  childLabel?: string;
}

function topSegment(path: string): string {
  return path.split('/').filter(Boolean)[0] ?? '';
}

/** Best-effort breadcrumb derived from the nav config for the persistent top header. */
export function resolveBreadcrumb(pathname: string): CrumbInfo {
  // Pass 1: exact match against a known child route (e.g. /attendance/today).
  // Prefer the longest matching `to` so a section-root child (e.g. CRM's
  // "Overview" at `/crm`) doesn't shadow more specific siblings like `/crm/leads`.
  for (const item of NAV_ITEMS) {
    if (!item.children) continue;
    const matches = item.children.filter((c) => pathname === c.to || pathname.startsWith(`${c.to}/`));
    if (matches.length > 0) {
      const best = matches.reduce((a, b) => (b.to.length > a.to.length ? b : a));
      return { sectionLabel: item.label, childLabel: best.label };
    }
  }

  // Pass 2: fall back to matching the top-level path segment (e.g. a dynamic
  // detail route like /attendance/:id that isn't a literal child path).
  const segment = topSegment(pathname);
  for (const item of NAV_ITEMS) {
    if (topSegment(item.to) === segment) return { sectionLabel: item.label };
  }

  return { sectionLabel: 'Dashboard' };
}
