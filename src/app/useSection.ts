import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { NAV_SECTIONS, type NavItem } from './navConfig';
import { usePermissions } from './usePermissions';
import type { SectionKey } from '../services/sectionService';

export interface SectionTab { label: string; to: string }
export interface CurrentSection {
  key: SectionKey;
  label: string;
  overview: string;
  /** The pages of the section this person may open, Overview first. */
  tabs: SectionTab[];
  /** The tab the current page sits under. */
  active?: string;
  onOverview: boolean;
}

const under = (path: string, to: string) => path === to || path.startsWith(`${to}/`);

/**
 * Which sidebar section the current page belongs to — only the sections that have an Overview
 * (not Dashboard or CRM). The deepest matching link wins, so /payouts/payroll is HRMS (where the
 * sidebar lists Payroll) rather than Finance.
 */
export function useSection(): CurrentSection | null {
  const { pathname } = useLocation();
  const { navItems, can } = usePermissions();

  return useMemo(() => {
    let best: { section: (typeof NAV_SECTIONS)[number]; len: number } | undefined;
    for (const section of NAV_SECTIONS) {
      if (!section.overview || !section.overview.modules.some(can)) continue;
      const items = section.items.map((l) => navItems.find((i) => i.label === l)).filter((i): i is NavItem => !!i);
      const links = [section.overview.to, ...items.flatMap((i) => [i.to, ...(i.children ?? []).map((c) => c.to)])];
      for (const to of links) if (under(pathname, to) && (!best || to.length > best.len)) best = { section, len: to.length };
    }
    if (!best) return null;

    const { section } = best;
    const items = section.items.map((l) => navItems.find((i) => i.label === l)).filter((i): i is NavItem => !!i);
    // One item (HRMS, Tasks, Reports): its pages are the tabs. Several (Real Estate): one tab per item.
    const pages: SectionTab[] = items.length === 1
      ? (items[0].children ?? [items[0]]).map((c) => ({ label: c.label, to: c.to }))
      : items.map((i) => ({ label: i.label, to: i.to }));
    const tabs = [{ label: 'Overview', to: section.overview!.to }, ...pages];
    const active = tabs.reduce<SectionTab | undefined>((b, t) => (under(pathname, t.to) && (!b || t.to.length > b.to.length) ? t : b), undefined)?.to;
    return {
      key: section.overview!.to.replace('/overview/', '') as SectionKey,
      label: section.label,
      overview: section.overview!.to,
      tabs,
      active,
      onOverview: pathname === section.overview!.to,
    };
  }, [pathname, navItems, can]);
}
