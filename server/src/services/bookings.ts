import type { BookingStatus, PaymentMode, Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { commissionForBooking, paidAmountFromBookings, remainingAmount } from './derive';

/**
 * The one place a Booking is created, and everything that has to happen with it.
 * Both surfaces call in here — the app's POST /bookings (a partner booking a plot) and
 * the admin panel's "record deposit payment" action — so the ledger side effects
 * (commission, referral bonuses, the sibling Investment row, the unit's booking status)
 * can never diverge between them.
 */

export class BookingError extends Error {
  constructor(readonly code: string, message: string, readonly httpStatus = 400) {
    super(message);
  }
}

const REFERENCE_BASE = 20500;

/**
 * Server-owned booking reference. The client fakes one during checkout and it is always
 * discarded (API docs §4.2). Derived from the row count and retried on collision, so
 * concurrent bookings cannot end up sharing a reference.
 */
async function nextReference(tx: Prisma.TransactionClient): Promise<string> {
  const count = await tx.booking.count();
  for (let offset = 1; offset <= 50; offset += 1) {
    const candidate = `BKG-${REFERENCE_BASE + count + offset}`;
    const clash = await tx.booking.findUnique({ where: { reference: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }
  return `BKG-${Date.now()}`;
}

/**
 * Referral bonuses, using the level→percent ladder the admin configures under
 * Settings > Referral Commission. Walks up the sponsor chain as far as the configured
 * levels go. Skipped entirely when the `investmentCommission` toggle is off, which is
 * exactly what that toggle means in the real system.
 */
async function creditReferralBonuses(
  tx: Prisma.TransactionClient,
  partnerId: string,
  bookingId: string,
  bookingAmount: number,
  title: string
): Promise<void> {
  const toggles = await tx.referralToggleSettings.findUnique({ where: { id: 'singleton' } });
  if (toggles && !toggles.investmentCommission) return;

  const rules = await tx.referralLevelRule.findMany({
    where: { commissionType: 'investment' },
    orderBy: { level: 'asc' },
  });
  if (rules.length === 0) return;

  let currentId: string | null = partnerId;
  for (const rule of rules) {
    const current: { sponsorId: string | null } | null = currentId
      ? await tx.user.findUnique({ where: { id: currentId }, select: { sponsorId: true } })
      : null;
    const sponsorId: string | null = current?.sponsorId ?? null;
    if (!sponsorId) break;

    const amount = Math.round((bookingAmount * rule.percent) / 100);
    if (amount > 0) {
      await tx.earningEntry.create({
        data: {
          userId: sponsorId,
          kind: 'referralBonus',
          title: `L${rule.level} referral · ${title}`,
          amount,
          bookingId,
          referralUserId: partnerId,
        },
      });
    }
    currentId = sponsorId;
  }
}

export interface CreateBookingInput {
  unitId: string;
  bookingName: string;
  phone: string;
  /** The partner making the booking. Null only for an admin-entered walk-in. */
  userId?: string | null;
  involvedMemberId?: string | null;
  amount: number;
  paymentMode: PaymentMode;
  chequeImage?: string | null;
  note?: string | null;
  aadhaarNumber?: string | null;
  aadhaarImage?: string | null;
  aadhaarBack?: string | null;
  /** 0 = the initial booking, 1 = a later installment against the same unit. */
  isDeposit?: 0 | 1;
  status?: BookingStatus;
}

/**
 * Creates the booking plus every downstream row, in one transaction:
 *   Booking -> Investment (the money placed) -> EarningEntry (the partner's commission)
 *           -> referral EarningEntry rows up the sponsor chain
 *           -> the unit's bookingStatus / bookedBy
 *           -> a Notification for the partner
 */
export async function createBooking(input: CreateBookingInput) {
  return prisma.$transaction(async (tx) => {
    const unit = await tx.propertyUnit.findUnique({
      where: { id: input.unitId },
      include: { project: { select: { projectName: true } }, bookings: { select: { amount: true, status: true } } },
    });
    if (!unit) throw new BookingError('property_not_found', 'That plot could not be found.', 404);

    const isDeposit = input.isDeposit ?? 0;

    if (isDeposit === 0) {
      if (unit.bookingStatus !== 0) {
        throw new BookingError('property_unavailable', 'That plot is no longer available.', 409);
      }
      const activeHold = await tx.plotHold.findFirst({
        where: { unitId: unit.id, status: 1, holdEnd: { gt: new Date() } },
        select: { userId: true },
      });
      // A hold blocks everyone except the partner it was placed for.
      if (activeHold && activeHold.userId && activeHold.userId !== input.userId) {
        throw new BookingError('property_on_hold', 'That plot is currently on hold.', 409);
      }
    }

    if (input.paymentMode === 'cheque' && !input.chequeImage) {
      throw new BookingError('cheque_photo_required', 'A cheque photo is required for cheque payments.');
    }
    if (input.paymentMode === 'other' && !input.note) {
      throw new BookingError('note_required', 'Describe how the payment was made.');
    }

    const amount = Math.round(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BookingError('invalid_amount', 'The payment amount must be greater than zero.');
    }

    const alreadyPaid = paidAmountFromBookings(unit.bookings);
    const outstanding = remainingAmount(unit.totalInvestmentAmount, alreadyPaid);
    if (isDeposit === 1 && outstanding <= 0) {
      throw new BookingError('nothing_outstanding', 'This plot has no remaining balance.');
    }

    const commission = commissionForBooking(unit, amount);
    const reference = await nextReference(tx);
    const title = `${unit.propertyNumber} · ${input.bookingName}`;

    const booking = await tx.booking.create({
      data: {
        reference,
        propertyId: unit.id,
        bookingName: input.bookingName,
        phone: input.phone,
        userId: input.userId ?? null,
        involvedMemberId: input.involvedMemberId ?? null,
        amount,
        paymentMode: input.paymentMode,
        chequeImage: input.chequeImage ?? null,
        note: input.note ?? null,
        aadhaarNumber: input.aadhaarNumber ?? null,
        aadhaarImage: input.aadhaarImage ?? null,
        aadhaarBack: input.aadhaarBack ?? null,
        isDeposit,
        // An online payment is confirmed the moment it lands; every other mode is an
        // admin-verified claim and starts as pending.
        status: input.status ?? (input.paymentMode === 'online' ? 'booked' : 'pending'),
        commission,
      },
    });

    if (input.userId) {
      await tx.investment.create({
        data: {
          userId: input.userId,
          propertyId: unit.id,
          bookingId: booking.id,
          amount,
          profit: commission,
          profitType: 0,
          // The real system nets ~10% off the gross commission before it is payable.
          netProfit: Math.round(commission * 0.9),
        },
      });

      if (commission > 0) {
        await tx.earningEntry.create({
          data: { userId: input.userId, kind: 'bookingCommission', title, amount: commission, bookingId: booking.id },
        });
      }
      // A credited downline member shares the commission ledger entry, not the money —
      // the split itself is a payroll decision the platform does not model.
      if (input.involvedMemberId && commission > 0) {
        await tx.earningEntry.create({
          data: {
            userId: input.involvedMemberId,
            kind: 'bookingCommission',
            title: `${title} (shared)`,
            amount: 0,
            bookingId: booking.id,
          },
        });
      }
      await creditReferralBonuses(tx, input.userId, booking.id, amount, title);

      const notification = await tx.notification.create({
        data: {
          title: 'Booking submitted',
          body: `${unit.propertyNumber} at ${unit.project.projectName} was booked for ${input.bookingName}.`,
          type: 'booking',
          audience: 'all',
        },
      });
      await tx.notificationRecipient.create({ data: { notificationId: notification.id, userId: input.userId } });
    }

    const paidNow = alreadyPaid + amount;
    await tx.propertyUnit.update({
      where: { id: unit.id },
      data: {
        // Fully paid closes the plot out; anything less leaves it Booked.
        bookingStatus: remainingAmount(unit.totalInvestmentAmount, paidNow) === 0 ? 2 : 1,
        bookedById: unit.bookedById ?? input.userId ?? null,
      },
    });

    return booking;
  });
}

/**
 * Hard-deletes a booking and reverses its side effects — the real system has no soft
 * "reject" for a deposit row, so deletion plus reversal IS the reject mechanism.
 * Cascades handle Investment; the unit's status is recomputed from what is left.
 */
export async function deleteBookingWithReversal(bookingId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId }, select: { propertyId: true } });
    if (!booking) return;

    await tx.booking.delete({ where: { id: bookingId } });

    const unit = await tx.propertyUnit.findUnique({
      where: { id: booking.propertyId },
      include: { bookings: { select: { amount: true, status: true, userId: true } } },
    });
    if (!unit) return;

    const paid = paidAmountFromBookings(unit.bookings);
    await tx.propertyUnit.update({
      where: { id: unit.id },
      data: {
        bookingStatus:
          unit.bookings.length === 0 ? 0 : remainingAmount(unit.totalInvestmentAmount, paid) === 0 ? 2 : 1,
        bookedById: unit.bookings.length === 0 ? null : unit.bookedById,
        isVerified: unit.bookings.length === 0 ? false : unit.isVerified,
      },
    });
  });
}
