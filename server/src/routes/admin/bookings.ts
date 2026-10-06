import { Router } from 'express';
import type { Booking, Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { openLegalFileFor, costSheetForBooking, TemplateError } from '../../services/legal';
import { writeAudit } from '../../services/audit';
import type { AuthedRequest } from '../../services/auth';
import { BOOKING_STATUS_BY_ID, PAYMENT_MODE_BY_ID, adminAudit, adminBooking, adminUnit } from '../../services/adminMappers';
import { listResult, parseListQuery } from '../../services/list';
import { BookingError, createBooking, deleteBookingWithReversal } from '../../services/bookings';
import { paidAmountFromBookings, remainingAmount } from '../../services/derive';

export const adminBookingsRouter = Router();

/**
 * Booking rows are returned pre-joined with their plot, project and partner names. The
 * mock layer resolved those with synchronous cross-collection lookups; doing it in the
 * query means the client never has to hold the whole property catalogue in memory.
 */
const rowInclude = {
  unit: { include: { project: { select: { id: true, projectName: true } } } },
  user: { select: { name: true } },
} satisfies Prisma.BookingInclude;

type BookingRow = Booking & {
  unit: { propertyNumber: string; propertyTitle: string; project: { id: string; projectName: string } } | null;
  user: { name: string } | null;
};

function bookingRow(booking: BookingRow) {
  return {
    ...adminBooking(booking),
    projectId: booking.unit?.project.id,
    projectName: booking.unit?.project.projectName ?? '—',
    unitLabel: booking.unit ? `${booking.unit.propertyNumber} · ${booking.unit.propertyTitle}` : booking.propertyId,
    plotNumber: booking.unit?.propertyNumber ?? '',
    partnerName: booking.user?.name ?? '—',
  };
}

function buildWhere(req: AuthedRequest, search: string, extra: Prisma.BookingWhereInput = {}): Prisma.BookingWhereInput {
  const where: Prisma.BookingWhereInput = { ...extra };
  const status = String(req.query.status ?? 'all');
  const projectId = String(req.query.projectId ?? 'all');
  const partnerId = String(req.query.partnerId ?? 'all');
  const paymentMode = String(req.query.paymentMode ?? 'all');
  const dateFrom = String(req.query.dateFrom ?? '');
  const dateTo = String(req.query.dateTo ?? '');

  if (status !== 'all' && status !== '') where.status = BOOKING_STATUS_BY_ID[Number(status)];
  if (projectId !== 'all' && projectId !== '') where.unit = { projectId };
  if (partnerId !== 'all' && partnerId !== '') where.userId = partnerId;
  if (paymentMode !== 'all' && paymentMode !== '') where.paymentMode = PAYMENT_MODE_BY_ID[Number(paymentMode)];
  if (dateFrom || dateTo) {
    where.createdAt = {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
    };
  }
  if (search) {
    where.OR = [
      { bookingName: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
      { reference: { contains: search, mode: 'insensitive' } },
    ];
  }
  return where;
}

const SORTABLE: Record<string, (dir: 'asc' | 'desc') => Prisma.BookingOrderByWithRelationInput> = {
  amount: (dir) => ({ amount: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
};

/**
 * The admin Bookings list is unit-centric, exactly as in the real system: one row per
 * initial booking. Later installment rows show up on the booking detail page instead.
 */
adminBookingsRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const query = parseListQuery(req);
    const where = buildWhere(req, query.search, { isDeposit: 0 });
    const orderBy = (query.sortBy && SORTABLE[query.sortBy]?.(query.sortDir)) || { createdAt: 'desc' as const };

    const [rows, total] = await Promise.all([
      prisma.booking.findMany({ where, include: rowInclude, orderBy, skip: query.skip, take: query.take }),
      prisma.booking.count({ where }),
    ]);
    res.json(listResult(rows.map(bookingRow), total, query));
  } catch (err) {
    next(err);
  }
});

/**
 * The Transactions / Payments screen — EVERY booking row including installments, which is
 * what makes it a payment ledger rather than a booking list.
 */
adminBookingsRouter.get('/payments', async (req: AuthedRequest, res, next) => {
  try {
    const query = parseListQuery(req);
    const where = buildWhere(req, query.search);
    const orderBy = (query.sortBy && SORTABLE[query.sortBy]?.(query.sortDir)) || { createdAt: 'desc' as const };

    const [rows, total] = await Promise.all([
      prisma.booking.findMany({ where, include: rowInclude, orderBy, skip: query.skip, take: query.take }),
      prisma.booking.count({ where }),
    ]);
    res.json(listResult(rows.map(bookingRow), total, query));
  } catch (err) {
    next(err);
  }
});

/** Everything the Booking Detail page renders, in one round trip. */
adminBookingsRouter.get('/:id/detail', async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const booking = await prisma.booking.findUnique({ where: { id }, include: rowInclude });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const unit = await prisma.propertyUnit.findUnique({
      where: { id: booking.propertyId },
      include: { facings: true, bookings: { include: rowInclude, orderBy: { createdAt: 'asc' } } },
    });
    const paidAmount = unit ? paidAmountFromBookings(unit.bookings) : booking.amount;
    const audit = await prisma.auditEntry.findMany({
      where: { recordId: { in: [id, booking.propertyId] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    res.json({
      booking: bookingRow(booking),
      unit: unit ? adminUnit(unit) : null,
      projectName: booking.unit?.project.projectName ?? '—',
      partnerName: booking.user?.name ?? '—',
      totalAmount: unit?.totalInvestmentAmount ?? 0,
      paidAmount,
      remainingAmount: remainingAmount(unit?.totalInvestmentAmount ?? 0, paidAmount),
      unitBookings: (unit?.bookings ?? []).map(bookingRow),
      audit: audit.map(adminAudit),
    });
  } catch (err) {
    next(err);
  }
});

adminBookingsRouter.get('/:id', async (req, res, next) => {
  try {
    const booking = await prisma.booking.findUnique({ where: { id: String(req.params.id) }, include: rowInclude });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    res.json(bookingRow(booking));
  } catch (err) {
    next(err);
  }
});

adminBookingsRouter.get('/units/:unitId/history', async (req, res, next) => {
  try {
    const bookings = await prisma.booking.findMany({
      where: { propertyId: String(req.params.unitId) },
      include: rowInclude,
      orderBy: { createdAt: 'asc' },
    });
    res.json({ bookings: bookings.map(bookingRow) });
  } catch (err) {
    next(err);
  }
});

/** The cost sheet for this booking's plot, as a PDF. Needs no legal file, so it can be handed over when the token is taken. */
adminBookingsRouter.post('/:id/cost-sheet', async (req: AuthedRequest, res, next) => {
  try {
    const sheet = await costSheetForBooking(String(req.params.id), req.auth!.sub);
    if (!sheet) return res.status(404).json({ error: 'Booking not found.' });
    res.json(sheet);
  } catch (err) {
    if (err instanceof TemplateError) return res.status(422).json({ error: err.message });
    next(err);
  }
});

adminBookingsRouter.post('/:id/status', async (req: AuthedRequest, res, next) => {
  try {
    const nextStatus = BOOKING_STATUS_BY_ID[Number(req.body?.status)];
    if (!nextStatus) return res.status(400).json({ error: 'status must be 0, 1, 2 or 3.' });
    // Cancelling frees the plot and reverses money, so it goes through a request someone else approves.
    if (nextStatus === 'cancelled') return res.status(400).json({ error: 'Use “Request cancellation” on the booking — it needs an approval and works out the refund.' });
    const updated = await prisma.booking.update({
      where: { id: String(req.params.id) },
      data: { status: nextStatus },
      include: rowInclude,
    });
    if (nextStatus === 'booked' || nextStatus === 'partPaid') await openLegalFileFor(updated.id).catch(() => undefined);
    await writeAudit(req, {
      module: 'Bookings',
      action: `Status changed to ${nextStatus}`,
      recordId: updated.id,
      recordLabel: `Booking ${updated.reference}`,
      description: req.body?.note ?? `Booking ${updated.reference} status changed to ${nextStatus}.`,
    });
    res.json(bookingRow(updated));
  } catch (err) {
    next(err);
  }
});

/** Mirrors the real `propertyDepositEdit()` — KYC details can be amended after the fact. */
adminBookingsRouter.patch('/:id/kyc', async (req: AuthedRequest, res, next) => {
  try {
    const body = req.body ?? {};
    const data: Prisma.BookingUncheckedUpdateInput = {};
    for (const key of ['bookingName', 'phone', 'aadhaarNumber', 'aadhaarImage', 'aadhaarBack'] as const) {
      if (body[key] !== undefined) (data as any)[key] = body[key];
    }
    const updated = await prisma.booking.update({ where: { id: String(req.params.id) }, data, include: rowInclude });
    await writeAudit(req, {
      module: 'Bookings',
      action: 'Edited booking KYC details',
      recordId: updated.id,
      recordLabel: `Booking ${updated.reference}`,
      description: `KYC details for ${updated.reference} were amended by admin.`,
    });
    res.json(bookingRow(updated));
  } catch (err) {
    next(err);
  }
});

/**
 * Mirrors the real `propertyDepositdelete()`. There is no soft "reject" for a deposit
 * row in the real system — deletion plus balance reversal IS the reject mechanism.
 */
adminBookingsRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const booking = await prisma.booking.findUnique({ where: { id }, select: { reference: true } });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    await deleteBookingWithReversal(id);
    await writeAudit(req, {
      module: 'Bookings',
      action: 'Deleted deposit payment',
      recordId: id,
      recordLabel: `Booking ${booking.reference}`,
      description: `${booking.reference} was deleted and the plot's remaining balance was reversed.`,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** Mirrors the real `propertyverify` flow — verification lives on the PLOT, not the booking. */
adminBookingsRouter.post('/units/:unitId/verify', async (req: AuthedRequest, res, next) => {
  try {
    const unit = await prisma.propertyUnit.update({
      where: { id: String(req.params.unitId) },
      data: { isVerified: true },
      include: { facings: true },
    });
    await writeAudit(req, {
      module: 'Bookings',
      action: 'Verified booking',
      recordId: unit.id,
      recordLabel: `${unit.propertyNumber} · ${unit.propertyTitle}`,
      description: `Booking for plot ${unit.propertyNumber} was verified.`,
    });
    res.json(adminUnit(unit));
  } catch (err) {
    next(err);
  }
});

/** Mirrors the real `free_property` action — releases a booked/sold plot back to Available. */
adminBookingsRouter.post('/units/:unitId/free', async (req: AuthedRequest, res, next) => {
  try {
    const unit = await prisma.propertyUnit.update({
      where: { id: String(req.params.unitId) },
      data: { bookingStatus: 0, bookedById: null, isVerified: false },
      include: { facings: true },
    });
    await writeAudit(req, {
      module: 'Bookings',
      action: 'Released plot',
      recordId: unit.id,
      recordLabel: `${unit.propertyNumber} · ${unit.propertyTitle}`,
      description: `Plot ${unit.propertyNumber} was released back to Available.`,
    });
    res.json(adminUnit(unit));
  } catch (err) {
    next(err);
  }
});

/**
 * Mirrors the real `depositremaninig()` — an admin keys in an installment against an
 * already-booked plot. There is no customer-facing approval step: the admin entering the
 * payment IS the approval. KYC details are copied from the plot's original booking, and
 * the shared booking engine creates the sibling Investment and commission rows.
 */
adminBookingsRouter.post('/units/:unitId/deposit', async (req: AuthedRequest, res, next) => {
  try {
    const unitId = String(req.params.unitId);
    const original = await prisma.booking.findFirst({
      where: { propertyId: unitId, isDeposit: 0 },
      orderBy: { createdAt: 'asc' },
    });
    if (!original) return res.status(404).json({ error: 'No originating booking found for this property' });

    const paymentMode = PAYMENT_MODE_BY_ID[Number(req.body?.paymentMode)];
    if (!paymentMode) return res.status(400).json({ error: 'paymentMode must be 0, 1, 2, 3 or 4.' });

    const booking = await createBooking({
      unitId,
      bookingName: original.bookingName,
      phone: original.phone,
      userId: original.userId,
      involvedMemberId: original.involvedMemberId,
      amount: Number(req.body?.amount),
      paymentMode,
      chequeImage: paymentMode === 'cheque' ? (req.body?.chequeImage ?? null) : null,
      note: req.body?.note ?? null,
      aadhaarNumber: original.aadhaarNumber,
      aadhaarImage: original.aadhaarImage,
      aadhaarBack: original.aadhaarBack,
      isDeposit: 1,
      status: 'booked',
    });

    await writeAudit(req, {
      module: 'Bookings',
      action: 'Recorded deposit payment',
      recordId: booking.id,
      recordLabel: `Booking ${booking.reference}`,
      description: `${booking.reference} — deposit of ${booking.amount} recorded by admin for plot ${unitId}.`,
    });
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: rowInclude });
    res.status(201).json(bookingRow(row));
  } catch (err) {
    if (err instanceof BookingError) return res.status(err.httpStatus).json({ error: err.message });
    next(err);
  }
});
