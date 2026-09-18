import type { NextFunction, Response } from 'express';
import { prisma } from '../prisma';
import type { AuthedRequest } from './auth';
import { moduleForPath } from './permissions';

/**
 * Every admin mutation writes one AuditEntry. Replaces the frontend's in-memory audit
 * array, so the Audit Log survives a reload and reflects what really happened.
 *
 * Deliberately fire-and-forget: an audit-write failure must never fail the action the
 * admin actually asked for, so the error is logged and swallowed.
 */
export interface AuditInput {
  module: string;
  action: string;
  recordId: string;
  recordLabel: string;
  description?: string;
}

export async function writeAudit(req: AuthedRequest, input: AuditInput): Promise<void> {
  // Tells the catch-all middleware that this request already has a hand-written entry, which
  // names the record and what changed far better than a path ever could.
  (req as AuditedRequest).auditWritten = true;
  try {
    const actor = req.auth
      ? await prisma.user.findUnique({ where: { id: req.auth.sub }, select: { id: true, name: true } })
      : null;
    await prisma.auditEntry.create({
      data: {
        userId: actor?.id ?? 'system',
        userName: actor?.name ?? 'System',
        module: input.module,
        action: input.action,
        recordId: input.recordId,
        recordLabel: input.recordLabel,
        description: input.description ?? input.action,
      },
    });
  } catch (err) {
    console.error('[audit] failed to write entry', err);
  }
}


// ---------------------------------------------------------------------------
// The catch-all
//
// Hand-written `writeAudit` calls covered maybe a third of the panel's mutations: leads, the
// pipelines, automations, forms and the sequences wrote nothing at all, and every new route
// started life unaudited until somebody remembered. Recording at the edge inverts that — an
// action is logged unless a handler has already described it better.
// ---------------------------------------------------------------------------

interface AuditedRequest extends AuthedRequest {
  auditWritten?: boolean;
}

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Paths whose mutations are not somebody's doing, or are too noisy to be worth a row. */
const SKIP = [/^\/auth\/login$/, /^\/auth\/2fa\/verify$/, /^\/webhook(\/|$)/, /^\/health$/];

/** Past tense for what happened, present for what was only tried. */
const VERB: Record<string, { did: string; tried: string }> = {
  POST: { did: 'Created', tried: 'create' },
  PUT: { did: 'Replaced', tried: 'replace' },
  PATCH: { did: 'Updated', tried: 'update' },
  DELETE: { did: 'Deleted', tried: 'delete' },
};

/**
 * "/leads/abc123/notes" -> "lead note". The id segments are dropped and what is left reads as
 * the thing acted on, which is what someone scanning the log is looking for.
 */
function subjectOf(path: string): string {
  const words = path
    .split('/')
    .filter(Boolean)
    // cuids, numeric ids and the `default` singleton are identifiers, not nouns.
    .filter((part) => part !== 'default' && !ID_SEGMENT.test(part))
    .map((part) => part.replace(/-/g, ' ').split(' ').map(singular).join(' '));

  const subject = words.slice(-2).join(' ').trim();
  return subject || 'record';
}

const ID_SEGMENT = /^(c[a-z0-9]{20,}|\d+|[0-9a-f-]{20,})$/i;

/** "leads" -> "lead", so the log reads "Created lead" rather than "Created leads". */
function singular(word: string): string {
  if (/(ss|us|is|as)$/i.test(word)) return word;
  if (/ies$/i.test(word)) return `${word.slice(0, -3)}y`;
  return word.endsWith('s') ? word.slice(0, -1) : word;
}

/** The record a path acts on — the last segment that looks like an identifier. */
function idInPath(path: string): string | undefined {
  return path.split('/').filter((part) => ID_SEGMENT.test(part)).pop();
}

/** The most human thing in whatever the handler sent back. */
function labelOf(payload: unknown, fallback: string): string {
  const body = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const named = ['name', 'label', 'title', 'templateName', 'subject'].map((key) => body[key]).find((v) => typeof v === 'string' && v);
  if (named) return String(named);
  if (typeof body.firstName === 'string') return `${body.firstName} ${body.lastName ?? ''}`.trim();
  return fallback;
}

/**
 * Records every mutation a signed-in panel user makes. Mounted after the admin guard, so
 * `req.auth` is already resolved and partner-app traffic never reaches it.
 */
export function auditMutations(req: AuditedRequest, res: Response, next: NextFunction) {
  if (!MUTATING.has(req.method) || SKIP.some((pattern) => pattern.test(req.path))) return next();

  // Read now, not in the finish handler: Express rewrites req.url as a request passes through
  // each mounted router, so by the time the response ends the path is no longer this one.
  const path = req.path;
  const method = req.method;
  const url = req.originalUrl.split('?')[0];

  // The response body is the only place a newly created record's id and name exist, so it is
  // captured on the way out rather than guessed at from the request.
  let payload: unknown;
  const sendJson = res.json.bind(res);
  res.json = (body: unknown) => {
    payload = body;
    return sendJson(body);
  };

  res.on('finish', () => {
    // A handler that described the change itself has already written a better row.
    if (req.auditWritten || !req.auth) return;

    const body = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
    // Route params are not populated this far out, so the id is read off the path itself and
    // only then from whatever the handler returned.
    const recordId = String(idInPath(path) ?? body.id ?? '');
    const subject = subjectOf(path);
    const denied = res.statusCode >= 400;

    void writeAudit(req, {
      module: moduleForPath(path) ?? subject,
      // A refused action is still something a person tried, and on a panel with roles that is
      // exactly what an audit log is for.
      action: denied
        ? `Attempted to ${VERB[method]?.tried ?? method.toLowerCase()} ${subject}`
        : `${VERB[method]?.did ?? method} ${subject}`,
      recordId: recordId || subject,
      recordLabel: labelOf(payload, recordId || subject),
      description: `${method} ${url}${denied ? ` — refused with ${res.statusCode}` : ''}`,
    });
  });

  return next();
}
