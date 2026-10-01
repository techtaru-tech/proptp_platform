import { Router } from 'express';
import type { UserRole } from '@prisma/client';
import { prisma } from '../../prisma';
import { generatePartnerCode, requireAuth, signToken, type AuthedRequest } from '../../services/auth';
import { createSession } from '../../services/sessions';
import { rememberDeviceToken } from '../../services/notify';
import { OtpError, hasRecentVerification, normalizePhone, sendOtp, verifyOtp } from '../../services/otp';
import { upload, urlsByField } from '../../services/upload';
import { appUser } from '../../services/appMappers';

/**
 * App auth — OTP only, no passwords anywhere (API docs §1).
 * Errors use the documented shape: { error: { code, message } }.
 */
export const appAuthRouter = Router();

function fail(res: any, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

/** Loads the display names the app's UserModel carries but does not store on the row. */
async function serializeUser(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      reportingLeader: { select: { name: true } },
      sponsor: { select: { name: true, referralCode: true } },
    },
  });
  return appUser(user, {
    reportingLeaderName: user.reportingLeader?.name,
    sponsorName: user.sponsor?.name,
    sponsorCode: user.sponsor?.referralCode,
  });
}

// §1.1 POST /auth/otp — request an OTP (public)
appAuthRouter.post('/otp', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const result = await sendOtp(phone);
    // `dev_otp` is null in production. See services/otp.ts — SMS delivery is not wired.
    res.json({ sent: result.sent, resend_in_seconds: result.resendInSeconds, dev_otp: result.devOtp });
  } catch (err) {
    if (err instanceof OtpError) return fail(res, err.httpStatus, err.code, err.message);
    next(err);
  }
});

// §1.2 POST /auth/verify — verify OTP and log in (public)
appAuthRouter.post('/verify', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const code = String(req.body?.code ?? '').trim();
    await verifyOtp(phone, code);

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      // The OTP was correct but there is no account yet. The doc has §1.1 serving both
      // login and registration, so this is the app's cue to open the registration form —
      // the verification stays valid for 15 minutes, which is what §1.3 requires.
      return fail(res, 404, 'not_registered', 'This number has no account yet. Please complete registration.');
    }
    if (user.status !== 'active') {
      // Matches what `requireAuth` would do on the very next call, so a blocked partner is
      // turned away at sign-in rather than handed a token that 401s on every request.
      const message =
        user.status === 'suspended'
          ? 'This account has been suspended. Please contact support.'
          : 'This account has been deactivated. Please contact your administrator.';
      return fail(res, 403, `account_${user.status}`, message);
    }

    // The app sends its Firebase token here, which is the first moment we know both who the
    // device belongs to and that they are allowed in.
    await rememberDeviceToken(user.id, req.body?.fcmToken ?? req.body?.fcm_token);

    const sid = await createSession(user.id, req);
    res.json({ token: signToken({ sub: user.id, role: user.role, sid }), user: await serializeUser(user.id) });
  } catch (err) {
    if (err instanceof OtpError) return fail(res, err.httpStatus, err.code, err.message);
    next(err);
  }
});

// §1.4 GET /auth/sponsor?code= — resolve a referral code (public)
appAuthRouter.get('/sponsor', async (req, res, next) => {
  try {
    const code = String(req.query.code ?? '').trim();
    if (!code) return fail(res, 400, 'missing_code', 'A referral code is required.');
    const sponsor = await prisma.user.findFirst({
      where: { OR: [{ referralCode: code }, { partnerCode: code }] },
      select: { name: true },
    });
    if (!sponsor) return fail(res, 404, 'sponsor_not_found', 'No partner found for that referral code.');
    res.json({ sponsor_name: sponsor.name });
  } catch (err) {
    next(err);
  }
});

// §1.5 GET /auth/leaders — the leaders an Employee can report to (public)
//
// Public on purpose: an Employee picks their reporting leader during registration, which
// happens before any token exists, so this cannot sit behind the authenticated routes.
// Only active leaders, and only the four fields the picker renders.
appAuthRouter.get('/leaders', async (_req, res, next) => {
  try {
    const leaders = await prisma.user.findMany({
      where: { role: { in: ['leader', 'team_leader'] }, status: 'active' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, partnerCode: true, area: true },
    });
    res.json({
      leaders: leaders.map((leader) => ({
        id: leader.id,
        name: leader.name,
        partner_code: leader.partnerCode,
        area: leader.area,
      })),
    });
  } catch (err) {
    next(err);
  }
});

const SELF_REGISTERABLE_ROLES: UserRole[] = ['agent', 'employee', 'leader'];

