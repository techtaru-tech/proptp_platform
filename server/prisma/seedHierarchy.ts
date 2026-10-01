import type { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Seeds the sales hierarchy the CRM's visibility rules are demonstrated with:
 *
 *   Arpit (Leader) → Anoop, Ranjeet (Team Leaders); Anoop → Gaurav, Dhauli, Lav (Employees)
 *
 * These are ordinary users in the reporting tree, not special cases — nothing in the code knows
 * their names. Existing demo leads are dealt across them once, so every login has something to see.
 * Skipped if Arpit already exists, so a re-seed never reshuffles leads somebody has since moved.
 */
const PEOPLE: { key: string; name: string; role: UserRole; manager?: string; phone: string }[] = [
  { key: 'arpit', name: 'Arpit', role: 'leader', phone: '9000000101' },
  { key: 'anoop', name: 'Anoop', role: 'team_leader', manager: 'arpit', phone: '9000000102' },
  { key: 'ranjeet', name: 'Ranjeet', role: 'team_leader', manager: 'arpit', phone: '9000000103' },
  { key: 'gaurav', name: 'Gaurav', role: 'employee', manager: 'anoop', phone: '9000000104' },
  { key: 'dhauli', name: 'Dhauli', role: 'employee', manager: 'anoop', phone: '9000000105' },
  { key: 'lav', name: 'Lav', role: 'employee', manager: 'anoop', phone: '9000000106' },
];

export async function seedHierarchy(prisma: PrismaClient) {
  if (await prisma.user.findFirst({ where: { email: 'arpit@rosium.in' } })) {
    console.log('  sales hierarchy already present — skipping.');
    return;
  }

  const role = await prisma.panelRole.upsert({
    where: { name: 'Sales Team' },
    update: {},
    create: { name: 'Sales Team', description: 'CRM and tasks; sees only their own team.', modules: ['dashboard', 'crm', 'tasks'] },
  });
  const passwordHash = await bcrypt.hash(process.env.SEED_TEAM_PASSWORD || 'Rosium@2026', 10);

  const ids = new Map<string, string>();
  for (const p of PEOPLE) {
    const code = `SR-${p.role.toUpperCase()}-${p.phone.slice(-4)}`;
    const user = await prisma.user.create({
      data: {
        name: p.name,
        email: `${p.key}@rosium.in`,
        phone: p.phone,
        role: p.role,
        status: 'active',
        passwordHash,
        panelRoleId: role.id,
        reportingLeaderId: p.manager ? ids.get(p.manager) : null,
        partnerCode: code,
        referralCode: code,
      },
    });
    ids.set(p.key, user.id);
  }

  // Deal the existing leads: Arpit keeps a few, the rest split between the Team Leaders, and
  // Anoop passes some down to his employees.
  const order = ['anoop', 'ranjeet', 'gaurav', 'dhauli', 'lav', 'arpit', 'ranjeet', 'anoop'];
  const leads = await prisma.lead.findMany({ select: { id: true }, orderBy: { createdAt: 'asc' } });
  const buckets = new Map<string, string[]>();
  leads.forEach((l, i) => {
    const owner = ids.get(order[i % order.length])!;
    buckets.set(owner, [...(buckets.get(owner) ?? []), l.id]);
  });
  for (const [owner, leadIds] of buckets) {
    await prisma.lead.updateMany({ where: { id: { in: leadIds } }, data: { assignedUserId: owner } });
  }
  console.log(`  sales hierarchy: ${PEOPLE.length} people, ${leads.length} leads dealt (password: SEED_TEAM_PASSWORD or Rosium@2026)`);
}
