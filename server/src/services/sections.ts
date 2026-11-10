import { resolveAccess, type ModuleKey } from './permissions';

/**
 * The sidebar sections that get an Overview page and their own assistant. A section is open to
 * anyone holding at least one of its modules; inside it, every block checks its own module, so a
 * person who only has Bookings sees the bookings half of Real Estate and nothing else.
 *
 * Dashboard and CRM are not here — they have their own overview and analyst.
 */
export const SECTIONS = {
  hrms: { label: 'HRMS', modules: ['attendance', 'payouts'] },
  tasks: { label: 'Tasks', modules: ['tasks'] },
  'real-estate': { label: 'Real Estate', modules: ['projects', 'properties', 'bookings', 'investments', 'cameras'] },
  finance: { label: 'Finance', modules: ['payments', 'payouts', 'incentives'] },
  'construction-legal': { label: 'Construction & Legal', modules: ['construction', 'vendors', 'legal'] },
  people: { label: 'People & Partners', modules: ['partners', 'teams', 'partner_portal'] },
  support: { label: 'Support & Comms', modules: ['support', 'notifications', 'assistant'] },
  reports: { label: 'Reports', modules: ['reports'] },
  settings: { label: 'Settings', modules: ['settings', 'ops_rules'] },
} as const satisfies Record<string, { label: string; modules: ModuleKey[] }>;

export type SectionKey = keyof typeof SECTIONS;
export const SECTION_KEYS = Object.keys(SECTIONS) as SectionKey[];

export const isSection = (key: string): key is SectionKey => key in SECTIONS;

/** What one signed-in person may see: `has('bookings')` and so on. */
export interface Access {
  userId: string;
  has: (module: ModuleKey) => boolean;
  canOpen: (section: SectionKey) => boolean;
}

export async function accessFor(userId: string): Promise<Access> {
  const access = await resolveAccess(userId);
  const has = (m: ModuleKey) => access.isFullAccess || access.modules.includes(m);
  return { userId, has, canOpen: (s) => (SECTIONS[s].modules as readonly ModuleKey[]).some(has) };
}
