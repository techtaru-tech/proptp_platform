import type { PrismaClient, User } from '@prisma/client';

/**
 * Seeds the workplace side: tasks with their comments, the leave scheme (types, balances,
 * requests), a payroll run with payslips, panel roles, business hours, KYC documents and
 * partner feedback.
 *
 * Tasks are deliberately spread across roles and teams so the visibility rules are visible
 * in the demo rather than theoretical: sign in as an employee and you will see a handful,
 * as an agent you will see your team's, as an admin you will see all of them.
 */

function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}
const rng = makeRng(20260921);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length) % items.length];
const randInt = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const chance = (p: number) => rng() < p;
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);
const daysAhead = (n: number) => new Date(Date.now() + n * 86400000);
/** A `@db.Date` column wants midnight UTC, not a local timestamp. */
const dateOnly = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));

const TASK_TITLES = [
  'Call back the Vesu site visitors',
  'Send the revised price list to the Ahmedabad enquiries',
  'Reconcile last week’s booking receipts',
  'Prepare the Sunday site-visit roster',
  'Follow up on the pending KYC approvals',
  'Chase the three overdue instalments',
  'Update the Rosium Meridian layout plan on the site',
  'Draft the festive offer for the Rajkot plots',
  'Verify the new agent onboarding documents',
  'Collect feedback from last month’s buyers',
  'Audit the plot-hold list for expiries',
  'Book the hoarding for the Surat highway',
  'Refresh the brochure with the new phase pricing',
  'Reply to the pending support tickets',
  'Reconfirm the bank NOC for Rosium Elysium',
  'Shortlist candidates for the Vadodara desk',
];

const TASK_NOTES = [
  'Priority is the ones who already did a site visit.',
  'Finance wants this before the month closes.',
  'Coordinate with the site team before promising a date.',
  'The last version is on the shared drive.',
  'Loop in the team lead once the numbers are ready.',
];

const TASK_COMMENTS = [
  'Started on this — half the list is done.',
  'Waiting on finance for the final figures.',
  'Spoke to the site team, they will confirm tomorrow.',
  'Done. Moving it across.',
  'Blocked until the approval comes through.',
];

const LEAVE_TYPES = [
  { code: 'CL', name: 'Casual Leave', annualQuota: 12, isPaid: true, carryForward: false },
  { code: 'SL', name: 'Sick Leave', annualQuota: 8, isPaid: true, carryForward: false },
  { code: 'EL', name: 'Earned Leave', annualQuota: 15, isPaid: true, carryForward: true },
  { code: 'LOP', name: 'Loss of Pay', annualQuota: 0, isPaid: false, carryForward: false },
];

const LEAVE_REASONS = [
  'Family function out of town.',
  'Fever and rest advised by the doctor.',
  'Personal work at the registrar’s office.',
  'Travelling for a wedding.',
  'Child’s school event.',
];

