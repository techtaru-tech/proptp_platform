import { Router } from 'express';
import { prisma } from '../../prisma';
import type { AuthedRequest } from '../../services/auth';
import { writeAudit } from '../../services/audit';
import { notify } from '../../services/notify';
import { paidAmountFromBookings } from '../../services/derive';
import { resolveAccess } from '../../services/permissions';
import { getPolicy, refundFor, type Policy } from '../../services/salesPolicy';

/**
 * Booking cancellation and refund — /api/booking-cancellations.
 *
 * Cancelling a booking is a request, not an action: it records why, works out the refund from the
 * policy at that moment, and waits for someone the policy allows to approve it. Only approval frees
 * the plot and reverses the booking's side effects, and nobody approves their own request.
 */
export const adminBookingCancellationsRouter = Router();

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** Whether this person may decide a refund, under who the policy says approves. */
async function mayDecide(userId: string, policy: Policy): Promise<boolean> {
  const access = await resolveAccess(userId);
  if (policy.refundApprover === 'admin') return access.isFullAccess;
  if (policy.refundApprover === 'leader') {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    return u?.role === 'leader' || access.isFullAccess;
  }
  return access.isFullAccess || access.modules.includes('payments');
}

const include = { booking: { select: { reference: true, bookingName: true, phone: true, unit: { select: { propertyNumber: true, project: { select: { projectName: true } } } } } } } as const;
const shape = (c: any) => ({
  id: c.id, bookingId: c.bookingId, reference: c.booking.reference, buyerName: c.booking.bookingName, phone: c.booking.phone,
  unit: c.booking.unit.propertyNumber, projectName: c.booking.unit.project.projectName, reason: c.reason,
  amountPaid: c.amountPaid, deductionPercent: c.deductionPercent, deductionAmount: c.deductionAmount, refundAmount: c.refundAmount,
  status: c.status, requestedByName: c.requestedByName, requestedAt: c.requestedAt.toISOString(), decidedByName: c.decidedByName,
  decidedAt: c.decidedAt?.toISOString() ?? null, decisionNote: c.decisionNote, refundedAt: c.refundedAt?.toISOString() ?? null, refundReference: c.refundReference,
});

adminBookingCancellationsRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const status = String(req.query.status ?? 'pending');
    const rows = await prisma.bookingCancellation.findMany({ where: ['pending', 'approved', 'rejected'].includes(status) ? { status } : {}, include, orderBy: { requestedAt: 'desc' }, take: 200 });
    const policy = await getPolicy();
    res.json({ canDecide: await mayDecide(req.auth!.sub, policy), approver: policy.refundApprover, items: rows.map(shape) });
  } catch (err) {
    next(err);
  }
});

/** The request on one booking, and what a new one would refund — for the booking page. */
adminBookingCancellationsRouter.get('/booking/:bookingId', async (req: AuthedRequest, res, next) => {
  try {
    const bookingId = String(req.params.bookingId);
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { unit: { include: { bookings: { select: { amount: true, status: true } } } } } });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    const policy = await getPolicy();
    const existing = await prisma.bookingCancellation.findUnique({ where: { bookingId }, include });
    const paid = paidAmountFromBookings(booking.unit.bookings);
    res.json({
      cancelled: booking.status === 'cancelled', request: existing ? shape(existing) : null,
      canDecide: await mayDecide(req.auth!.sub, policy), approver: policy.refundApprover,
      preview: { amountPaid: paid, ...refundFor(policy, paid) },
    });
  } catch (err) {
    next(err);
  }
});

adminBookingCancellationsRouter.post('/booking/:bookingId', async (req: AuthedRequest, res, next) => {
  try {
    const bookingId = String(req.params.bookingId);
    const reason = String(req.body?.reason ?? '').trim();
    if (!reason) return res.status(400).json({ error: 'Say why the booking is being cancelled.' });
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { unit: { include: { bookings: { select: { amount: true, status: true } } } } } });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.isDeposit !== 0) return res.status(400).json({ error: 'Cancel the plot’s main booking, not a single deposit.' });
    if (booking.status === 'cancelled') return res.status(409).json({ error: 'This booking is already cancelled.' });
    const existing = await prisma.bookingCancellation.findUnique({ where: { bookingId } });
    if (existing && existing.status === 'pending') return res.status(409).json({ error: 'A cancellation is already waiting for approval.' });

    const paid = paidAmountFromBookings(booking.unit.bookings);
    const actor = await prisma.user.findUnique({ where: { id: req.auth!.sub }, select: { name: true } });
    const policy = await getPolicy();
    const data = { reason, amountPaid: paid, ...refundFor(policy, paid), status: 'pending', requestedById: req.auth!.sub, requestedByName: actor?.name ?? 'Unknown', requestedAt: new Date(), decidedById: null, decidedByName: null, decidedAt: null, decisionNote: null, refundedAt: null, refundReference: null };
    // A rejected request can be raised again; it replaces the old answer rather than piling up.
    const saved = existing
      ? await prisma.bookingCancellation.update({ where: { bookingId }, data, include })
      : await prisma.bookingCancellation.create({ data: { bookingId, ...data }, include });
    await writeAudit(req, { module: 'Bookings', action: 'Requested booking cancellation', recordId: bookingId, recordLabel: `Booking ${booking.reference}`, description: `${reason} — refund ${inr(saved.refundAmount)} of ${inr(paid)} paid.` });

    // Tell whoever the policy lets decide, so it does not sit unseen.
    const approvers = await prisma.user.findMany({ where: { status: 'active', role: { notIn: ['vendor', 'channel_partner'] }, panelRoleId: { not: null } }, select: { id: true } });
    const deciders: string[] = [];
    for (const u of approvers) if (u.id !== req.auth!.sub && (await mayDecide(u.id, policy))) deciders.push(u.id);
    if (deciders.length) await notify({ title: 'Booking cancellation needs approval', body: `${booking.reference}: refund ${inr(saved.refundAmount)}. ${reason}`, userIds: deciders, type: 'system', data: { kind: 'booking_cancellation', bookingId } }).catch(() => undefined);
    res.status(201).json(shape(saved));
  } catch (err) {
    next(err);
  }
});

