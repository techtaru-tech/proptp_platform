import type { OpsRule } from '@prisma/client';
import { prisma } from '../prisma';
import { getPolicy } from './salesPolicy';
import { activityProgress } from './construction';
import { complianceStatus, currentStage, generateDocument, milestoneState, openLegalFileFor } from './legal';
import { notify } from './notify';
import { sendRawEmail } from './email';
import { sendTemplateToNumber } from './whatsapp';
import { sendSms } from './sms';

/**
 * Operations rules: the PDF's "when this happens, the system does this" table, with nothing fixed
 * in code. A rule is a trigger plus timed steps an admin sets up; this file knows how to find the
 * subjects a trigger applies to, and how to carry out each kind of action.
 *
 * How it stays safe:
 *  - A rule only acts on conditions from the moment it was switched on (`enabledAt`), so turning
 *    one on never fires for the backlog.
 *  - Every action is claimed by inserting its OpsRuleFire row first. The unique key
 *    (rule, subject, step, occurrence) means two overlapping ticks cannot both do it.
 *  - An action that cannot be carried out (WhatsApp not connected, nobody to notify) is recorded
 *    as skipped with the reason, never silently dropped.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type ActionKind = 'notify' | 'create_task' | 'generate_demand_note' | 'create_payment_schedule' | 'release_hold' | 'close_file_mark_sold';
export const CHANNELS = ['in_app', 'email', 'whatsapp', 'sms'] as const;
export type Channel = (typeof CHANNELS)[number];

export interface Step {
  /** Hours after the condition began (or the rule was switched on, if later). */
  delayHours: number;
  /** Repeat the step at this interval for as long as the condition holds. */
  repeatEveryHours?: number;
  action: {
    kind: ActionKind;
    /** `owner`, `owner_manager`, `buyer`, `user:<id>`, `module:<key>`. */
    recipients?: string[];
    channel?: Channel;
    title?: string;
    message?: string;
    /** WhatsApp needs an approved template: its name, language and which values fill its slots in order. */
    templateName?: string;
    templateLanguage?: string;
    templateParams?: string[];
    dueInHours?: number;
    schedule?: { name: string; percent: number; offsetDays: number }[];
  };
}

export interface Subject {
  /** Stable identity of the thing, so a step is recorded once for it. */
  key: string;
  label: string;
  since: Date;
  values: Record<string, string>;
  ownerUserId?: string | null;
  buyer?: { name: string; phone: string };
  refs: { bookingId?: string; fileId?: string; milestoneId?: string; holdId?: string; unitId?: string };
}

export interface TriggerDef {
  key: string;
  label: string;
  description: string;
  placeholders: string[];
  params: { key: string; label: string; default: number; unit: string }[];
  actions: ActionKind[];
  /** Whether the subject has a buyer to write to. */
  hasBuyer: boolean;
  /** Whether the subject has one responsible person (`owner`). */
  hasOwner: boolean;
  /**
   * An event (a booking confirmed, a registry completed) happens once, so a rule acts only on
   * ones after it was switched on — otherwise enabling it would close every file ever registered.
   * A state (overdue, no update, hold expired) is ongoing, so a rule applies to what is true now.
   */
  event?: boolean;
  scan: (config: Record<string, number>) => Promise<Subject[]>;
}

const DAY = 86_400_000;
const inr = (n: number) => `Rs. ${n.toLocaleString('en-IN')}`;
const fmt = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const num = (c: Record<string, number>, k: string, d: number) => (Number.isFinite(Number(c?.[k])) ? Number(c[k]) : d);

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ---------------------------------------------------------------------------
// Triggers — each finds the subjects it applies to right now
// ---------------------------------------------------------------------------

async function milestoneSubjects(
  include: (m: { dueOn: Date; amount: number; payments: { amount: number }[] }, s: ReturnType<typeof milestoneState>) => boolean,
  sinceOf: (m: { dueOn: Date }) => Date
): Promise<Subject[]> {
  const rows = await prisma.paymentMilestone.findMany({
    where: { file: { closedAt: null } },
    include: { payments: true, file: { include: { project: { select: { projectName: true } }, booking: { include: { unit: { select: { propertyNumber: true } } } } } } },
  });
  const out: Subject[] = [];
  for (const m of rows) {
    const s = milestoneState(m);
    if (!include(m, s)) continue;
    out.push({
      key: `milestone:${m.id}`, label: `${m.file.buyerName} · ${m.name}`, since: sinceOf(m),
      values: { buyer: m.file.buyerName, unit: m.file.booking.unit.propertyNumber, project: m.file.project.projectName, milestone: m.name, amount: inr(s.outstanding), due: fmt(m.dueOn), days: String(s.daysOverdue) },
      buyer: { name: m.file.buyerName, phone: m.file.phone }, refs: { fileId: m.fileId, milestoneId: m.id, bookingId: m.file.bookingId },
    });
  }
  return out;
}

