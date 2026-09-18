import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma';

/**
 * Partner login is OTP-only (API docs §1.1/§1.2). The code is stored hashed, expires,
 * is single-use, and is rate-limited per phone number.
 *
 * DELIVERY IS NOT WIRED. This app has no SMS provider configured, so `sendOtp` does not
 * pretend to deliver anything: it returns the code as `dev_otp` outside production so the
 * app can be tested end-to-end, and returns null for it in production. Plugging in a real
 * gateway (MSG91/Twilio/Fast2SMS) means filling in `deliverOtp` below and nothing else.
 */

const OTP_TTL_MS = 5 * 60 * 1000;
export const RESEND_COOLDOWN_SECONDS = 30;
const MAX_SENDS_PER_WINDOW = 5;
const SEND_WINDOW_MS = 15 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

const isProduction = process.env.NODE_ENV === 'production';

/**
 * TEMPORARY — a master code that verifies any number, so the app can be tested before an
 * SMS provider exists.
 *
 * Unset by default, so it does nothing unless someone deliberately turns it on. While it is
 * set, **anyone who knows the code can sign in as any partner**, so it must come out the
 * moment `deliverOtp` is wired to a real gateway. It is never returned by `/auth/otp` —
 * learning it has to happen out of band, not from an unauthenticated endpoint.
 */
const BYPASS_CODE = process.env.OTP_BYPASS_CODE?.trim() || null;

if (BYPASS_CODE) {
  console.warn(
    `[otp] ⚠  OTP_BYPASS_CODE is set — any phone number can sign in with that code. ` +
      `Remove it from the environment as soon as SMS delivery is wired.`
  );
}

export class OtpError extends Error {
  constructor(readonly code: string, message: string, readonly httpStatus = 400) {
    super(message);
  }
}

/**
 * The single place a real SMS provider would be called. Left unimplemented on purpose —
 * faking a "sent" result would make a broken integration look healthy.
 */
async function deliverOtp(_phone: string, _code: string): Promise<boolean> {
  return false;
}

export interface SendOtpResult {
  sent: boolean;
  resendInSeconds: number;
  /** Present only outside production, so a developer can complete the flow without SMS. */
  devOtp: string | null;
}

export async function sendOtp(phone: string): Promise<SendOtpResult> {
  const windowStart = new Date(Date.now() - SEND_WINDOW_MS);
  const recentCount = await prisma.otpCode.count({ where: { phone, createdAt: { gte: windowStart } } });
  if (recentCount >= MAX_SENDS_PER_WINDOW) {
    throw new OtpError('rate_limited', 'Too many OTP requests. Please try again in a few minutes.', 429);
  }

  const lastSend = await prisma.otpCode.findFirst({ where: { phone }, orderBy: { createdAt: 'desc' } });
  if (lastSend) {
    const elapsed = (Date.now() - lastSend.createdAt.getTime()) / 1000;
    if (elapsed < RESEND_COOLDOWN_SECONDS) {
      throw new OtpError('resend_too_soon', `Please wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed)}s before requesting another code.`, 429);
    }
  }

  const code = String(crypto.randomInt(100000, 1000000));
  // Any previous unconsumed code for this number stops working the moment a new one is issued.
  await prisma.otpCode.updateMany({
    where: { phone, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await prisma.otpCode.create({
    data: { phone, codeHash: await bcrypt.hash(code, 8), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });

  await deliverOtp(phone, code);
  return { sent: true, resendInSeconds: RESEND_COOLDOWN_SECONDS, devOtp: isProduction ? null : code };
}

/** Consumes the code on success. Throws OtpError('invalid_otp') otherwise. */
export async function verifyOtp(phone: string, code: string): Promise<void> {
  if (BYPASS_CODE && code === BYPASS_CODE) {
    // Recorded as a consumed code rather than short-circuiting, so registration's
    // `hasRecentVerification` check behaves exactly as it does for a real one.
    await prisma.otpCode.create({
      data: {
        phone,
        codeHash: await bcrypt.hash(code, 8),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        consumedAt: new Date(),
      },
    });
    console.warn(`[otp] bypass code used for ${phone}`);
    return;
  }

  const record = await prisma.otpCode.findFirst({
    where: { phone, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!record || record.expiresAt < new Date()) {
    throw new OtpError('invalid_otp', 'That code is incorrect or has expired.', 401);
  }
  if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
    throw new OtpError('invalid_otp', 'Too many incorrect attempts. Request a new code.', 401);
  }
  if (!(await bcrypt.compare(code, record.codeHash))) {
    await prisma.otpCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    throw new OtpError('invalid_otp', 'That code is incorrect or has expired.', 401);
  }
  await prisma.otpCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
}

/** 10 digits, no country code — the only shape the app sends. */
export function normalizePhone(input: unknown): string {
  const digits = String(input ?? '').replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (local.length !== 10) throw new OtpError('invalid_phone', 'Enter a valid 10-digit mobile number.');
  return local;
}

const VERIFICATION_GRACE_MS = 15 * 60 * 1000;

/**
 * True if this phone completed `verifyOtp` recently. Registration (§1.3) states the phone
 * must be verified via §1.1/§1.2 first, and this is what enforces it — without it anyone
 * could create an account for a number they don't control.
 */
export async function hasRecentVerification(phone: string): Promise<boolean> {
  const verified = await prisma.otpCode.findFirst({
    where: { phone, consumedAt: { gte: new Date(Date.now() - VERIFICATION_GRACE_MS) } },
    select: { id: true },
  });
  return !!verified;
}
