import type { PrismaClient } from '@prisma/client';
import { STAGE_ORDER, syncLegalFiles } from '../src/services/legal';

/**
 * Demo legal data: files for the confirmed bookings, spread across agreement stages and registry
 * progress, payment plans with some milestones paid and some overdue, and project approvals that
 * are valid, expiring and lapsed so the compliance board has something on every band.
 * Skipped if any approval exists. Generates no documents and sends nothing.
 */
const DAY = 86_400_000;
const day = (n: number) => new Date(Date.now() + n * DAY);

export async function seedLegal(prisma: PrismaClient) {
  if ((await prisma.projectApproval.count()) > 0) {
    console.log('  legal already present — skipping.');
    return;
  }
  const opened = await syncLegalFiles();
  const files = await prisma.legalFile.findMany({ orderBy: { openedAt: 'asc' }, take: 12 });
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  const owner = admin?.name ?? 'Legal desk';

  for (const [i, f] of files.entries()) {
    // Agreement: none yet, then each stage in turn.
    const upTo = i % (STAGE_ORDER.length + 1) - 1; // -1 = none
    for (let s = 0; s <= upTo; s += 1) {
      await prisma.agreementStep.create({ data: { fileId: f.id, stage: STAGE_ORDER[s], at: day(-40 + s * 6), responsible: owner } });
    }
    // Payment plan: 20 / 30 / 30 / 20 of the agreed value, the early ones paid or late.
    if (i % 3 !== 2) {
      const cut = [0.2, 0.3, 0.3, 0.2].map((p) => Math.round(f.agreedValue * p));
      cut[3] += f.agreedValue - cut.reduce((a, b) => a + b, 0);
      const names = ['Booking amount', 'On agreement', 'On plinth completion', 'On possession'];
      const due = [-60, -25 + (i % 4) * 12, 20 + i * 5, 90 + i * 5];
      for (const [m, name] of names.entries()) {
        const row = await prisma.paymentMilestone.create({ data: { fileId: f.id, name, amount: cut[m], dueOn: day(due[m]), sortOrder: m, demandedAt: m === 1 && i % 2 === 0 ? day(-20) : null } });
        // The first is always settled; the second is settled for even files and left overdue otherwise.
        if (m === 0 || (m === 1 && i % 2 === 0)) {
          await prisma.milestonePayment.create({ data: { milestoneId: row.id, amount: m === 1 && i % 4 === 0 ? Math.round(cut[m] / 2) : cut[m], paidOn: day(due[m] + 2), reference: `NEFT-${5000 + i * 10 + m}` } });
        }
      }
    }
    // Registry progress, for the files whose agreement got far enough.
    if (upTo >= 4) {
      const status = upTo === 5 ? 'registered' : 'appointment_booked';
      await prisma.registry.update({
        where: { fileId: f.id },
        data: status === 'registered'
          ? { status, appointmentOn: day(-12), registryDate: day(-10), subRegistrar: 'Sub-Registrar Office, Jaipur-II', deedNumber: `2026/JP2/${1200 + i}` }
          : { status, appointmentOn: day(9) },
      });
    } else if (upTo >= 2) {
      await prisma.registry.update({ where: { fileId: f.id }, data: { status: upTo === 3 ? 'stamp_duty_paid' : 'documents_in_preparation' } });
    }
  }

  const projects = await prisma.project.findMany({ orderBy: { id: 'asc' }, take: 3 });
  const approvals: [string, string, number, number | null][] = [
    ['RERA registration', 'RAJ/P/2024/0912', -400, 600], ['Municipal layout sanction', 'JDA/LS/2023/441', -700, 25],
    ['Fire NOC', 'FIRE/NOC/2025/118', -300, 55], ['Environmental clearance', 'EC/RJ/2022/77', -900, -12],
    ['Conversion order', 'SDM/CONV/2023/310', -800, null], ['Electricity NOC', 'DISCOM/NOC/2025/62', -200, 82],
  ];
  for (const [pi, project] of projects.entries()) {
    for (const [ai, [kind, ref, issued, valid]] of approvals.entries()) {
      if (pi > 0 && ai > 3 - pi) continue;
      await prisma.projectApproval.create({ data: { projectId: project.id, kind, referenceNo: `${ref}-${pi + 1}`, issuedOn: day(issued), validUntil: valid === null ? null : day(valid) } });
    }
    await prisma.landRecord.create({ data: { projectId: project.id, khasra: `Khasra 112/${pi + 3}, 114`, area: '2.4 hectares', conversionOrder: `SDM/CONV/2023/31${pi}`, mutation: (['completed', 'applied', 'pending'] as const)[pi] ?? 'pending', notes: 'Mutation entered in revenue records.' } });
  }
  if (projects[0]) {
    await prisma.legalCase.create({ data: { projectId: projects[0].id, title: 'Boundary dispute — eastern plot line', counterparty: 'R. K. Sharma (adjoining owner)', stage: 'Written statement filed', nextHearing: day(14), notes: 'Survey report awaited.' } });
    await prisma.legalCase.create({ data: { projectId: projects[0].id, title: 'Legal notice — delayed possession claim', counterparty: 'Buyer via counsel', stage: 'Reply drafted', nextHearing: day(-3), notes: 'Reply due; hearing date has passed.' } });
  }
  console.log(`  legal: ${opened} files opened, agreements/plans/registry on ${files.length}, approvals, land records, 2 cases`);
}
