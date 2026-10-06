import { PrismaClient } from '@prisma/client';
import { MAX_CHANGES, currentStore, type FieldChange } from './services/requestContext';

const base = new PrismaClient();

/**
 * The shared Prisma client, with one addition: updates and deletes on the models below record what
 * changed (field, old value, new value) against the current request, so the Audit Log can show
 * "Status: pending -> booked" rather than only "Updated booking". Outside a request (the
 * pollers, the seed) nothing is recorded. Reads and writes go to the same database as before.
 */
const TRACKED = new Set([
  'Lead', 'Booking', 'PropertyUnit', 'Project', 'PaymentMilestone', 'Registry', 'LegalFile', 'ProjectApproval', 'LandRecord',
  'SalesPolicy', 'BookingCancellation', 'SiteVisit', 'Task', 'Vendor', 'WorkOrder', 'VendorBill', 'User',
]);
const IGNORED_FIELDS = new Set(['updatedAt', 'createdAt']);
// Never copy secrets into a log that more people can read than can read the secret.
const SENSITIVE = /password|secret|token|hash|recovery|apikey|fcm|otp/i;

const lower = (m: string) => m[0].toLowerCase() + m.slice(1);
const delegate = (model: string) => (base as unknown as Record<string, { findUnique: (a: unknown) => Promise<Record<string, unknown> | null>; findMany: (a: unknown) => Promise<Record<string, unknown>[]> }>)[lower(model)];

function show(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const text = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

function diff(model: string, before: Record<string, unknown>, after: Record<string, unknown>): FieldChange[] {
  const out: FieldChange[] = [];
  for (const field of Object.keys(after)) {
    if (IGNORED_FIELDS.has(field) || SENSITIVE.test(field)) continue;
    const a = show(before[field]);
    const b = show(after[field]);
    if (a !== b) out.push({ model, id: String(after.id ?? before.id ?? ''), field, from: a, to: b });
  }
  return out;
}

function record(changes: FieldChange[]) {
  const store = currentStore();
  if (!store || changes.length === 0) return;
  for (const c of changes) if (store.changes.length < MAX_CHANGES) store.changes.push(c);
}

// Typed as the plain client on purpose: the layer only observes, so every signature elsewhere
// (including functions that take a transaction client) stays exactly as it was.
export const prisma = base.$extends({
  name: 'audit-changes',
  query: {
    $allModels: {
      async update({ model, args, query }) {
        if (!TRACKED.has(model) || !currentStore()) return query(args);
        const d = delegate(model);
        const before = await d.findUnique({ where: (args as { where: unknown }).where });
        const result = await query(args);
        if (before) {
          const after = await d.findUnique({ where: (args as { where: unknown }).where });
          if (after) record(diff(model, before, after));
        }
        return result;
      },
      async updateMany({ model, args, query }) {
        if (!TRACKED.has(model) || !currentStore()) return query(args);
        const d = delegate(model);
        // A bulk edit records each row's change, up to a small cap; beyond it the entry just says how many.
        const rows = await d.findMany({ where: (args as { where?: unknown }).where, take: 51 });
        const result = await query(args);
        if (rows.length > 0 && rows.length <= 50) {
          const after = await d.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
          const byId = new Map(after.map((r) => [String(r.id), r]));
          for (const r of rows) {
            const a = byId.get(String(r.id));
            if (a) record(diff(model, r, a));
          }
        } else if (rows.length > 50) {
          record([{ model, id: '*', field: '(bulk)', from: null, to: 'more than 50 records changed' }]);
        }
        return result;
      },
      async delete({ model, args, query }) {
        if (!TRACKED.has(model) || !currentStore()) return query(args);
        const before = await delegate(model).findUnique({ where: (args as { where: unknown }).where });
        const result = await query(args);
        if (before) record([{ model, id: String(before.id ?? ''), field: '(deleted)', from: show(before.id), to: null }]);
        return result;
      },
    },
  },
}) as unknown as PrismaClient;
