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
  let best: { item: (typeof NAV_ITEMS)[number]; child: { label: string; to: string } } | undefined;
  for (const item of NAV_ITEMS) {
    for (const c of item.children ?? []) {
      if ((pathname === c.to || pathname.startsWith(`${c.to}/`)) && (!best || c.to.length > best.child.to.length)) best = { item, child: c };
    }
  }
  if (best) return { sectionLabel: best.item.label, childLabel: best.child.label };

  // Pass 2: fall back to matching the top-level path segment (e.g. a dynamic
  // detail route like /attendance/:id that isn't a literal child path).
  const segment = topSegment(pathname);
  for (const item of NAV_ITEMS) {
    if (topSegment(item.to) === segment) return { sectionLabel: item.label };
  }

  return { sectionLabel: 'Dashboard' };
}
