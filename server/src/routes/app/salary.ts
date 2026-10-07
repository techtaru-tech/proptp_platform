import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { requireAuth, type AuthedRequest } from '../../services/auth';
import { appPayslipDetail, appPayslipSummary, appSalaryStructure } from '../../services/appMappers';

/**
 * The app's two pay screens: My Salary and Payslips.
 *
 * Both read the payslips payroll already produced in the panel; nothing is recomputed here.
 * A payslip keeps its own copy of every figure it used, so a slip issued in March still reads
 * the same after April's revision — which is exactly why these endpoints show the stored
 * numbers rather than deriving anything from the current salary structure.
 *
 * Everything is scoped to the caller by `userId`. There is no parameter for whose payslip to
 * fetch, and a slip belonging to somebody else answers 404 rather than 403, for the same
 * reason the leads routes do: "not yours" and "does not exist" should look the same.
 */
export const appSalaryRouter = Router();
export const appPayslipsRouter = Router();

appSalaryRouter.use(requireAuth);
appPayslipsRouter.use(requireAuth);

/**
 * A draft run is invisible to the person it is about.
 *
 * The schema calls a draft "figures calculated and editable; nothing is owed yet". Somebody
 * who reads a number on their phone and watches it change next week has been told something
 * false, which is worse than being told nothing.
 */
const VISIBLE_RUN: Prisma.PayrollRunWhereInput = { status: { in: ['finalised', 'paid'] } };

const payslipInclude = {
  run: { select: { id: true, month: true, year: true, status: true, paidAt: true, finalisedAt: true } },
} as const;

/** Newest month first, which is the order both screens list them in. */
const NEWEST_FIRST: Prisma.PayslipOrderByWithRelationInput[] = [
  { run: { year: 'desc' } },
  { run: { month: 'desc' } },
];

function yearFilter(year: number | undefined): Prisma.PayslipWhereInput {
  return year ? { run: { ...VISIBLE_RUN, year } } : { run: VISIBLE_RUN };
}

// ---------------------------------------------------------------------------
// My Salary — what I am paid, and what I have been paid
// ---------------------------------------------------------------------------

appSalaryRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.auth!.sub;
    // No year means the whole history: a salary screen scrolls, and somebody two years in
    // still has only two dozen rows.
    const year = Number(req.query.year) || undefined;

    const [structure, payslips] = await Promise.all([
      prisma.salaryStructure.findUnique({ where: { userId } }),
      prisma.payslip.findMany({
        where: { userId, ...yearFilter(year) },
        include: payslipInclude,
        orderBy: NEWEST_FIRST,
      }),
    ]);

    const months = payslips.map(appPayslipSummary);

    res.json({
      year: year ?? null,
      // Null when payroll has not set this person up — an agent on commission has no salary,
      // and that is a state to render, not an error.
      structure: appSalaryStructure(structure),
      months,
      summary: {
        months_count: months.length,
        gross_total: months.reduce((sum, m) => sum + m.gross_earnings, 0),
        deductions_total: months.reduce((sum, m) => sum + m.total_deductions, 0),
        net_total: months.reduce((sum, m) => sum + m.net_pay, 0),
        /// Finalised but not yet paid out — the figure is locked, the money is not in.
        awaiting_payment: months.filter((m) => m.status === 'finalised').length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Payslips — the slips themselves
// ---------------------------------------------------------------------------

appPayslipsRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const year = Number(req.query.year) || undefined;
    const payslips = await prisma.payslip.findMany({
      where: { userId: req.auth!.sub, ...yearFilter(year) },
      include: payslipInclude,
      orderBy: NEWEST_FIRST,
    });

    res.json({
      year: year ?? null,
      payslips: payslips.map(appPayslipSummary),
      // The years that actually have a slip, so the app's year picker offers only those.
      years: [...new Set(payslips.map((p) => p.run.year))].sort((a, b) => b - a),
    });
  } catch (err) {
    next(err);
  }
});

appPayslipsRouter.get('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const payslip = await prisma.payslip.findFirst({
      where: { id: String(req.params.id), userId: req.auth!.sub, run: VISIBLE_RUN },
      include: payslipInclude,
    });
    if (!payslip) {
      return res.status(404).json({ error: { code: 'payslip_not_found', message: 'That payslip could not be found.' } });
    }
    res.json(appPayslipDetail(payslip));
  } catch (err) {
    next(err);
  }
});
