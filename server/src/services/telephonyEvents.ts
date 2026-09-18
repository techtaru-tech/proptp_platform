import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

/**
 * The provider's side of the conversation, recorded.
 *
 * Both telephony webhooks answer a live call under a time limit and neither can afford to
 * fail because bookkeeping failed, so every function here swallows its own errors. The point
 * is diagnosis during a real call: which request arrived, under what parameter names, and
 * what we said back — questions the pm2 log can answer only for whoever can reach the box.
 */

const RETENTION_DAYS = 14;

export type TelephonyEventKind = 'routing' | 'call_log';
export type TelephonyEventOutcome = 'ok' | 'rejected' | 'failed';

/** Last few characters only — enough to spot a stale webhook URL, useless as a credential. */
function tokenTail(token: string): string {
  const value = String(token ?? '');
  return value.length <= 6 ? value : `...${value.slice(-6)}`;
}

export function describeRequest(req: {
  method: string;
  originalUrl?: string;
  query?: unknown;
  body?: unknown;
  headers?: Record<string, unknown>;
  params?: { token?: string };
}): Prisma.InputJsonValue {
  return {
    method: req.method,
    path: String(req.originalUrl ?? '').split('?')[0],
    tokenTail: tokenTail(String(req.params?.token ?? '')),
    query: (req.query ?? {}) as Prisma.InputJsonValue,
    body: (req.body ?? {}) as Prisma.InputJsonValue,
    contentType: String(req.headers?.['content-type'] ?? ''),
  } as Prisma.InputJsonValue;
}

export async function logTelephonyEvent(input: {
  kind: TelephonyEventKind;
  outcome: TelephonyEventOutcome;
  request: Prisma.InputJsonValue;
  response?: unknown;
  errorMessage?: string;
  callLogId?: string | null;
}): Promise<void> {
  try {
    await prisma.telephonyEvent.create({
      data: {
        kind: input.kind,
        outcome: input.outcome,
        request: input.request,
        response: (input.response ?? undefined) as Prisma.InputJsonValue | undefined,
        errorMessage: input.errorMessage,
        callLogId: input.callLogId ?? null,
      },
    });
    // Cheap to run on every write at this volume, and it keeps the table from becoming a
    // second, unbounded copy of the call history.
    await prisma.telephonyEvent.deleteMany({
      where: { receivedAt: { lt: new Date(Date.now() - RETENTION_DAYS * 86_400_000) } },
    });
  } catch (err) {
    console.error('[airphone] could not record the webhook event:', err);
  }
}
