import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { NAV_ITEMS, type ModuleKey, type NavItem } from './navConfig';

/**
 * What the signed-in panel user may open. The server enforces the same list (see
 * server/src/services/permissions.ts) — this only decides what is worth rendering, so a
 * hidden module is still refused if someone types its URL or calls its API directly.
 *
 * A session without a `modules` list is a legacy admin from before roles existed, and is
 * treated as full access rather than locked out of their own panel.
 */
export function usePermissions() {
  const { session } = useAuth();

  return useMemo(() => {
    const isFullAccess = session?.isFullAccess ?? !session?.modules;
    const modules = (session?.modules ?? []) as ModuleKey[];

    const can = (module: ModuleKey) => isFullAccess || modules.includes(module);
    // Team pages are for people who manage somebody. An Employee or Agent — `scope: 'own'` —
    // has no team to look at, so the entries are left out rather than opening an empty page.
    const hasTeam = isFullAccess || session?.scope !== 'own';
    const navItems: NavItem[] = NAV_ITEMS.filter((item) => can(item.module)).map((item) =>
      item.children ? { ...item, children: item.children.filter((c) => !c.teamOnly || hasTeam) } : item
    );

    return {
      isFullAccess,
      modules,
      can,
      navItems,
      /** Where to send someone who has no business on the page they asked for. */
      landingPath: navItems[0]?.to ?? '/no-access',
      roleName: session?.roleName ?? (isFullAccess ? 'Administrator' : undefined),
    };
  }, [session]);
}

/** The module a given panel path belongs to, used to guard direct URL access. */
export function moduleForPath(pathname: string): ModuleKey | null {
  const match = NAV_ITEMS.filter((item) => pathname === item.to || pathname.startsWith(`${item.to}/`))
    // Longest match wins so /settings/attendance isn't claimed by a shorter prefix.
    .sort((a, b) => b.to.length - a.to.length)[0];
  if (match) return match.module;

  // Sections whose routes don't all sit under the nav entry's own path.
  const EXTRA_PREFIXES: { prefix: string; module: ModuleKey }[] = [
    { prefix: '/crm', module: 'crm' },
    { prefix: '/tasks', module: 'tasks' },
    { prefix: '/construction', module: 'construction' },
    { prefix: '/projects', module: 'projects' },
    { prefix: '/properties', module: 'properties' },
    { prefix: '/bookings', module: 'bookings' },
    { prefix: '/transactions', module: 'payments' },
    { prefix: '/wallet', module: 'payments' },
    { prefix: '/investments', module: 'investments' },
    { prefix: '/users', module: 'partners' },
    { prefix: '/teams', module: 'teams' },
    { prefix: '/attendance', module: 'attendance' },
    { prefix: '/payouts', module: 'payouts' },
    { prefix: '/incentive-requests', module: 'incentives' },
    { prefix: '/support', module: 'support' },
    { prefix: '/notifications', module: 'notifications' },
    { prefix: '/reports', module: 'reports' },
    { prefix: '/settings', module: 'settings' },
    { prefix: '/dashboard', module: 'dashboard' },
  ];
  return EXTRA_PREFIXES.find((e) => pathname === e.prefix || pathname.startsWith(`${e.prefix}/`))?.module ?? null;
}