export async function seedWorkplace(
  prisma: PrismaClient,
  people: { admin: User; agents: User[]; employees: User[]; leaders: User[] }
) {
  const { admin, agents, employees, leaders } = people;
  const staff = [...employees, ...leaders].filter(Boolean);
  const everyone = [admin, ...staff, ...agents].filter(Boolean);

  // -------------------------------------------------------------------------
  // Panel roles — so the Roles screen is not empty and an admin has something to assign
  // -------------------------------------------------------------------------
  const roles = [
    { id: 'ROLE-SALES', name: 'Sales Manager', description: 'CRM, tasks and the reports that go with them.', modules: ['dashboard', 'crm', 'tasks', 'reports'] },
    { id: 'ROLE-OPS', name: 'Operations', description: 'Projects, properties, bookings and payments.', modules: ['dashboard', 'projects', 'properties', 'bookings', 'payments', 'tasks'] },
    { id: 'ROLE-HR', name: 'HR Manager', description: 'Attendance, leave, payroll and the partner directory.', modules: ['dashboard', 'attendance', 'payouts', 'partners', 'teams', 'tasks'] },
    { id: 'ROLE-TASKS', name: 'Task User', description: 'Tasks only — for staff who just need their own work list.', modules: ['dashboard', 'tasks'] },
  ];
  for (const role of roles) {
    await prisma.panelRole.upsert({
      where: { name: role.name },
      update: {},
      create: { id: role.id, name: role.name, description: role.description, modules: role.modules, isFullAccess: false },
    });
  }

  // -------------------------------------------------------------------------
  // Business hours — referenced by automations and the out-of-hours lead badge
  // -------------------------------------------------------------------------
  await prisma.businessHoursSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      enabled: true,
      timezone: 'Asia/Kolkata',
      schedule: {
        mon: { open: '10:00', close: '19:00', closed: false },
        tue: { open: '10:00', close: '19:00', closed: false },
        wed: { open: '10:00', close: '19:00', closed: false },
        thu: { open: '10:00', close: '19:00', closed: false },
        fri: { open: '10:00', close: '19:00', closed: false },
        sat: { open: '10:00', close: '16:00', closed: false },
        sun: { open: '10:00', close: '19:00', closed: true },
      },
      closedMessage: 'Our office is closed right now. We will call you back on the next working day.',
    },
  });

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------
  if ((await prisma.task.count()) === 0) {
    const STATUSES = ['todo', 'todo', 'in_progress', 'in_progress', 'blocked', 'done', 'done', 'cancelled'];
    const PRIORITIES = ['low', 'normal', 'normal', 'normal', 'high', 'high', 'urgent'];
    let created = 0;

    for (let i = 0; i < 46; i += 1) {
      const assignee = pick(everyone);
      // Most tasks come down from an admin; the rest people raised for themselves, which is
      // what an employee is limited to anyway.
      const selfRaised = chance(0.35);
      const createdBy = selfRaised ? assignee : admin;
      const status = pick(STATUSES);
      const done = status === 'done';
      const createdAt = daysAgo(randInt(0, 40));
      // A third have no deadline at all, and some of the open ones are already late.
      const dueAt = chance(0.33) ? null : chance(0.3) ? daysAgo(randInt(1, 10)) : daysAhead(randInt(0, 21));

      const task = await prisma.task.create({
        data: {
          title: TASK_TITLES[i % TASK_TITLES.length],
          description: chance(0.6) ? pick(TASK_NOTES) : null,
          status: status as never,
          priority: pick(PRIORITIES) as never,
          dueAt,
          assigneeId: assignee.id,
          createdById: createdBy.id,
          completedAt: done ? daysAgo(randInt(0, 8)) : null,
          createdAt,
          updatedAt: createdAt,
        },
      });
      created += 1;

      const commentCount = chance(0.5) ? randInt(1, 3) : 0;
      for (let c = 0; c < commentCount; c += 1) {
        await prisma.taskComment.create({
          data: {
            taskId: task.id,
            authorId: chance(0.5) ? assignee.id : createdBy.id,
            body: pick(TASK_COMMENTS),
            createdAt: new Date(createdAt.getTime() + (c + 1) * randInt(3, 30) * 3600000),
          },
        });
      }
    }
    console.log(`  tasks: ${created}`);
  } else {
    console.log('  tasks already present — skipping.');
  }

  // -------------------------------------------------------------------------
  // Leave — types, this year's balances, and a spread of requests
  // -------------------------------------------------------------------------
  for (const type of LEAVE_TYPES) {
    await prisma.leaveType.upsert({
      where: { code: type.code },
      update: {},
      create: { ...type, active: true },
    });
  }
  const leaveTypes = await prisma.leaveType.findMany({ where: { annualQuota: { gt: 0 } } });
  const year = new Date().getFullYear();

  for (const person of staff) {
    for (const type of leaveTypes) {
      await prisma.leaveBalance.upsert({
        where: { userId_leaveTypeId_year: { userId: person.id, leaveTypeId: type.id, year } },
        update: {},
        create: { userId: person.id, leaveTypeId: type.id, year, allocated: type.annualQuota },
      });
    }
  }

  if ((await prisma.leaveRequest.count()) === 0 && staff.length) {
    for (let i = 0; i < 24; i += 1) {
      const person = pick(staff);
      const type = pick(leaveTypes);
      const start = daysAgo(randInt(-20, 60));
      const days = randInt(1, 3);
      const end = new Date(start.getTime() + (days - 1) * 86400000);
      const roll = rng();
      const status = roll < 0.55 ? 'approved' : roll < 0.8 ? 'pending' : roll < 0.93 ? 'rejected' : 'cancelled';
      const decided = status === 'approved' || status === 'rejected';

      await prisma.leaveRequest.create({
        data: {
          userId: person.id,
          leaveTypeId: type.id,
          startDate: dateOnly(start),
          endDate: dateOnly(end),
          days,
          halfDay: days === 1 && chance(0.2),
          reason: pick(LEAVE_REASONS),
          status: status as never,
          decidedBy: decided ? admin.id : null,
          decidedAt: decided ? daysAgo(randInt(0, 30)) : null,
          decisionNote: status === 'rejected' ? 'Two people are already off that week.' : null,
          createdAt: daysAgo(randInt(1, 70)),
        },
      });
    }
    console.log('  leave: types, balances and 24 requests');
  }

  // -------------------------------------------------------------------------
  // Payroll — salary structures, plus one finalised run and one draft
  // -------------------------------------------------------------------------
  for (const person of staff) {
    const basic = randInt(18, 55) * 1000;
    await prisma.salaryStructure.upsert({
      where: { userId: person.id },
      update: {},
      create: {
        userId: person.id,
        basic,
        hra: Math.round(basic * 0.4),
        otherAllowance: randInt(2, 8) * 1000,
        pfDeduction: Math.round(basic * 0.12),
        professionalTax: 200,
        otherDeduction: 0,
        effectiveFrom: daysAgo(180),
      },
    });
  }

  if ((await prisma.payrollRun.count()) === 0 && staff.length) {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const structures = await prisma.salaryStructure.findMany();

    const runs: { month: number; year: number; status: 'paid' | 'draft' }[] = [
      { month: lastMonth.getMonth() + 1, year: lastMonth.getFullYear(), status: 'paid' },
      { month: now.getMonth() + 1, year: now.getFullYear(), status: 'draft' },
    ];

    for (const spec of runs) {
      const run = await prisma.payrollRun.create({
        data: {
          month: spec.month,
          year: spec.year,
          status: spec.status as never,
          notes: spec.status === 'draft' ? 'Figures still moving — attendance for the month is not closed.' : null,
          createdBy: admin.id,
          finalisedAt: spec.status === 'paid' ? daysAgo(20) : null,
          paidAt: spec.status === 'paid' ? daysAgo(18) : null,
        },
      });

      for (const s of structures) {
        const workingDays = 26;
        const lopDays = chance(0.2) ? randInt(1, 2) : 0;
        const paidLeaveDays = chance(0.3) ? randInt(1, 2) : 0;
        const presentDays = workingDays - lopDays - paidLeaveDays;
        const gross = s.basic + s.hra + s.otherAllowance;
        const lopDeduction = Math.round((gross / workingDays) * lopDays);
        const totalDeductions = s.pfDeduction + s.professionalTax + s.otherDeduction + lopDeduction;

        await prisma.payslip.create({
          data: {
            runId: run.id,
            userId: s.userId,
            workingDays,
            presentDays,
            paidLeaveDays,
            lopDays,
            basic: s.basic,
            hra: s.hra,
            otherAllowance: s.otherAllowance,
            grossEarnings: gross,
            pfDeduction: s.pfDeduction,
            professionalTax: s.professionalTax,
            otherDeduction: s.otherDeduction,
            lopDeduction,
            totalDeductions,
            netPay: gross - totalDeductions,
          },
        });
      }
    }
    console.log(`  payroll: ${structures.length} salary structures, 2 runs with payslips`);
  }

  // -------------------------------------------------------------------------
  // KYC documents and partner feedback — the app-side queues
  // -------------------------------------------------------------------------
  const KINDS = ['aadhaarFront', 'aadhaarBack', 'panCard', 'passportPhoto'] as const;
  for (const partner of agents.slice(0, 18)) {
    for (const kind of KINDS) {
      if (!chance(0.8)) continue;
      await prisma.kycDocument.upsert({
        where: { userId_kind: { userId: partner.id, kind } },
        update: {},
        create: {
          userId: partner.id,
          kind,
          fileUrl: `https://placehold.co/800x500/652251/ffffff?text=${kind}`,
          uploadedAt: daysAgo(randInt(5, 120)),
        },
      });
    }
  }

  if ((await prisma.feedback.count()) === 0) {
    const TOPICS = ['App', 'Payouts', 'Support', 'Training', 'Other'];
    const MESSAGES = [
      'The booking screen could remember the last project I picked.',
      'Payout took longer than usual this cycle.',
      'Would be good to download the commission statement as PDF.',
      'Site visit slots fill up too fast on Sundays.',
      'Please add Gujarati in the app.',
    ];
    for (let i = 0; i < 12; i += 1) {
      await prisma.feedback.create({
        data: {
          userId: pick(agents).id,
          topic: pick(TOPICS),
          message: pick(MESSAGES),
          createdAt: daysAgo(randInt(1, 90)),
        },
      });
    }
    console.log('  panel roles, business hours, KYC documents and feedback seeded.');
  }
}