const TRIGGERS: TriggerDef[] = [
  {
    key: 'booking_confirmed', label: 'A booking is confirmed',
    description: 'Opens the buyer’s legal file (always), can set up the payment schedule, and tells the legal team. The plot already shows as booked on the map.',
    placeholders: ['buyer', 'unit', 'project', 'amount'], params: [], actions: ['notify', 'create_task', 'create_payment_schedule'], hasBuyer: true, hasOwner: false, event: true,
    async scan() {
      const rows = await prisma.booking.findMany({
        where: { isDeposit: 0, status: { in: ['booked', 'partPaid'] }, updatedAt: { gte: new Date(Date.now() - 30 * DAY) } },
        include: { unit: { include: { project: true } }, legalFile: { select: { id: true } } },
      });
      return rows.map((b) => ({
        key: `booking:${b.id}`, label: `${b.bookingName} · ${b.unit.propertyNumber}`, since: b.updatedAt,
        values: { buyer: b.bookingName, unit: b.unit.propertyNumber, project: b.unit.project.projectName, amount: inr(b.amount) },
        buyer: { name: b.bookingName, phone: b.phone }, refs: { bookingId: b.id, fileId: b.legalFile?.id, unitId: b.unit.id },
      }));
    },
  },
  {
    key: 'payment_due', label: 'A payment is falling due',
    description: 'A milestone with money still outstanding is due within the lead time you set (0 = due today).',
    placeholders: ['buyer', 'unit', 'project', 'milestone', 'amount', 'due'], params: [{ key: 'leadDays', label: 'Act this many days before the due date', default: 0, unit: 'days' }],
    actions: ['notify', 'create_task', 'generate_demand_note'], hasBuyer: true, hasOwner: false,
    async scan(c) {
      const lead = num(c, 'leadDays', 0);
      return milestoneSubjects(
        (m, s) => s.status !== 'paid' && m.dueOn.getTime() >= startOfToday() && m.dueOn.getTime() < startOfToday() + (lead + 1) * DAY,
        (m) => new Date(m.dueOn.getTime() - lead * DAY)
      );
    },
  },
  {
    key: 'payment_overdue', label: 'A payment goes overdue',
    description: 'A milestone is past its due date with money still outstanding. Steps count from the day after it fell due — use them to demand, remind, then escalate.',
    placeholders: ['buyer', 'unit', 'project', 'milestone', 'amount', 'due', 'days'], params: [],
    actions: ['notify', 'create_task', 'generate_demand_note'], hasBuyer: true, hasOwner: false,
    async scan() {
      return milestoneSubjects((_m, s) => s.status === 'overdue', (m) => new Date(m.dueOn.getTime() + DAY));
    },
  },
  {
    key: 'update_missing', label: 'A daily site update is not posted',
    description: 'Someone who owns work in progress has not posted an update for longer than the grace period.',
    placeholders: ['owner', 'activity', 'project', 'days'], params: [{ key: 'graceDays', label: 'Grace period before it counts as missing', default: 1, unit: 'days' }],
    actions: ['notify', 'create_task'], hasBuyer: false, hasOwner: true,
    async scan(c) {
      const grace = num(c, 'graceDays', 1);
      const acts = await prisma.constructionActivity.findMany({
        where: { assigneeId: { not: null }, plannedStart: { lte: new Date() } },
        include: { project: { select: { projectName: true } }, assignee: { select: { name: true } }, updates: { select: { capturedAt: true, status: true, percentComplete: true } } },
      });
      const now = Date.now();
      const out: Subject[] = [];
      for (const a of acts) {
        if (a.updates.some((u) => u.status === 'approved' && u.percentComplete >= 100) || a.plannedEnd.getTime() < now - 14 * DAY) continue;
        const last = Math.max(a.plannedStart.getTime(), ...a.updates.map((u) => u.capturedAt.getTime()));
        const since = new Date(last + grace * DAY);
        if (since.getTime() > now) continue;
        out.push({
          key: `activity:${a.id}:${last}`, label: `${a.name} · ${a.assignee?.name}`, since, ownerUserId: a.assigneeId,
          values: { owner: a.assignee?.name ?? '', activity: a.name, project: a.project.projectName, days: String(Math.floor((now - last) / DAY)) }, refs: {},
        });
      }
      return out;
    },
  },
  {
    key: 'material_unverified', label: 'Material is entered and not yet verified',
    description: 'A received-material entry is waiting for a site engineer to verify or reject it. Use a repeating step to remind until it is done.',
    placeholders: ['material', 'quantity', 'project', 'vendor', 'challan', 'hours'], params: [], actions: ['notify', 'create_task'], hasBuyer: false, hasOwner: false,
    async scan() {
      const rows = await prisma.materialEntry.findMany({ where: { status: 'pending' }, include: { material: true, project: { select: { projectName: true } }, vendor: { select: { name: true } } } });
      return rows.map((e) => ({
        key: `material:${e.id}`, label: `${e.quantity} ${e.material.unit} ${e.material.name} · ${e.challanNo}`, since: e.createdAt,
        values: { material: e.material.name, quantity: `${e.quantity} ${e.material.unit}`, project: e.project.projectName, vendor: e.vendor?.name ?? 'a vendor', challan: e.challanNo, hours: String(Math.floor((Date.now() - e.createdAt.getTime()) / 3_600_000)) }, refs: {},
      }));
    },
  },
  {
    key: 'milestone_slipping', label: 'A milestone starts slipping',
    description: 'Construction work is running behind its plan by at least the number of days you set.',
    placeholders: ['activity', 'project', 'days', 'owner'], params: [{ key: 'minDaysBehind', label: 'Flag when behind by at least', default: 3, unit: 'days' }],
    actions: ['notify', 'create_task'], hasBuyer: false, hasOwner: true,
    async scan(c) {
      const min = num(c, 'minDaysBehind', 3);
      const acts = await prisma.constructionActivity.findMany({ include: { project: { select: { projectName: true } }, assignee: { select: { name: true } }, updates: { select: { status: true, percentComplete: true, capturedAt: true } } } });
      const out: Subject[] = [];
      for (const a of acts) {
        const p = activityProgress(a);
        if (p.actual >= 100 || p.daysBehind < min) continue;
        out.push({
          // The start of the slip is not recorded, so it counts from when the rule noticed it.
          key: `slip:${a.id}`, label: `${a.name} (${p.daysBehind}d behind)`, since: new Date(0), ownerUserId: a.assigneeId,
          values: { activity: a.name, project: a.project.projectName, days: String(p.daysBehind), owner: a.assignee?.name ?? 'unassigned' }, refs: {},
        });
      }
      return out;
    },
  },
  {
    key: 'agreement_pending', label: 'An agreement is pending signature',
    description: 'The agreement has been sent or is under review and has not moved on. Steps count from when it reached that stage — add several for staged reminders.',
    placeholders: ['buyer', 'unit', 'project', 'stage', 'days'], params: [], actions: ['notify', 'create_task'], hasBuyer: true, hasOwner: false,
    async scan() {
      const files = await prisma.legalFile.findMany({ where: { closedAt: null }, include: { stages: true, project: { select: { projectName: true } }, booking: { include: { unit: { select: { propertyNumber: true } } } } } });
      const out: Subject[] = [];
      for (const f of files) {
        const stage = currentStage(f.stages);
        if (stage !== 'sent' && stage !== 'under_review') continue;
        const at = f.stages.find((s) => s.stage === stage)!.at;
        out.push({
          key: `agreement:${f.id}:${stage}`, label: `${f.buyerName} · ${stage.replace('_', ' ')}`, since: at,
          values: { buyer: f.buyerName, unit: f.booking.unit.propertyNumber, project: f.project.projectName, stage: stage.replace('_', ' '), days: String(Math.floor((Date.now() - at.getTime()) / DAY)) },
          buyer: { name: f.buyerName, phone: f.phone }, refs: { fileId: f.id },
        });
      }
      return out;
    },
  },
  {
    key: 'approval_expiring', label: 'An approval or document nears expiry',
    description: 'Fires at each of the lead times you list (default 90, 60 and 30 days before it lapses).',
    placeholders: ['item', 'subject', 'reference', 'valid_until', 'days_left'],
    params: [{ key: 'band1', label: 'First alert', default: 90, unit: 'days before' }, { key: 'band2', label: 'Second alert', default: 60, unit: 'days before' }, { key: 'band3', label: 'Final alert', default: 30, unit: 'days before' }],
    actions: ['notify', 'create_task'], hasBuyer: false, hasOwner: false,
    async scan(c) {
      const bands = [num(c, 'band1', 90), num(c, 'band2', 60), num(c, 'band3', 30)];
      const [approvals, docs] = await Promise.all([
        prisma.projectApproval.findMany({ where: { validUntil: { not: null } }, include: { project: { select: { projectName: true } } } }),
        prisma.vendorDocument.findMany({ where: { expiresAt: { not: null } }, include: { vendor: { select: { name: true } } } }),
      ]);
      const items = [
        ...approvals.map((a) => ({ id: `approval:${a.id}`, item: a.kind, subject: a.project.projectName, ref: a.referenceNo, until: a.validUntil! })),
        ...docs.map((d) => ({ id: `vdoc:${d.id}`, item: d.title, subject: d.vendor.name, ref: '—', until: d.expiresAt! })),
      ];
      const out: Subject[] = [];
      for (const it of items) {
        const { daysLeft, status } = complianceStatus(it.until);
        if (status === 'lapsed' || daysLeft === null) continue;
        // The tightest band it has entered: 25 days left is the 30-day alert, not the 90.
        const entered = bands.filter((b) => daysLeft <= b).sort((a, b) => a - b)[0];
        if (entered === undefined) continue;
        out.push({
          key: `${it.id}:${entered}`, label: `${it.item} · ${it.subject} (${entered}-day alert)`, since: new Date(it.until.getTime() - entered * DAY),
          values: { item: it.item, subject: it.subject, reference: it.ref, valid_until: fmt(it.until), days_left: String(daysLeft) }, refs: {},
        });
      }
      return out;
    },
  },
  {
    key: 'hold_expired', label: 'A held plot crosses its hold period',
    description: 'A hold has run out. Release puts the plot back to available; notify tells the executive who placed it.',
    placeholders: ['unit', 'project', 'executive'], params: [], actions: ['release_hold', 'notify', 'create_task'], hasBuyer: false, hasOwner: true,
    async scan() {
      const holds = await prisma.plotHold.findMany({ where: { status: 1, holdEnd: { lt: new Date() } }, include: { unit: { include: { project: { select: { projectName: true } } } }, user: { select: { id: true, name: true } } } });
      return holds.map((h) => ({
        key: `hold:${h.id}`, label: `${h.unit.propertyNumber} · ${h.unit.project.projectName}`, since: h.holdEnd, ownerUserId: h.userId,
        values: { unit: h.unit.propertyNumber, project: h.unit.project.projectName, executive: h.user?.name ?? 'the executive' }, refs: { holdId: h.id, unitId: h.unitId },
      }));
    },
  },
  {
    key: 'registry_completed', label: 'Registry is completed',
    description: 'The unit is registered. Closes the buyer’s file, marks the plot sold, and can send the buyer a completion message.',
    placeholders: ['buyer', 'unit', 'project', 'deed'], params: [], actions: ['close_file_mark_sold', 'notify', 'create_task'], hasBuyer: true, hasOwner: false, event: true,
    async scan() {
      const regs = await prisma.registry.findMany({ where: { status: 'registered' }, include: { file: { include: { project: { select: { projectName: true } }, booking: { include: { unit: { select: { propertyNumber: true } } } } } } } });
      return regs.map((r) => ({
        key: `registry:${r.fileId}`, label: `${r.file.buyerName} · ${r.file.booking.unit.propertyNumber}`, since: r.registryDate ?? r.updatedAt,
        values: { buyer: r.file.buyerName, unit: r.file.booking.unit.propertyNumber, project: r.file.project.projectName, deed: r.deedNumber ?? '' },
        buyer: { name: r.file.buyerName, phone: r.file.phone }, refs: { fileId: r.fileId, unitId: r.file.unitId },
      }));
    },
  },
  {
    key: 'loan_stalled', label: 'A bank loan is waiting on the bank',
    description: 'The loan is applied for and not yet sanctioned, or sanctioned and not yet fully paid out. Steps count from the application, or from the last sanction or payout.',
    placeholders: ['buyer', 'unit', 'project', 'bank', 'stage', 'days'], params: [], actions: ['notify', 'create_task'], hasBuyer: true, hasOwner: false,
    async scan() {
      const loans = await prisma.bankLoan.findMany({ where: { status: { in: ['applied', 'sanctioned'] } }, include: { disbursements: true, file: { include: { project: { select: { projectName: true } }, booking: { include: { unit: { select: { propertyNumber: true } } } } } } } });
      const out: Subject[] = [];
      for (const l of loans) {
        const paid = l.disbursements.reduce((n, d) => n + d.amount, 0);
        if (l.status === 'sanctioned' && paid >= (l.sanctionedAmount ?? 0)) continue;
        const last = l.disbursements.reduce((m, d) => (d.paidOn > m ? d.paidOn : m), l.sanctionedOn ?? l.appliedOn);
        const since = l.status === 'applied' ? l.appliedOn : last;
        const stage = l.status === 'applied' ? 'application' : 'disbursement';
        out.push({
          key: `loan:${l.id}:${stage}:${since.getTime()}`, label: `${l.file.buyerName} · ${l.bankName} ${stage}`, since,
          values: { buyer: l.file.buyerName, unit: l.file.booking.unit.propertyNumber, project: l.file.project.projectName, bank: l.bankName, stage, days: String(Math.floor((Date.now() - since.getTime()) / DAY)) },
          buyer: { name: l.file.buyerName, phone: l.file.phone }, refs: { fileId: l.fileId },
        });
      }
      return out;
    },
  },
  {
    key: 'documents_outstanding', label: 'A buyer’s required documents are not all verified',
    description: 'The file is open and a document on the required list (Settings > Sales policy) is missing, waiting for review, or was rejected. Steps count from when the file opened.',
    placeholders: ['buyer', 'unit', 'project', 'documents', 'days'], params: [], actions: ['notify', 'create_task'], hasBuyer: true, hasOwner: false,
    async scan() {
      const policy = await getPolicy();
      if (policy.requiredDocKinds.length === 0) return [];
      const files = await prisma.legalFile.findMany({ where: { closedAt: null }, include: { documents: { select: { kind: true, status: true, supersededAt: true } }, project: { select: { projectName: true } }, booking: { include: { unit: { select: { propertyNumber: true } } } } } });
      const out: Subject[] = [];
      for (const f of files) {
        const outstanding = policy.requiredDocKinds.filter((k) => !f.documents.some((d) => d.kind === k && d.status === 'verified' && !d.supersededAt));
        if (outstanding.length === 0) continue;
        out.push({
          key: `docs:${f.id}`, label: `${f.buyerName} · ${outstanding.length} document${outstanding.length === 1 ? '' : 's'}`, since: f.openedAt,
          values: { buyer: f.buyerName, unit: f.booking.unit.propertyNumber, project: f.project.projectName, documents: outstanding.map((k) => k.replace(/_/g, ' ')).join(', '), days: String(Math.floor((Date.now() - f.openedAt.getTime()) / DAY)) },
          buyer: { name: f.buyerName, phone: f.phone }, refs: { fileId: f.id },
        });
      }
      return out;
    },
  },
  {
    key: 'possession_pending', label: 'A registered plot has not been handed over',
    description: 'The unit is registered and possession has not been recorded. Steps count from the registry date.',
    placeholders: ['buyer', 'unit', 'project', 'days'], params: [], actions: ['notify', 'create_task'], hasBuyer: true, hasOwner: false,
    async scan() {
      const regs = await prisma.registry.findMany({ where: { status: 'registered', possessionOn: null }, include: { file: { include: { project: { select: { projectName: true } }, booking: { include: { unit: { select: { propertyNumber: true } } } } } } } });
      return regs.map((r) => {
        const since = r.registryDate ?? r.updatedAt;
        return {
          key: `possession:${r.fileId}`, label: `${r.file.buyerName} · ${r.file.booking.unit.propertyNumber}`, since,
          values: { buyer: r.file.buyerName, unit: r.file.booking.unit.propertyNumber, project: r.file.project.projectName, days: String(Math.floor((Date.now() - since.getTime()) / DAY)) },
          buyer: { name: r.file.buyerName, phone: r.file.phone }, refs: { fileId: r.fileId },
        };
      });
    },
  },
];