adminBookingCancellationsRouter.post('/:id/decide', async (req: AuthedRequest, res, next) => {
  try {
    const decision = String(req.body?.decision ?? '');
    const note = String(req.body?.note ?? '').trim();
    if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'decision must be approve or reject.' });
    if (decision === 'reject' && !note) return res.status(400).json({ error: 'Give a reason when rejecting a cancellation.' });
    const c = await prisma.bookingCancellation.findUnique({ where: { id: String(req.params.id) }, include: { booking: { include: { unit: { include: { bookings: true } } } } } });
    if (!c) return res.status(404).json({ error: 'Cancellation request not found.' });
    if (c.status !== 'pending') return res.status(409).json({ error: `This request was already ${c.status}.` });
    const policy = await getPolicy();
    if (!(await mayDecide(req.auth!.sub, policy))) {
      return res.status(403).json({ error: `Under the current policy, ${policy.refundApprover === 'admin' ? 'only a full-access administrator' : policy.refundApprover === 'leader' ? 'a Leader' : 'someone with Payments access'} can decide this.` });
    }
    // Whoever asked cannot also answer, except a full-access administrator, who holds both powers.
    if (c.requestedById === req.auth!.sub && !(await resolveAccess(req.auth!.sub)).isFullAccess) return res.status(403).json({ error: 'You raised this request, so someone else has to decide it.' });

    const actor = await prisma.user.findUnique({ where: { id: req.auth!.sub }, select: { name: true } });
    const unit = c.booking.unit;
    await prisma.$transaction(async (tx) => {
      await tx.bookingCancellation.update({ where: { id: c.id }, data: { status: decision === 'approve' ? 'approved' : 'rejected', decidedById: req.auth!.sub, decidedByName: actor?.name ?? 'Unknown', decidedAt: new Date(), decisionNote: note || null } });
      if (decision !== 'approve') return;
      // Everything the buyer paid on this plot goes with it: the booking and its deposits.
      const ids = unit.bookings.filter((b) => b.status !== 'cancelled').map((b) => b.id);
      await tx.booking.updateMany({ where: { id: { in: ids } }, data: { status: 'cancelled' } });
      await tx.investment.deleteMany({ where: { bookingId: { in: ids } } });
      // Commission not yet paid out is withdrawn; anything already released stays and is for the accounts team to recover.
      await tx.earningEntry.deleteMany({ where: { bookingId: { in: ids }, status: 'pending' } });
      await tx.propertyUnit.update({ where: { id: unit.id }, data: { bookingStatus: 0, bookedById: null, isVerified: false } });
      await tx.legalFile.updateMany({ where: { bookingId: c.bookingId }, data: { closedAt: new Date() } });
    });
    await writeAudit(req, { module: 'Bookings', action: decision === 'approve' ? 'Approved booking cancellation' : 'Rejected booking cancellation', recordId: c.bookingId, recordLabel: `Booking ${c.booking.reference}`, description: decision === 'approve' ? `Refund ${inr(c.refundAmount)} (kept ${inr(c.deductionAmount)}). Plot ${unit.propertyNumber} is available again.` : note });
    await notify({ title: decision === 'approve' ? 'Cancellation approved' : 'Cancellation rejected', body: `${c.booking.reference}${note ? `: ${note}` : ''}`, userIds: [c.requestedById], type: 'system' }).catch(() => undefined);
    const fresh = await prisma.bookingCancellation.findUniqueOrThrow({ where: { id: c.id }, include });
    res.json(shape(fresh));
  } catch (err) {
    next(err);
  }
});

/** Records that the money has gone back to the buyer. */
adminBookingCancellationsRouter.post('/:id/refunded', async (req: AuthedRequest, res, next) => {
  try {
    const c = await prisma.bookingCancellation.findUnique({ where: { id: String(req.params.id) }, include });
    if (!c) return res.status(404).json({ error: 'Cancellation request not found.' });
    if (c.status !== 'approved') return res.status(409).json({ error: 'Only an approved cancellation can be marked refunded.' });
    if (c.refundedAt) return res.status(409).json({ error: 'This refund is already recorded.' });
    const policy = await getPolicy();
    if (!(await mayDecide(req.auth!.sub, policy))) return res.status(403).json({ error: 'You are not allowed to record refunds under the current policy.' });
    const updated = await prisma.bookingCancellation.update({ where: { id: c.id }, data: { refundedAt: new Date(), refundReference: String(req.body?.reference ?? '').trim() || null }, include });
    await writeAudit(req, { module: 'Bookings', action: 'Recorded refund', recordId: c.bookingId, recordLabel: `Booking ${c.booking.reference}`, description: `${inr(c.refundAmount)} refunded.` });
    res.json(shape(updated));
  } catch (err) {
    next(err);
  }
});