const KYC_FIELDS = [
  { name: 'aadhaar_front', maxCount: 1 },
  { name: 'aadhaar_back', maxCount: 1 },
  { name: 'pan_card', maxCount: 1 },
  { name: 'passport_photo', maxCount: 1 },
  { name: 'cancelled_cheque', maxCount: 1 },
];

const KYC_KIND_BY_FIELD = {
  aadhaar_front: 'aadhaarFront',
  aadhaar_back: 'aadhaarBack',
  pan_card: 'panCard',
  passport_photo: 'passportPhoto',
  cancelled_cheque: 'cancelledCheque',
} as const;

// §1.3 POST /auth/register — register a new partner (public, multipart/form-data)
appAuthRouter.post('/register', upload.fields(KYC_FIELDS), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const phone = normalizePhone(body.phone);

    if (!(await hasRecentVerification(phone))) {
      return fail(res, 403, 'phone_not_verified', 'Verify this mobile number with an OTP before registering.');
    }
    if (await prisma.user.findUnique({ where: { phone } })) {
      return fail(res, 409, 'already_registered', 'An account already exists for this mobile number.');
    }

    const role = String(body.role ?? '') as UserRole;
    if (!SELF_REGISTERABLE_ROLES.includes(role)) {
      return fail(res, 400, 'invalid_role', 'Role must be one of agent, employee or leader.');
    }
    if (!body.email) return fail(res, 400, 'missing_email', 'Email is required.');
    if (!body.aadhaar_number) return fail(res, 400, 'missing_aadhaar', 'Aadhaar number is required.');

    const name =
      role === 'agent'
        ? `${String(body.first_name ?? '').trim()} ${String(body.last_name ?? '').trim()}`.trim()
        : String(body.full_name ?? '').trim();
    if (!name) return fail(res, 400, 'missing_name', 'Name is required.');

    const files = urlsByField(req.files);
    const missingDoc = (['aadhaar_front', 'aadhaar_back', 'pan_card', 'passport_photo'] as const).find((f) => !files[f]);
    if (missingDoc) return fail(res, 400, 'missing_document', `${missingDoc.replace(/_/g, ' ')} is required.`);

    const referralCode = String(body.referral_code ?? '').trim();
    const sponsor = referralCode
      ? await prisma.user.findFirst({
          where: { OR: [{ referralCode }, { partnerCode: referralCode }] },
          select: { id: true },
        })
      : null;

    const reportingLeaderId = String(body.reporting_leader_id ?? '').trim() || null;
    if (role === 'employee' && reportingLeaderId) {
      const leader = await prisma.user.findFirst({
        where: { id: reportingLeaderId, role: { in: ['leader', 'team_leader'] }, status: 'active' },
        select: { id: true },
      });
      if (!leader) return fail(res, 400, 'invalid_reporting_leader', 'That reporting leader does not exist.');
    }

    const partnerCode = await generatePartnerCode(role);
    const created = await prisma.user.create({
      data: {
        name,
        phone,
        email: String(body.email),
        role,
        partnerCode,
        // A partner's referral code IS their partner code for every account this backend creates.
        referralCode: partnerCode,
        sponsorId: sponsor?.id ?? null,
        city: body.city ? String(body.city) : null,
        pincode: body.pincode ? String(body.pincode) : null,
        designation: body.designation ? String(body.designation) : null,
        area: body.area ? String(body.area) : null,
        reportingLeaderId: role === 'employee' ? reportingLeaderId : null,
        leaderCode: role === 'leader' && body.leader_code ? String(body.leader_code) : null,
        aadhaarNumber: String(body.aadhaar_number),
        panNumber: body.pan_number ? String(body.pan_number) : null,
        kycDocuments: {
          create: Object.entries(KYC_KIND_BY_FIELD)
            .filter(([field]) => files[field])
            .map(([field, kind]) => ({ kind, fileUrl: files[field] })),
        },
      },
    });

    await rememberDeviceToken(created.id, req.body?.fcmToken ?? req.body?.fcm_token);

    const sid = await createSession(created.id, req);
    res.status(201).json({ token: signToken({ sub: created.id, role: created.role, sid }), user: await serializeUser(created.id) });
  } catch (err) {
    if (err instanceof OtpError) return fail(res, err.httpStatus, err.code, err.message);
    next(err);
  }
});

/** Not in the doc, but the app needs it after a cold start to refresh the stored profile. */
appAuthRouter.get('/me', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    res.json({ user: await serializeUser(req.auth!.sub) });
  } catch (err) {
    next(err);
  }
});
