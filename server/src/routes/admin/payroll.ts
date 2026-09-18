import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { writeAudit } from '../../services/audit';
import type { AuthedRequest } from '../../services/auth';
import { approvedLeaveInMonth, presentDaysInMonth, workingDaysInMonth } from '../../services/leave';

export const adminPayrollRouter = Router();

const STAFF_ROLES = ['employee', 'leader', 'admin'];

// ---------------------------------------------------------------------------
// Salary structures
// ---------------------------------------------------------------------------

adminPayrollRouter.get('/structures', async (_req, res, next) => {
  try {
    const staff = await prisma.user.findMany({
      where: { status: 'active', role: { in: STAFF_ROLES as unknown as Prisma.Enumerable<any> } },
      select: { id: true, name: true, role: true, salaryStructure: true },
      orderBy: { name: 'asc' },
    });

    res.json({
      staff: staff.map((u) => {
        const s = u.salaryStructure;
        const gross = s ? s.basic + s.hra + s.otherAllowance : 0;
        const deductions = s ? s.pfDeduction + s.professionalTax + s.otherDeduction : 0;
        return {
          userId: u.id,
          name: u.name,
          role: u.role,
          hasStructure: !!s,
          basic: s?.basic ?? 0,
          hra: s?.hra ?? 0,
          otherAllowance: s?.otherAllowance ?? 0,
          pfDeduction: s?.pfDeduction ?? 0,
          professionalTax: s?.professionalTax ?? 0,
          otherDeduction: s?.otherDeduction ?? 0,
          grossMonthly: gross,
          netMonthly: gross - deductions,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

adminPayrollRouter.put('/structures/:userId', async (req: AuthedRequest, res, next) => {
  try {
    const userId = String(req.params.userId);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    if (!user) return res.status(404).json({ error: 'That person no longer exists.' });

    const whole = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));
    const data = {
      basic: whole(req.body?.basic),
      hra: whole(req.body?.hra),
      otherAllowance: whole(req.body?.otherAllowance),
      pfDeduction: whole(req.body?.pfDeduction),
      professionalTax: whole(req.body?.professionalTax),
      otherDeduction: whole(req.body?.otherDeduction),
    };

    if (data.basic + data.hra + data.otherAllowance === 0) {
      return res.status(400).json({ error: 'A salary needs at least one earning figure above zero.' });
    }

    const saved = await prisma.salaryStructure.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });

    await writeAudit(req, {
      module: 'payouts',
      action: 'Updated salary structure',
      recordId: userId,
      recordLabel: user.name,
      description: `Gross ₹${data.basic + data.hra + data.otherAllowance}/month for ${user.name}.`,
    });
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

function serializeRun(run: any) {
  const payslips = run.payslips ?? [];
  return {
    id: run.id,
    month: run.month,
    year: run.year,
    status: run.status,
    notes: run.notes ?? undefined,
    employees: payslips.length,
    grossTotal: payslips.reduce((sum: number, p: any) => sum + p.grossEarnings, 0),
    netTotal: payslips.reduce((sum: number, p: any) => sum + p.netPay, 0),
    finalisedAt: run.finalisedAt?.toISOString(),
    paidAt: run.paidAt?.toISOString(),
    createdAt: run.createdAt.toISOString(),
  };
}

adminPayrollRouter.get('/runs', async (_req, res, next) => {
  try {
    const runs = await prisma.payrollRun.findMany({
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: { payslips: { select: { grossEarnings: true, netPay: true } } },
      take: 36,
    });
    res.json({ runs: runs.map(serializeRun) });
  } catch (err) {
    next(err);
  }
});

adminPayrollRouter.get('/runs/:id', async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({
      where: { id: String(req.params.id) },
      include: {
        payslips: {
          include: { user: { select: { name: true, phone: true } } },
          orderBy: { user: { name: 'asc' } },
        },
      },
    });
    if (!run) return res.status(404).json({ error: 'That payroll run no longer exists.' });

    res.json({
      ...serializeRun(run),
      payslips: run.payslips.map((p) => ({
        id: p.id,
        userId: p.userId,
        name: p.user.name,
        phone: p.user.phone,
        workingDays: p.workingDays,
        presentDays: p.presentDays,
        paidLeaveDays: p.paidLeaveDays,
        lopDays: p.lopDays,
        basic: p.basic,
        hra: p.hra,
        otherAllowance: p.otherAllowance,
        grossEarnings: p.grossEarnings,
        pfDeduction: p.pfDeduction,
        professionalTax: p.professionalTax,
        otherDeduction: p.otherDeduction,
        lopDeduction: p.lopDeduction,
        totalDeductions: p.totalDeductions,
        netPay: p.netPay,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Builds a month's payroll from the salary structures, the attendance records and the approved
 * leave. Re-running a draft recalculates it from scratch, which is the point: attendance gets
 * corrected and leave gets approved late, and the draft should follow until it is finalised.
 */
adminPayrollRouter.post('/runs', async (req: AuthedRequest, res, next) => {
  try {
    const month = Number(req.body?.month);
    const year = Number(req.body?.year);
    if (!(month >= 1 && month <= 12) || !(year >= 2020 && year <= 2100)) {
      return res.status(400).json({ error: 'Give a valid month and year.' });
    }

    const existing = await prisma.payrollRun.findUnique({ where: { month_year: { month, year } } });
    if (existing && existing.status !== 'draft') {
      return res.status(409).json({ error: `${month}/${year} is already ${existing.status} and cannot be rebuilt.` });
    }

    const staff = await prisma.user.findMany({
      where: { status: 'active', role: { in: STAFF_ROLES as unknown as Prisma.Enumerable<any> }, salaryStructure: { isNot: null } },
      select: { id: true, salaryStructure: true },
    });
    if (staff.length === 0) {
      return res.status(400).json({ error: 'Nobody has a salary structure yet, so there is nothing to pay.' });
    }

    const workingDays = workingDaysInMonth(year, month);

    const run = existing
      ? await prisma.payrollRun.update({ where: { id: existing.id }, data: { notes: req.body?.notes ?? existing.notes } })
      : await prisma.payrollRun.create({
          data: { month, year, notes: req.body?.notes ?? null, createdBy: req.auth?.sub ?? null },
        });

    // A rebuild replaces the lot rather than patching, so a person who left is not left behind.
    await prisma.payslip.deleteMany({ where: { runId: run.id } });

    for (const person of staff) {
      const s = person.salaryStructure!;
      const [{ paidDays, unpaidDays }, presentDays] = await Promise.all([
        approvedLeaveInMonth(person.id, year, month),
        presentDaysInMonth(person.id, year, month),
      ]);

      // Anything not worked and not covered by paid leave is loss of pay. Never negative: a
      // month with more present days than working days (a weekend push) does not earn extra.
      const accountedFor = Math.min(workingDays, presentDays + paidDays);
      const lopDays = Math.max(0, workingDays - accountedFor);

      const grossEarnings = s.basic + s.hra + s.otherAllowance;
      const perDay = workingDays > 0 ? grossEarnings / workingDays : 0;
      const lopDeduction = Math.round(perDay * lopDays);
      const totalDeductions = s.pfDeduction + s.professionalTax + s.otherDeduction + lopDeduction;

      await prisma.payslip.create({
        data: {
          runId: run.id,
          userId: person.id,
          workingDays,
          presentDays,
          paidLeaveDays: paidDays,
          lopDays,
          basic: s.basic,
          hra: s.hra,
          otherAllowance: s.otherAllowance,
          grossEarnings,
          pfDeduction: s.pfDeduction,
          professionalTax: s.professionalTax,
          otherDeduction: s.otherDeduction,
          lopDeduction,
          totalDeductions,
          netPay: Math.max(0, grossEarnings - totalDeductions),
        },
      });

      // Unpaid leave is already loss of pay by another name; counting it twice would halve
      // somebody's salary for taking a week off.
      void unpaidDays;
    }

    await writeAudit(req, {
      module: 'payouts',
      action: existing ? 'Rebuilt payroll run' : 'Created payroll run',
      recordId: run.id,
      recordLabel: `${month}/${year}`,
      description: `${staff.length} employees over ${workingDays} working days.`,
    });

    const full = await prisma.payrollRun.findUniqueOrThrow({
      where: { id: run.id },
      include: { payslips: { select: { grossEarnings: true, netPay: true } } },
    });
    res.status(201).json(serializeRun(full));
  } catch (err) {
    next(err);
  }
});

adminPayrollRouter.post('/runs/:id/status', async (req: AuthedRequest, res, next) => {
  try {
    const status = String(req.body?.status ?? '');
    if (!['finalised', 'paid'].includes(status)) {
      return res.status(400).json({ error: 'A run can only be finalised or marked paid.' });
    }

    const run = await prisma.payrollRun.findUnique({ where: { id: String(req.params.id) } });
    if (!run) return res.status(404).json({ error: 'That payroll run no longer exists.' });
    if (status === 'paid' && run.status === 'draft') {
      return res.status(409).json({ error: 'Finalise the run before marking it paid.' });
    }

    const updated = await prisma.payrollRun.update({
      where: { id: run.id },
      data: {
        status: status as any,
        finalisedAt: status === 'finalised' ? new Date() : run.finalisedAt,
        paidAt: status === 'paid' ? new Date() : run.paidAt,
      },
    });

    await writeAudit(req, {
      module: 'payouts',
      action: status === 'finalised' ? 'Finalised payroll' : 'Marked payroll paid',
      recordId: run.id,
      recordLabel: `${run.month}/${run.year}`,
    });
    res.json(serializeRun({ ...updated, payslips: [] }));
  } catch (err) {
    next(err);
  }
});

adminPayrollRouter.delete('/runs/:id', async (req: AuthedRequest, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: String(req.params.id) } });
    if (!run) return res.status(404).json({ error: 'That payroll run no longer exists.' });
    if (run.status !== 'draft') return res.status(409).json({ error: 'Only a draft can be deleted.' });

    await prisma.payrollRun.delete({ where: { id: run.id } });
    await writeAudit(req, { module: 'payouts', action: 'Deleted draft payroll', recordId: run.id, recordLabel: `${run.month}/${run.year}` });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
