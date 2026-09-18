import { Router } from 'express';
import type { PaymentMode } from '@prisma/client';
import { prisma } from '../../prisma';
import { requireAuth, type AuthedRequest } from '../../services/auth';
import { BookingError, createBooking } from '../../services/bookings';
import { APP_VISIBLE_PROJECT, paidAmountFromBookings } from '../../services/derive';
import { appBooking } from '../../services/appMappers';
import { upload, urlsByField } from '../../services/upload';

/** API docs §4 — the partner's own booking history and booking submission. */
export const appBookingsRouter = Router();

appBookingsRouter.use(requireAuth);

const PAYMENT_MODES: PaymentMode[] = ['online', 'bankTransfer', 'cash', 'cheque', 'other'];

const bookingInclude = {
  unit: { include: { project: { select: { projectName: true } } } },
} as const;

// §4.1 GET /bookings — the partner's bookings, plus any made by their downline
appBookingsRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.auth!.sub;
    // A Leader/Employee also sees bookings their downline made, which is what
    // `by_team_member` is for; an Agent only ever sees their own.
    const downline = await prisma.user.findMany({
      where: { OR: [{ sponsorId: userId }, { reportingLeaderId: userId }] },
      select: { id: true, name: true },
    });
    const downlineIds = downline.map((d) => d.id);
    const nameById = new Map(downline.map((d) => [d.id, d.name]));

    const bookings = await prisma.booking.findMany({
      where: {
        isDeposit: 0,
        OR: [{ userId }, { involvedMemberId: userId }, ...(downlineIds.length ? [{ userId: { in: downlineIds } }] : [])],
      },
      include: bookingInclude,
      orderBy: { createdAt: 'desc' },
    });

    // One grouped query for what has been paid per plot, rather than a query per row.
    const unitIds = [...new Set(bookings.map((b) => b.propertyId))];
    const siblings = await prisma.booking.findMany({
      where: { propertyId: { in: unitIds } },
      select: { propertyId: true, amount: true, status: true },
    });
    const paidByUnit = new Map<string, number>();
    for (const unitId of unitIds) {
      paidByUnit.set(unitId, paidAmountFromBookings(siblings.filter((s) => s.propertyId === unitId)));
    }

    res.json({
      bookings: bookings.map((b) =>
        appBooking(b, {
          paidAmount: paidByUnit.get(b.propertyId) ?? b.amount,
          byTeamMember: b.userId && b.userId !== userId ? nameById.get(b.userId) ?? null : null,
        })
      ),
    });
  } catch (err) {
    next(err);
  }
});

const BOOKING_FILES = [
  { name: 'aadhaar_front', maxCount: 1 },
  { name: 'aadhaar_back', maxCount: 1 },
  { name: 'cheque_photo', maxCount: 1 },
];

// §4.2 POST /bookings — submit a booking (multipart when documents are attached)
appBookingsRouter.post('/', upload.fields(BOOKING_FILES), async (req: AuthedRequest, res, next) => {
  try {
    const body = req.body ?? {};
    const files = urlsByField(req.files);

    const mode = String(body.mode ?? '') as PaymentMode;
    if (!PAYMENT_MODES.includes(mode)) {
      return res.status(400).json({ error: { code: 'invalid_mode', message: 'mode must be one of online, bankTransfer, cash, cheque, other.' } });
    }
    for (const field of ['property_id', 'customer_name', 'phone', 'aadhaar_number'] as const) {
      if (!body[field]) {
        return res.status(400).json({ error: { code: 'missing_field', message: `${field} is required.` } });
      }
    }

    const involvedMemberId = String(body.involved_member_id ?? '').trim() || null;
    if (involvedMemberId) {
      const member = await prisma.user.findFirst({
        where: { id: involvedMemberId, OR: [{ sponsorId: req.auth!.sub }, { reportingLeaderId: req.auth!.sub }] },
        select: { id: true },
      });
      if (!member) {
        return res.status(400).json({ error: { code: 'invalid_member', message: 'That member is not in your team.' } });
      }
    }

    // `token_amount` is read from the plot, never from the request: a stale client list
    // must not be able to underpay (the same reasoning as the doc's "never send the amount").
    // Scoped to a visible project for the same reason the catalogue is: a plot the app
    // cannot list is a plot the app cannot book, even with a stale property_id in hand.
    const unit = await prisma.propertyUnit.findFirst({
      where: { id: String(body.property_id), project: APP_VISIBLE_PROJECT },
      select: { tokenAmount: true },
    });
    if (!unit) {
      return res.status(404).json({ error: { code: 'property_not_found', message: 'That plot could not be found.' } });
    }

    const booking = await createBooking({
      unitId: String(body.property_id),
      bookingName: String(body.customer_name),
      phone: String(body.phone),
      userId: req.auth!.sub,
      involvedMemberId,
      amount: unit.tokenAmount,
      paymentMode: mode,
      chequeImage: files.cheque_photo ?? null,
      note: body.note ? String(body.note) : null,
      aadhaarNumber: String(body.aadhaar_number),
      aadhaarImage: files.aadhaar_front ?? null,
      aadhaarBack: files.aadhaar_back ?? null,
    });

    const created = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: bookingInclude });
    res.status(201).json(appBooking(created, { paidAmount: created.amount }));
  } catch (err) {
    if (err instanceof BookingError) {
      return res.status(err.httpStatus).json({ error: { code: err.code, message: err.message } });
    }
    next(err);
  }
});
