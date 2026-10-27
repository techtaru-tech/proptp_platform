import { useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { NAV_SECTIONS, type NavItem, type NavSection } from './navConfig';
import { usePermissions } from './usePermissions';

export interface OpenSection extends Omit<NavSection, 'items'> {
  /** Only the items this person may open. */
  items: NavItem[];
  /** The page a tab opens: its first item, or that item's first page. */
  firstPath: string;
}

/**
 * The top-level sections this person can see, and which one the current page belongs to.
 *
 * A section drops out when none of its items are open to them. The page decides the active section
 * (the longest matching path wins, so /payouts/payroll is HRMS rather than Payouts); a page that
 * is in no section, such as a profile screen, keeps whichever section was last active.
 */
export function useNavSections() {
  const { navItems } = usePermissions();
  const { pathname } = useLocation();

  const sections: OpenSection[] = useMemo(
    () =>
      NAV_SECTIONS.map((section) => {
        const items = section.items.map((label) => navItems.find((i) => i.label === label)).filter((i): i is NavItem => !!i);
        const first = items[0];
        return { ...section, items, firstPath: first?.children?.[0]?.to ?? first?.to ?? '/dashboard' };
      }).filter((section) => section.items.length > 0),
    [navItems]
  );

  const fromPath = useMemo(() => {
    let best: { label: string; len: number } | undefined;
    for (const section of sections) {
      for (const item of section.items) {
        for (const target of [item.to, ...(item.children ?? []).map((c) => c.to)]) {
          if ((pathname === target || pathname.startsWith(`${target}/`)) && (!best || target.length > best.len)) {
            best = { label: section.label, len: target.length };
          }
        }
      }
    }
    return best?.label;
  }, [sections, pathname]);

  const last = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (fromPath) last.current = fromPath;
  }, [fromPath]);

  const activeLabel = fromPath ?? last.current ?? sections[0]?.label;
  return { sections, active: sections.find((s) => s.label === activeLabel) };
}