export const TRIGGER_CATALOGUE = TRIGGERS.map(({ scan: _scan, ...t }) => t);
export const triggerByKey = (key: string) => TRIGGERS.find((t) => t.key === key);

// ---------------------------------------------------------------------------
// Validation — an admin's rule is checked before it can be saved
// ---------------------------------------------------------------------------

const KNOWN_RECIPIENT = /^(owner|owner_manager|buyer|user:[\w-]+|module:[a-z_]+)$/;

function placeholdersIn(text: string) {
  return [...new Set([...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]))];
}
function render(text: string, values: Record<string, string>) {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, k: string) => values[k] ?? '');
}

export function validateRule(trigger: string, steps: unknown): string | null {
  const def = triggerByKey(trigger);
  if (!def) return 'Unknown trigger.';
  if (!Array.isArray(steps) || steps.length === 0) return 'Add at least one step.';
  if (steps.length > 8) return 'A rule can have at most 8 steps.';
  for (const [i, raw] of steps.entries()) {
    const st = raw as Step;
    const n = `Step ${i + 1}`;
    if (!Number.isFinite(Number(st?.delayHours)) || Number(st.delayHours) < 0) return `${n}: the delay must be zero or more hours.`;
    if (st.repeatEveryHours !== undefined && st.repeatEveryHours !== null && !(Number(st.repeatEveryHours) >= 1)) return `${n}: repeat at least 1 hour apart.`;
    const a = st.action;
    if (!a || !def.actions.includes(a.kind)) return `${n}: “${a?.kind ?? 'nothing'}” is not available for this trigger.`;
    if (a.kind === 'notify' || a.kind === 'create_task') {
      if (!a.recipients?.length) return `${n}: choose who it goes to.`;
      for (const r of a.recipients) {
        if (!KNOWN_RECIPIENT.test(r)) return `${n}: unknown recipient “${r}”.`;
        if (r === 'buyer' && !def.hasBuyer) return `${n}: this trigger has no buyer to write to.`;
        if (r.startsWith('owner') && !def.hasOwner) return `${n}: this trigger has no single responsible person; name people or a module instead.`;
        if (r === 'buyer' && a.kind === 'create_task') return `${n}: a task cannot be given to a buyer.`;
      }
      if (a.kind === 'notify') {
        if (a.channel && !CHANNELS.includes(a.channel)) return `${n}: unknown channel.`;
        if (a.channel === 'whatsapp' && !a.templateName) return `${n}: WhatsApp needs an approved template name.`;
        if (a.channel === 'sms' && !a.templateName) return `${n}: SMS needs the name of an approved DLT template.`;
        if (a.recipients.includes('buyer') && (a.channel ?? 'in_app') === 'in_app') return `${n}: a buyer has no app login — pick email, SMS or WhatsApp for them.`;
      }
      if (!String(a.message ?? '').trim()) return `${n}: write the message.`;
      const bad = placeholdersIn(`${a.title ?? ''} ${a.message ?? ''}`).filter((p) => !def.placeholders.includes(p));
      if (bad.length) return `${n}: ${bad.map((b) => `{{${b}}}`).join(', ')} is not available for this trigger. Use: ${def.placeholders.map((p) => `{{${p}}}`).join(', ')}.`;
      if (a.templateParams?.some((p) => !def.placeholders.includes(p))) return `${n}: a WhatsApp template value is not available for this trigger.`;
    }
    if (a.kind === 'create_payment_schedule') {
      const sch = a.schedule ?? [];
      if (sch.length === 0 || sch.some((m) => !m.name?.trim() || !(Number(m.percent) > 0) || !(Number(m.offsetDays) >= 0))) return `${n}: every schedule row needs a name, a percentage and a day offset.`;
      if (Math.round(sch.reduce((s, m) => s + Number(m.percent), 0) * 100) !== 10000) return `${n}: the schedule percentages must add up to 100.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Recipients and actions
// ---------------------------------------------------------------------------

async function resolveUsers(tokens: string[], subject: Subject) {
  const ids = new Set<string>();
  for (const t of tokens) {
    if (t === 'owner' && subject.ownerUserId) ids.add(subject.ownerUserId);
    else if (t === 'owner_manager' && subject.ownerUserId) {
      const o = await prisma.user.findUnique({ where: { id: subject.ownerUserId }, select: { reportingLeaderId: true } });
      if (o?.reportingLeaderId) ids.add(o.reportingLeaderId);
    } else if (t.startsWith('user:')) ids.add(t.slice(5));
    else if (t.startsWith('module:')) {
      const key = t.slice(7);
      const users = await prisma.user.findMany({
        where: { status: 'active', role: { not: 'vendor' }, OR: [{ role: 'admin', panelRoleId: null }, { panelRole: { isFullAccess: true } }, { panelRole: { modules: { array_contains: key } } }] },
        select: { id: true },
      });
      users.forEach((u) => ids.add(u.id));
    }
  }
  return prisma.user.findMany({ where: { id: { in: [...ids] }, status: 'active' }, select: { id: true, name: true, email: true, phone: true } });
}

export interface Outcome {
  status: 'sent' | 'skipped' | 'failed';
  detail: string;
}

async function systemUserId() {
  return (await prisma.user.findFirst({ where: { role: 'admin', status: 'active' }, orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id ?? null;
}

async function execute(rule: OpsRule, step: Step, subject: Subject): Promise<Outcome> {
  const a = step.action;
  const title = render(a.title || rule.name, subject.values);
  const message = render(a.message ?? '', subject.values);

  switch (a.kind) {
    case 'notify': {
      const channel = a.channel ?? 'in_app';
      const notes: string[] = [];
      let delivered = 0;
      const toBuyer = a.recipients?.includes('buyer');
      const users = await resolveUsers((a.recipients ?? []).filter((r) => r !== 'buyer'), subject);

      if (channel === 'in_app') {
        if (users.length) {
          await notify({ title, body: message, userIds: users.map((u) => u.id), type: 'system', data: { kind: 'ops_rule', rule: rule.id } });
          delivered += users.length;
        }
      } else if (channel === 'email') {
        for (const u of users) {
          if (!u.email) { notes.push(`${u.name}: no email`); continue; }
          try { await sendRawEmail(u.email, title, `<p>${message.replace(/\n/g, '<br>')}</p>`); delivered += 1; } catch (e) { notes.push(`${u.name}: ${(e as Error).message}`); }
        }
        if (toBuyer) notes.push('buyer: no email address on record');
      } else if (channel === 'sms') {
        const targets = [...users.map((u) => ({ name: u.name, phone: u.phone })), ...(toBuyer && subject.buyer ? [{ name: subject.buyer.name, phone: subject.buyer.phone }] : [])];
        const params = (a.templateParams ?? []).map((p) => subject.values[p] ?? '');
        for (const t of targets) {
          const r = await sendSms({ to: t.phone, templateName: a.templateName!, params });
          if (r.ok) delivered += 1; else notes.push(`${t.name}: ${r.detail}`);
        }
      } else {
        const targets = [...users.map((u) => ({ name: u.name, phone: u.phone })), ...(toBuyer && subject.buyer ? [{ name: subject.buyer.name, phone: subject.buyer.phone }] : [])];
        const account = await prisma.whatsAppAccount.findFirst({ orderBy: { createdAt: 'asc' } });
        if (!account) notes.push('WhatsApp is not connected');
        else {
          const params = (a.templateParams ?? []).map((p) => subject.values[p] ?? '');
          for (const t of targets) {
            try { await sendTemplateToNumber(account, t.phone, { name: a.templateName!, language: a.templateLanguage || 'en', params, body: message }); delivered += 1; }
            catch (e) { notes.push(`${t.name}: ${(e as Error).message}`); }
          }
        }
      }
      if (delivered === 0) return { status: 'skipped', detail: notes.join('; ') || 'Nobody to notify.' };
      return { status: 'sent', detail: `${delivered} notified${notes.length ? `; ${notes.join('; ')}` : ''}` };
    }
    case 'create_task': {
      const users = await resolveUsers(a.recipients ?? [], subject);
      const by = await systemUserId();
      if (!by || users.length === 0) return { status: 'skipped', detail: users.length === 0 ? 'Nobody to assign the task to.' : 'No administrator to raise it as.' };
      for (const u of users) {
        await prisma.task.create({
          data: { title, description: message, assigneeId: u.id, createdById: by, priority: 'high', dueAt: a.dueInHours ? new Date(Date.now() + a.dueInHours * 3_600_000) : null },
        });
      }
      return { status: 'sent', detail: `Task created for ${users.map((u) => u.name).join(', ')}` };
    }
    case 'generate_demand_note': {
      if (!subject.refs.fileId || !subject.refs.milestoneId) return { status: 'skipped', detail: 'No milestone.' };
      const by = await systemUserId();
      if (!by) return { status: 'skipped', detail: 'No administrator to raise it as.' };
      const doc = await generateDocument('demand_note', { fileId: subject.refs.fileId, milestoneId: subject.refs.milestoneId }, by);
      await prisma.paymentMilestone.update({ where: { id: subject.refs.milestoneId }, data: { demandedAt: new Date() } });
      return { status: 'sent', detail: `Demand note “${doc.title}” generated` };
    }
    case 'create_payment_schedule': {
      const opened = subject.refs.fileId ? { id: subject.refs.fileId } : subject.refs.bookingId ? await openLegalFileFor(subject.refs.bookingId) : null;
      const file = opened ? await prisma.legalFile.findUnique({ where: { id: opened.id }, include: { _count: { select: { milestones: true } } } }) : null;
      if (!file) return { status: 'skipped', detail: 'No legal file for this booking yet.' };
      if (file._count.milestones > 0) return { status: 'skipped', detail: 'A payment plan already exists; left alone.' };
      const sch = a.schedule ?? [];
      let left = file.agreedValue;
      const base = Date.now();
      await prisma.paymentMilestone.createMany({
        data: sch.map((m, i) => {
          const amount = i === sch.length - 1 ? left : Math.round((file.agreedValue * Number(m.percent)) / 100);
          left -= amount;
          return { fileId: file.id, name: m.name, amount, dueOn: new Date(base + Number(m.offsetDays) * DAY), sortOrder: i };
        }),
      });
      return { status: 'sent', detail: `${sch.length}-milestone schedule created` };
    }
    case 'release_hold': {
      if (!subject.refs.holdId) return { status: 'skipped', detail: 'No hold.' };
      await prisma.plotHold.update({ where: { id: subject.refs.holdId }, data: { status: 0 } });
      return { status: 'sent', detail: 'Hold released; plot is available again' };
    }
    case 'close_file_mark_sold': {
      if (!subject.refs.fileId) return { status: 'skipped', detail: 'No legal file.' };
      await prisma.$transaction([
        prisma.legalFile.update({ where: { id: subject.refs.fileId }, data: { closedAt: new Date() } }),
        ...(subject.refs.unitId ? [prisma.propertyUnit.update({ where: { id: subject.refs.unitId }, data: { bookingStatus: 2 } })] : []),
      ]);
      return { status: 'sent', detail: 'Buyer file closed; plot marked sold' };
    }
  }
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export interface Due {
  subject: Subject;
  stepIndex: number;
  occurrence: number;
  dueAt: Date;
}

function effectiveSince(rule: OpsRule, subject: Subject) {
  // Never act on a condition older than the rule: it counts from when the rule was switched on.
  return new Date(Math.max(subject.since.getTime(), rule.enabledAt?.getTime() ?? Date.now()));
}

/** What is due right now for a rule, and what comes next — shared by the engine and the preview. */
export async function dueFor(rule: OpsRule) {
  const def = triggerByKey(rule.trigger);
  if (!def) return { subjects: 0, due: [] as Due[], upcoming: [] as { subject: Subject; stepIndex: number; at: Date }[] };
  const scanned = await def.scan((rule.config ?? {}) as Record<string, number>);
  const subjects = def.event ? scanned.filter((s) => s.since.getTime() >= (rule.enabledAt?.getTime() ?? Date.now())) : scanned;
  const steps = (rule.steps ?? []) as unknown as Step[];
  const fired = await prisma.opsRuleFire.findMany({ where: { ruleId: rule.id }, select: { subjectKey: true, stepIndex: true, occurrence: true } });
  const done = new Set(fired.map((f) => `${f.subjectKey}|${f.stepIndex}|${f.occurrence}`));
  const now = Date.now();
  const due: Due[] = [];
  const upcoming: { subject: Subject; stepIndex: number; at: Date }[] = [];
  for (const subject of subjects) {
    if (def.event && subject.since.getTime() < (rule.enabledAt?.getTime() ?? Date.now())) continue;
    const since = effectiveSince(rule, subject).getTime();
    steps.forEach((st, i) => {
      const first = since + Number(st.delayHours) * 3_600_000;
      if (now < first) { upcoming.push({ subject, stepIndex: i, at: new Date(first) }); return; }
      const repeatMs = st.repeatEveryHours ? Number(st.repeatEveryHours) * 3_600_000 : 0;
      // For a repeating step only the current round matters; missed rounds are not replayed.
      const occurrence = repeatMs ? Math.floor((now - first) / repeatMs) : 0;
      if (!done.has(`${subject.key}|${i}|${occurrence}`)) due.push({ subject, stepIndex: i, occurrence, dueAt: new Date(first + occurrence * repeatMs) });
    });
  }
  return { subjects: subjects.length, due, upcoming };
}

const PER_TICK = 100;

/** One pass over every enabled rule (or one rule). Returns how many actions it took. */
export async function runOpsRules(onlyRuleId?: string): Promise<number> {
  const rules = await prisma.opsRule.findMany({ where: { enabled: true, ...(onlyRuleId ? { id: onlyRuleId } : {}) } });
  let fired = 0;
  for (const rule of rules) {
    const { due } = await dueFor(rule);
    const steps = rule.steps as unknown as Step[];
    for (const d of due) {
      if (fired >= PER_TICK) return fired;
      // Claim first: the unique key makes a second, overlapping tick fail here rather than act twice.
      let claim;
      try {
        claim = await prisma.opsRuleFire.create({
          data: { ruleId: rule.id, subjectKey: d.subject.key, subjectLabel: d.subject.label, stepIndex: d.stepIndex, occurrence: d.occurrence, status: 'sent', detail: 'Running' },
        });
      } catch {
        continue;
      }
      let outcome: Outcome;
      try {
        outcome = await execute(rule, steps[d.stepIndex], d.subject);
      } catch (err) {
        outcome = { status: 'failed', detail: err instanceof Error ? err.message : 'Failed.' };
      }
      await prisma.opsRuleFire.update({ where: { id: claim.id }, data: { status: outcome.status, detail: outcome.detail.slice(0, 500) } });
      fired += 1;
    }
  }
  return fired;
}

let timer: NodeJS.Timeout | null = null;
export function startOpsRulePoller() {
  if (timer) return;
  timer = setInterval(() => {
    runOpsRules().catch((err) => console.error('[ops rules] tick failed:', err));
  }, 60_000);
}
