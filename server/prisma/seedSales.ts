import type { PrismaClient } from '@prisma/client';

/**
 * Demo site visits and lead temperatures, so the new screens have something to show: a few visits
 * in every state, the leads they belong to moved to the matching stage, and hot/warm/cold spread
 * over the pipeline. Skipped if any visit exists.
 */
const DAY = 86_400_000;
const at = (days: number, hour: number) => { const d = new Date(Date.now() + days * DAY); d.setHours(hour, 0, 0, 0); return d; };

export async function seedSales(prisma: PrismaClient) {
  if ((await prisma.siteVisit.count()) > 0) {
    console.log('  site visits already present — skipping.');
    return;
  }
  const projects = await prisma.project.findMany({ orderBy: { id: 'asc' }, take: 3 });
  const stages = await prisma.pipelineStage.findMany({ where: { pipelineId: 'PPL-SALES' } });
  const stage = (name: string) => stages.find((s) => s.name === name);
  const planned = stage('Site Visit Planned');
  const visited = stage('Site Visit Done');
  if (projects.length === 0 || !planned || !visited) return;

  // Temperatures over the existing leads: warmer the further along they are.
  const leads = await prisma.lead.findMany({ where: { status: { in: ['new', 'contacted', 'qualified'] } }, orderBy: { createdAt: 'asc' }, include: { stage: true } });
  const temp = ['hot', 'warm', 'cold', 'warm', 'cold', null] as const;
  for (const [i, l] of leads.entries()) {
    await prisma.lead.update({ where: { id: l.id }, data: { temperature: temp[i % temp.length], interestedProjectId: projects[i % projects.length].id } });
  }

  const owned = leads.filter((l) => l.assignedUserId).slice(0, 10);
  const plan: { status: 'scheduled' | 'confirmed' | 'done' | 'cancelled' | 'no_show'; when: Date; outcome?: string; interest?: 'hot' | 'warm' | 'cold'; feedback?: string }[] = [
    { status: 'confirmed', when: at(0, 15) },
    { status: 'scheduled', when: at(0, 17) },
    { status: 'scheduled', when: at(1, 11) },
    { status: 'confirmed', when: at(3, 10) },
    { status: 'scheduled', when: at(-1, 12) }, // nobody recorded how it went
    { status: 'done', when: at(-2, 11), outcome: 'ready_to_book', interest: 'hot', feedback: 'Liked the corner plot, will bring family on Sunday to book.' },
    { status: 'done', when: at(-4, 16), outcome: 'interested', interest: 'warm', feedback: 'Wants a bank loan quote first.' },
    { status: 'done', when: at(-6, 10), outcome: 'thinking', interest: 'cold', feedback: 'Comparing with another township.' },
    { status: 'no_show', when: at(-3, 14) },
    { status: 'cancelled', when: at(2, 12) },
  ];
  let made = 0;
  for (const [i, p] of plan.entries()) {
    const lead = owned[i];
    if (!lead) break;
    const project = projects[i % projects.length];
    await prisma.siteVisit.create({
      data: {
        leadId: lead.id, projectId: project.id, scheduledAt: p.when, status: p.status, hostId: lead.assignedUserId, visitorCount: 2 + (i % 3),
        createdById: lead.assignedUserId!, confirmedAt: p.status === 'confirmed' ? new Date() : null,
        completedAt: p.status === 'done' ? p.when : null, outcome: p.outcome ?? null, interest: p.interest ?? null, feedback: p.feedback ?? null,
        cancelReason: p.status === 'cancelled' ? 'Buyer travelling that week' : null,
      },
    });
    const target = p.status === 'done' ? visited : p.status === 'cancelled' || p.status === 'no_show' ? null : planned;
    if (target) await prisma.lead.update({ where: { id: lead.id }, data: { pipelineId: 'PPL-SALES', pipelineStageId: target.id, status: 'qualified', ...(p.interest ? { temperature: p.interest } : {}) } });
    made += 1;
  }
  console.log(`  sales: ${leads.length} leads rated hot/warm/cold, ${made} site visits in every state`);
}
