import type { PaymentMode, PrismaClient, User } from '@prisma/client';
import { createBooking } from '../src/services/bookings';
import { upsertMark } from '../src/services/attendance';
import { dayKey } from '../src/services/dates';

/**
 * The transactional half of the seed: bookings, attendance, payouts, deposits, tickets and
 * notifications.
 *
 * Bookings go through the SAME `createBooking` engine the API uses, rather than being
 * inserted directly. That is deliberate — it means the seeded plot statuses, investment
 * rows, commission ledger and referral bonuses are produced by the real code path and
 * cannot drift from what a live booking would produce.
 */

function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}
const rng = makeRng(776655);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length) % items.length];
const randInt = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);

const CUSTOMER_FIRST = ['Rajendra', 'Kiran', 'Bharat', 'Falguni', 'Mahesh', 'Jyoti', 'Ashok', 'Rekha', 'Dinesh', 'Usha'];
const CUSTOMER_LAST = ['Patel', 'Shah', 'Trivedi', 'Modi', 'Thakkar', 'Vyas', 'Pandya', 'Solanki'];
const MODES: PaymentMode[] = ['bankTransfer', 'cash', 'cheque', 'online', 'other'];
const BANKS = ['HDFC Bank', 'ICICI Bank', 'Axis Bank', 'State Bank of India', 'Kotak Mahindra Bank'];

const TICKET_SUBJECTS = [
  'Payout not received for last cycle',
  'Unable to check in — location not detected',
  'Plot booking documents pending upload',
  'Commission calculation looks incorrect',
  'App crashes on the projects screen',
  'Need help updating my bank account',
];

const BROADCASTS: [string, string, 'booking' | 'payout' | 'team' | 'system', 'all' | 'agents' | 'employees' | 'leaders'][] = [
  ['New project launched: Rosium Sapphire Court', 'Explore the latest inventory and pricing now available for booking.', 'system', 'agents'],
  ['Payout processed for this cycle', 'Your approved payout requests have been credited to your registered bank account.', 'payout', 'all'],
  ['Attendance policy update', 'Office geo-fence radius has been updated. Please review the new check-in guidelines.', 'system', 'employees'],
  ['Monthly team performance summary', 'Your team booking and referral summary for the month is now available.', 'team', 'leaders'],
  ['Festival holiday announcement', 'Office and site visits will remain closed on the upcoming public holiday.', 'system', 'all'],
  ['Referral bonus credited', 'Referral bonus for your recent successful referral has been credited.', 'payout', 'agents'],
];

const ROLE_FOR_AUDIENCE = {
  all: ['agent', 'employee', 'leader'],
  agents: ['agent'],
  employees: ['employee'],
  leaders: ['leader'],
} as const;

