import { prisma } from '../prisma';

/**
 * Admin-panel permissions.
 *
 * A module is one top-level sidebar section. A PanelRole holds the list of modules it may use;
 * this file is the single source of truth for what those modules are and which API paths each
 * one covers, so the sidebar and the server can never drift apart on the question.
 *
 * `isFullAccess` roles skip every check — they are the only ones allowed to manage roles and
 * panel users, so a manager can never widen their own access.
 */

export const MODULES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'crm', label: 'CRM' },
  { key: 'tasks', label: 'Task Management' },
  { key: 'projects', label: 'Projects' },
  { key: 'construction', label: 'Construction' },
  { key: 'vendors', label: 'Vendors & Material' },
  { key: 'legal', label: 'Legal & Registry' },
  { key: 'ops_rules', label: 'Operations Rules' },
  { key: 'vendor_portal', label: 'Vendor Portal (a vendor\'s own work)' },
  { key: 'properties', label: 'Properties' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'payments', label: 'Payments / Transactions' },
  { key: 'investments', label: 'Investments / Deposits' },
  { key: 'partners', label: 'Partners / Users' },
  { key: 'teams', label: 'Teams / Referrals' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'payouts', label: 'Payouts / Earnings' },
  { key: 'incentives', label: 'Incentive Requests' },
  { key: 'support', label: 'Support Tickets' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'reports', label: 'Reports / Exports' },
  { key: 'settings', label: 'Settings' },
] as const;

export type ModuleKey = (typeof MODULES)[number]['key'];

export const MODULE_KEYS: ModuleKey[] = MODULES.map((m) => m.key);

/**
 * API path prefix -> module. Checked longest-prefix-first, so `/reports` (CRM's Report Center)
 * and `/ops-reports` (Reports / Exports) can both exist without shadowing each other.
 */
const PATH_MODULE_ENTRIES = [
  { prefix: '/dashboard', module: 'dashboard' },

  // CRM
  { prefix: '/leads', module: 'crm' },
  { prefix: '/crm-team', module: 'crm' },
  { prefix: '/lead-fields', module: 'crm' },
  { prefix: '/pipelines', module: 'crm' },
  { prefix: '/tags', module: 'crm' },
  { prefix: '/followups', module: 'crm' },
  { prefix: '/automations', module: 'crm' },
  { prefix: '/forms', module: 'crm' },
  { prefix: '/reports', module: 'crm' },
  { prefix: '/sdr-agents', module: 'crm' },
  { prefix: '/email-sequences', module: 'crm' },
  { prefix: '/email-templates', module: 'crm' },
  { prefix: '/email-settings', module: 'crm' },
  { prefix: '/calls', module: 'crm' },
  { prefix: '/whatsapp', module: 'crm' },
  { prefix: '/connections', module: 'crm' },

  { prefix: '/tasks', module: 'tasks' },

  { prefix: '/projects', module: 'projects' },
  { prefix: '/construction', module: 'construction' },
  { prefix: '/legal', module: 'legal' },
  { prefix: '/ops-rules', module: 'ops_rules' },
  { prefix: '/vendors', module: 'vendors' },
  { prefix: '/materials', module: 'vendors' },
  { prefix: '/vendor-portal', module: 'vendor_portal' },
  { prefix: '/units', module: 'properties' },
  { prefix: '/plot-holds', module: 'properties' },
  { prefix: '/project-maps', module: 'properties' },
  { prefix: '/bookings', module: 'bookings' },
  { prefix: '/funds', module: 'payments' },
  { prefix: '/kyc', module: 'payments' },
  { prefix: '/investments', module: 'investments' },
  { prefix: '/users', module: 'partners' },
  { prefix: '/teams', module: 'teams' },
  { prefix: '/attendance', module: 'attendance' },
  // Leave lives with attendance: it is the other half of "was this person at work".
  { prefix: '/leave', module: 'attendance' },
  // Payroll is money paid to staff, which is the same permission as money paid to partners.
  { prefix: '/payroll', module: 'payouts' },
  { prefix: '/payouts', module: 'payouts' },
  { prefix: '/incentive-requests', module: 'incentives' },
  { prefix: '/support', module: 'support' },
  { prefix: '/notifications', module: 'notifications' },
  // Send-only WhatsApp templates live under Notifications, so they answer to the same module.
  { prefix: '/whatsapp-templates', module: 'notifications' },
  { prefix: '/ops-reports', module: 'reports' },

  { prefix: '/platform-settings', module: 'settings' },
  { prefix: '/settings', module: 'settings' },
  { prefix: '/audit', module: 'settings' },
  { prefix: '/panel-roles', module: 'settings' },
  { prefix: '/panel-users', module: 'settings' },
] satisfies { prefix: string; module: ModuleKey }[];

const PATH_MODULES = [...PATH_MODULE_ENTRIES].sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * Paths every signed-in panel user may reach regardless of their modules: their own session and
 * profile, and the shared upload endpoint that most forms post to.
 */
const ALWAYS_ALLOWED = ['/auth', '/uploads'];

/** The module a request belongs to, or null when nothing claims it. */
export function moduleForPath(path: string): ModuleKey | null {
  return PATH_MODULES.find((entry) => path === entry.prefix || path.startsWith(`${entry.prefix}/`))?.module ?? null;
}

export function isAlwaysAllowed(path: string): boolean {
  return ALWAYS_ALLOWED.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export interface ResolvedAccess {
  isFullAccess: boolean;
  modules: ModuleKey[];
  roleId: string | null;
  roleName: string | null;
}

/**
 * What a panel user may do. A user with no panel role assigned is treated as full access —
 * that keeps the original admin account (which predates this feature) working exactly as before
 * instead of locking it out of its own panel.
 */
export async function resolveAccess(userId: string): Promise<ResolvedAccess> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { panelRole: true } });
  if (!user) return { isFullAccess: false, modules: [], roleId: null, roleName: null };
  if (!user.panelRole) return { isFullAccess: true, modules: [...MODULE_KEYS], roleId: null, roleName: null };

  const role = user.panelRole;
  if (role.isFullAccess) {
    return { isFullAccess: true, modules: [...MODULE_KEYS], roleId: role.id, roleName: role.name };
  }

  const stored = Array.isArray(role.modules) ? (role.modules as unknown[]) : [];
  const modules = stored.filter((m): m is ModuleKey => MODULE_KEYS.includes(m as ModuleKey));
  return { isFullAccess: false, modules, roleId: role.id, roleName: role.name };
}

/** Normalises whatever the client sent into a clean, known-good module list. */
export function sanitizeModules(input: unknown): ModuleKey[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<ModuleKey>();
  for (const value of input) {
    if (MODULE_KEYS.includes(value as ModuleKey)) seen.add(value as ModuleKey);
  }
  return [...seen];
}

/** Ensures the built-in Administrator role exists, and returns it. */
export async function getAdministratorRole() {
  return prisma.panelRole.upsert({
    where: { name: 'Administrator' },
    update: { isFullAccess: true, isSystem: true },
    create: {
      name: 'Administrator',
      description: 'Full access to every module, including roles and panel users.',
      isFullAccess: true,
      isSystem: true,
      modules: [],
    },
  });
}