export async function seedOperations(
  prisma: PrismaClient,
  people: { admin: User; partners: User[]; leaders: User[]; employees: User[]; agents: User[] }
) {
  const { admin, partners, leaders, employees } = people;

  // Re-running the seed must not double the transactional data, and bookings are not
  // upsertable (their references are generated), so this half runs once.
  if ((await prisma.booking.count()) > 0) {
    console.log('  operations data already present — skipping bookings/attendance/payouts.');
    return;
  }

  // -------------------------------------------------------------------------
  // Bank accounts — one verified primary each, a few extra pending ones
  // -------------------------------------------------------------------------
  for (const partner of partners) {
    await prisma.bankAccount.create({
      data: {
        userId: partner.id,
        bankName: pick(BANKS),
        accountNumber: String(randInt(10000000, 99999999)) + String(randInt(100000, 999999)),
        holderName: partner.name,
        ifsc: `HDFC000${randInt(1000, 9999)}`,
        accountType: rng() > 0.2 ? 'Savings' : 'Current',
        state: 'verified',
        isPrimary: true,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Bookings — through the real engine
  // -------------------------------------------------------------------------
  const available = await prisma.propertyUnit.findMany({ where: { bookingStatus: 0 }, orderBy: { id: 'asc' } });
  // Roughly 45% of the catalogue gets booked, which leaves a healthy available pool.
  const toBook = available.filter(() => rng() < 0.45);

  let booked = 0;
  for (const unit of toBook) {
    const partner = pick(partners);
    const mode = pick(MODES);
    const customer = `${pick(CUSTOMER_FIRST)} ${pick(CUSTOMER_LAST)}`;
    // Some plots are paid in full straight away (which the engine turns into Sold Out);
    // the rest take a token or part payment and stay Booked with a balance outstanding.
    const payInFull = rng() > 0.65;
    const amount = payInFull ? unit.totalInvestmentAmount : Math.round(unit.totalInvestmentAmount * (randInt(10, 45) / 100));

    try {
      const created = await createBooking({
        unitId: unit.id,
        bookingName: customer,
        phone: `9${String(800000000 + booked * 211).slice(0, 9)}`,
        userId: partner.id,
        amount,
        paymentMode: mode,
        chequeImage: mode === 'cheque' ? 'https://placehold.co/400x260/eef0f3/667085?text=Cheque' : null,
        note: mode === 'other' ? 'Paid by UPI to the site office account.' : null,
        aadhaarNumber: `XXXX-XXXX-${randInt(1000, 9999)}`,
        aadhaarImage: 'https://placehold.co/400x260/eef0f3/667085?text=Aadhaar+Front',
        aadhaarBack: 'https://placehold.co/400x260/eef0f3/667085?text=Aadhaar+Back',
        status: rng() > 0.25 ? 'booked' : 'pending',
      });
      // Backdate it, so the dashboard trend and reports have history to show.
      const bookedOn = daysAgo(randInt(1, 260));
      await prisma.booking.update({ where: { id: created.id }, data: { createdAt: bookedOn } });
      await prisma.investment.updateMany({ where: { bookingId: created.id }, data: { createdAt: bookedOn } });
      await prisma.earningEntry.updateMany({ where: { bookingId: created.id }, data: { creditedOn: bookedOn, createdAt: bookedOn } });
      booked += 1;
    } catch (err) {
      // A plot that became unbookable mid-seed is simply skipped rather than failing the run.
      console.warn(`  skipped booking for ${unit.id}: ${(err as Error).message}`);
    }
  }

  // Mark a slice of the booked plots verified, as an admin would have.
  const bookedUnits = await prisma.propertyUnit.findMany({ where: { bookingStatus: { not: 0 } }, select: { id: true } });
  await prisma.propertyUnit.updateMany({
    where: { id: { in: bookedUnits.filter(() => rng() > 0.35).map((u) => u.id) } },
    data: { isVerified: true },
  });

  // -------------------------------------------------------------------------
  // Incentive requests, against plots that were actually booked
  // -------------------------------------------------------------------------
  const bookedWithPartner = await prisma.propertyUnit.findMany({
    where: { bookingStatus: { not: 0 }, bookedById: { not: null } },
    select: { id: true, bookedById: true },
    take: 20,
  });
  for (const unit of bookedWithPartner) {
    await prisma.incentiveRequest.create({
      data: {
        userId: unit.bookedById!,
        propertyId: unit.id,
        status: rng() > 0.55 ? 1 : rng() > 0.5 ? 0 : 2,
        createdAt: daysAgo(randInt(0, 60)),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Wallet deposit requests (real `funds`)
  // -------------------------------------------------------------------------
  for (let i = 0; i < 24; i += 1) {
    const status = rng() > 0.4 ? 1 : rng() > 0.35 ? 2 : 3;
    await prisma.fundRequest.create({
      data: {
        userId: pick(partners).id,
        amount: randInt(5, 100) * 1000,
        gatewayName: 'Bank Transfer',
        trxId: `TRX${randInt(100000, 999999)}`,
        status,
        feedback: status === 3 ? 'Bank reference number could not be verified.' : null,
        createdAt: daysAgo(randInt(0, 120)),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Payouts, with a real status history per row
  // -------------------------------------------------------------------------
  for (let i = 0; i < 26; i += 1) {
    const partner = pick(partners);
    const account = await prisma.bankAccount.findFirst({ where: { userId: partner.id } });
    const roll = rng();
    const status = roll > 0.6 ? 'released' : roll > 0.48 ? 'confirmed' : roll > 0.2 ? 'pending' : roll > 0.08 ? 'rejected' : 'failed';
    const requestDate = daysAgo(randInt(2, 90));
    const amount = randInt(5, 60) * 1000;

    const history: { status: any; note: string; createdAt: Date }[] = [
      { status: 'pending', note: 'Request raised', createdAt: requestDate },
    ];
    if (['confirmed', 'released', 'failed'].includes(status)) {
      history.push({ status: 'confirmed', note: 'Confirmed by finance / gateway', createdAt: daysAgo(randInt(1, 8)) });
    }
    if (status === 'released') {
      history.push({ status: 'released', note: 'Amount debited and credited to bank account', createdAt: daysAgo(randInt(0, 4)) });
    }
    if (status === 'rejected') {
      history.push({ status: 'rejected', note: 'Insufficient supporting documents', createdAt: daysAgo(randInt(0, 6)) });
    }
    if (status === 'failed') {
      history.push({ status: 'failed', note: 'Automatic gateway payout failed — balance refunded', createdAt: daysAgo(randInt(0, 3)) });
    }

    await prisma.payoutRequest.create({
      data: {
        userId: partner.id,
        amount,
        requestDate,
        status: status as any,
        processor: rng() > 0.5 ? 'Priyanka Singh' : 'Finance Desk',
        bankAccountMasked: account ? `•••• •••• ${account.accountNumber.slice(-4)}` : '',
        bankIfsc: account?.ifsc ?? '',
        referralBonus: Math.round(amount * 0.3),
        commission: Math.round(amount * 0.7),
        isAutomaticMethod: status === 'failed' || rng() > 0.6,
        lastError: status === 'failed' ? 'Beneficiary account name mismatch (gateway code IMPS_003)' : null,
        history: { create: history },
      },
    });
  }

  // Joining bonuses, so the app's earnings breakdown has all three kinds populated.
  for (const partner of partners.filter(() => rng() > 0.5)) {
    await prisma.earningEntry.create({
      data: {
        userId: partner.id,
        kind: 'joiningBonus',
        title: 'Joining bonus',
        amount: randInt(1, 5) * 1000,
        status: 'released',
        creditedOn: partner.joinedOn,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Attendance — 45 days for every employee and leader, through the real rules
  // -------------------------------------------------------------------------
  const attendanceUsers = [...employees, ...leaders];
  const location = await prisma.workLocation.findFirstOrThrow({ where: { isDefault: true } });
  let marks = 0;

  for (const user of attendanceUsers) {
    for (let back = 0; back < 45; back += 1) {
      const day = new Date(dayKey(daysAgo(back)));
      // No attendance on Sundays.
      if (day.getUTCDay() === 0) continue;
      // ~12% of working days are absences — no marks at all.
      if (rng() < 0.12) continue;

      const checkIn = new Date(day);
      checkIn.setUTCHours(4, 0, 0, 0); // 09:30 IST
      checkIn.setUTCMinutes(checkIn.getUTCMinutes() + randInt(-20, 75));

      const complete = back > 0 || rng() > 0.4;
      const checkOut = complete ? new Date(checkIn.getTime() + randInt(7, 10) * 3600000) : null;

      // Most marks are inside the geofence; a few are outside, which is what the admin's
      // location filter and the "outside" badge exist for.
      const inside = rng() > 0.15;
      const offset = inside ? 0.0008 : 0.02;

      await upsertMark(user.id, {
        date: day.toISOString().slice(0, 10),
        checkInAt: checkIn.toISOString(),
        checkOutAt: checkOut?.toISOString() ?? null,
        checkInLocation: location.name,
        checkOutLocation: checkOut ? location.name : null,
        checkInLat: location.latitude + offset,
        checkInLng: location.longitude + offset,
        checkOutLat: checkOut ? location.latitude + offset : null,
        checkOutLng: checkOut ? location.longitude + offset : null,
        markedBy: user.name,
        device: 'Android · this device',
      });
      marks += 1;
    }
  }

  // A handful of correction requests and sync failures for the admin queues to work on.
  const recent = await prisma.attendanceRecord.findMany({ orderBy: { date: 'desc' }, take: 40, select: { id: true } });
  const forCorrection = recent.filter(() => rng() < 0.15);
  for (const record of forCorrection) {
    await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: {
        correctionRequested: true,
        correctionReason: pick([
          'Forgot to check out before leaving the site.',
          'App had no network at the site, marked late by mistake.',
          'Was at a client meeting outside the geo-fence.',
        ]),
        correctionStatus: 'pending',
      },
    });
  }
  const forFailure = recent.filter((r) => !forCorrection.includes(r)).filter(() => rng() < 0.1);
  for (const record of forFailure) {
    await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: { syncStatus: 'failed', failureReason: 'Device clock was out of sync when the mark was pushed.' },
    });
  }

  // -------------------------------------------------------------------------
  // Support tickets
  // -------------------------------------------------------------------------
  for (let i = 0; i < TICKET_SUBJECTS.length; i += 1) {
    const partner = pick(partners);
    const createdAt = daysAgo(randInt(1, 45));
    const roll = rng();
    const status = roll > 0.6 ? 'open' : roll > 0.4 ? 'pending' : roll > 0.2 ? 'resolved' : 'closed';
    const adminReplied = status !== 'open';

    await prisma.supportTicket.create({
      data: {
        userId: partner.id,
        subject: TICKET_SUBJECTS[i],
        status: status as any,
        createdAt,
        lastReplyAt: adminReplied ? new Date(createdAt.getTime() + 3600000 * randInt(2, 40)) : null,
        messages: {
          create: [
            {
              authorId: partner.id,
              authorName: partner.name,
              authorRole: 'user',
              message: `${TICKET_SUBJECTS[i]}. Could you please check and let me know?`,
              createdAt,
            },
            ...(adminReplied
              ? [
                  {
                    authorId: admin.id,
                    authorName: `${admin.name} (Admin)`,
                    authorRole: 'admin',
                    message: 'Thanks for flagging this — we have looked into it and are following up internally.',
                    createdAt: new Date(createdAt.getTime() + 3600000 * randInt(2, 40)),
                  },
                ]
              : []),
          ],
        },
      },
    });
  }

  // -------------------------------------------------------------------------
  // Notification broadcasts, fanned out to their audience
  // -------------------------------------------------------------------------
  for (let i = 0; i < BROADCASTS.length; i += 1) {
    const [title, body, type, audience] = BROADCASTS[i];
    const recipients = partners.filter((p) => (ROLE_FOR_AUDIENCE[audience] as readonly string[]).includes(p.role));
    await prisma.notification.create({
      data: {
        title,
        body,
        type,
        audience,
        deliveryStatus: 'delivered',
        createdAt: daysAgo(randInt(0, 40)),
        recipients: {
          create: recipients.map((r) => ({
            userId: r.id,
            // Older broadcasts are mostly read, which gives the app's unread badge something real.
            read: rng() > 0.45,
            readAt: rng() > 0.45 ? daysAgo(randInt(0, 20)) : null,
          })),
        },
      },
    });
  }

  console.log(`  bookings: ${booked}, attendance marks: ${marks}, tickets: ${TICKET_SUBJECTS.length}, broadcasts: ${BROADCASTS.length}`);
}
