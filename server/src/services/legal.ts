import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import type { AgreementStage, LegalDocKind, Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { UPLOAD_DIR } from './upload';
import { getPolicy, penaltyFor } from './salesPolicy';

/**
 * Legal files, generated documents and the derived statuses around them.
 *
 * Nothing a person would otherwise have to keep consistent by hand is stored: a file's agreement
 * stage is its latest recorded step, a milestone's status is its payments against its due date,
 * and a compliance item's validity is its dates against today.
 */

// ---------------------------------------------------------------------------
// Opening a file for a confirmed booking
// ---------------------------------------------------------------------------

/** A booking counts as confirmed once it is booked or part-paid; the first payment is the booking. */
const CONFIRMED = ['booked', 'partPaid'] as const;

export async function openLegalFileFor(bookingId: string) {
  const existing = await prisma.legalFile.findUnique({ where: { bookingId } });
  if (existing) return existing;
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { unit: true } });
  if (!booking || booking.isDeposit !== 0 || !(CONFIRMED as readonly string[]).includes(booking.status)) return null;
  try {
    return await prisma.legalFile.create({
      data: {
        bookingId: booking.id, projectId: booking.unit.projectId, unitId: booking.unit.id, buyerName: booking.bookingName,
        phone: booking.phone, agreedValue: booking.unit.totalInvestmentAmount,
        registry: { create: {} },
        // The buyer's identity documents and the booking form are already on the booking: file them
        // rather than asking for them again.
        documents: { create: [
          ...(booking.aadhaarImage ? [{ kind: 'kyc' as const, title: 'Aadhaar (front)', url: booking.aadhaarImage }] : []),
          ...(booking.aadhaarBack ? [{ kind: 'kyc' as const, title: 'Aadhaar (back)', url: booking.aadhaarBack }] : []),
          ...(booking.chequeImage ? [{ kind: 'receipt' as const, title: 'Cheque image', url: booking.chequeImage }] : []),
        ] },
      },
    });
  } catch {
    // Two requests opened it at once; the unique key kept it to one.
    return prisma.legalFile.findUnique({ where: { bookingId } });
  }
}

/** Opens a file for every confirmed booking that lacks one. Idempotent; cheap when nothing is missing. */
export async function syncLegalFiles(): Promise<number> {
  const missing = await prisma.booking.findMany({
    where: { isDeposit: 0, status: { in: [...CONFIRMED] }, legalFile: null },
    select: { id: true },
    take: 500,
  });
  for (const b of missing) await openLegalFileFor(b.id);
  return missing.length;
}

// ---------------------------------------------------------------------------
// Derived statuses
// ---------------------------------------------------------------------------

export const STAGE_ORDER: AgreementStage[] = ['draft', 'sent', 'under_review', 'signed', 'executed', 'stamped'];

export function currentStage(steps: { stage: AgreementStage }[]): AgreementStage | null {
  let best = -1;
  for (const s of steps) best = Math.max(best, STAGE_ORDER.indexOf(s.stage));
  return best < 0 ? null : STAGE_ORDER[best];
}

export type MilestoneStatus = 'upcoming' | 'due' | 'partial' | 'paid' | 'overdue';

export function milestoneState(m: { amount: number; dueOn: Date; payments: { amount: number }[] }, at = new Date()) {
  const paid = m.payments.reduce((s, p) => s + p.amount, 0);
  const outstanding = Math.max(0, m.amount - paid);
  let status: MilestoneStatus;
  if (outstanding === 0) status = 'paid';
  else if (m.dueOn.getTime() < startOfDay(at).getTime()) status = 'overdue';
  else if (m.dueOn.getTime() <= endOfDay(at).getTime()) status = 'due';
  else status = paid > 0 ? 'partial' : 'upcoming';
  const daysOverdue = status === 'overdue' ? Math.ceil((startOfDay(at).getTime() - m.dueOn.getTime()) / 86_400_000) : 0;
  return { paid, outstanding, status, daysOverdue };
}

function startOfDay(d: Date) { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; }
function endOfDay(d: Date) { const c = new Date(d); c.setHours(23, 59, 59, 999); return c; }

export type ComplianceStatus = 'valid' | 'expires_90' | 'expires_60' | 'expires_30' | 'lapsed' | 'no_expiry';

/** Which band an expiry date falls in. 30 is inside 60 is inside 90; each item is in the tightest one. */
export function complianceStatus(validUntil: Date | null, at = new Date()): { status: ComplianceStatus; daysLeft: number | null } {
  if (!validUntil) return { status: 'no_expiry', daysLeft: null };
  const daysLeft = Math.ceil((endOfDay(validUntil).getTime() - at.getTime()) / 86_400_000);
  if (daysLeft < 0) return { status: 'lapsed', daysLeft };
  if (daysLeft <= 30) return { status: 'expires_30', daysLeft };
  if (daysLeft <= 60) return { status: 'expires_60', daysLeft };
  if (daysLeft <= 90) return { status: 'expires_90', daysLeft };
  return { status: 'valid', daysLeft };
}

// ---------------------------------------------------------------------------
// Templates and generated documents
// ---------------------------------------------------------------------------

export const PLACEHOLDERS = [
  'buyer_name', 'phone', 'booking_reference', 'unit_number', 'project_name', 'project_location', 'area', 'agreed_value',
  'booking_amount', 'rate', 'base_amount', 'other_charges', 'gst_registration', 'grand_total', 'token_amount', 'balance_after_token', 'date', 'milestone_name', 'milestone_amount', 'milestone_due', 'outstanding', 'penalty', 'total_due', 'paid_amount', 'paid_on', 'payment_reference',
] as const;

export const GENERATED_KINDS: LegalDocKind[] = ['cost_sheet', 'allotment_letter', 'agreement', 'receipt', 'demand_note'];

const DEFAULT_TEMPLATES: Record<string, { title: string; body: string }> = {
  cost_sheet: {
    title: 'Cost Sheet',
    body: `COST SHEET\n\nDate: {{date}}\nBooking reference: {{booking_reference}}\nBuyer: {{buyer_name}} ({{phone}})\n\nProject: {{project_name}}, {{project_location}}\nPlot: {{unit_number}}   Area: {{area}}\n\nRate per unit area ............ {{rate}}\nBasic cost of plot ............ {{base_amount}}\nOther applicable charges ...... {{other_charges}}\nGST and registration .......... {{gst_registration}}\n--------------------------------------------\nTOTAL COST .................... {{grand_total}}\n\nToken / booking amount ........ {{token_amount}}\nBalance after token ........... {{balance_after_token}}\n\nThe balance is payable as per the payment plan agreed with you. Charges shown are as recorded for this plot at the time of booking.\n\nFor Rosium Developers Pvt. Ltd.`,
  },
  allotment_letter: {
    title: 'Allotment Letter',
    body: `Date: {{date}}\nBooking reference: {{booking_reference}}\n\nTo,\n{{buyer_name}}\nPhone: {{phone}}\n\nSubject: Allotment of plot {{unit_number}}, {{project_name}}\n\nDear {{buyer_name}},\n\nWe are pleased to confirm the allotment of plot {{unit_number}}, admeasuring {{area}}, in {{project_name}}, {{project_location}}, against your booking amount of {{booking_amount}}. The agreed total value of the plot is {{agreed_value}}.\n\nThe balance shall be payable as per the payment plan agreed with you. This letter is subject to the terms of the agreement to be executed between us.\n\nFor Rosium Developers Pvt. Ltd.\n\nAuthorised Signatory`,
  },
  agreement: {
    title: 'Agreement for Sale',
    body: `AGREEMENT FOR SALE\n\nThis agreement is made on {{date}} between Rosium Developers Pvt. Ltd. (the "Developer") and {{buyer_name}} (the "Buyer"), contact {{phone}}.\n\n1. Subject matter. The Developer agrees to sell and the Buyer agrees to purchase plot {{unit_number}}, admeasuring {{area}}, in the project {{project_name}}, {{project_location}}.\n\n2. Consideration. The total consideration is {{agreed_value}}, of which {{booking_amount}} has been received as booking amount (reference {{booking_reference}}). The balance is payable in accordance with the payment plan forming part of this agreement.\n\n3. Remaining terms. The remaining terms and conditions are to be settled by the Developer's legal counsel before execution.\n\nSigned for the Developer: ______________________\n\nSigned by the Buyer: ______________________`,
  },
  receipt: {
    title: 'Payment Receipt',
    body: `PAYMENT RECEIPT\n\nDate: {{date}}\nReceived with thanks from {{buyer_name}} a sum of {{paid_amount}} on {{paid_on}} towards plot {{unit_number}}, {{project_name}} (booking {{booking_reference}}).\n\nPayment reference: {{payment_reference}}\n\nFor Rosium Developers Pvt. Ltd.`,
  },
  demand_note: {
    title: 'Demand Note',
    body: `DEMAND NOTE\n\nDate: {{date}}\nTo: {{buyer_name}}\nPlot {{unit_number}}, {{project_name}} (booking {{booking_reference}})\n\nAs per the agreed payment plan, the instalment "{{milestone_name}}" of {{milestone_amount}} falls due on {{milestone_due}}. The amount outstanding against it is {{outstanding}}.\n\nYou are requested to make the payment on or before the due date.\n\nFor Rosium Developers Pvt. Ltd.`,
  },
};

export async function getTemplate(kind: LegalDocKind) {
  const stored = await prisma.legalTemplate.findUnique({ where: { kind } });
  if (stored) return stored;
  const def = DEFAULT_TEMPLATES[kind];
  if (!def) return null;
  return prisma.legalTemplate.create({ data: { kind, ...def } });
}

/** Finds every {{name}} in a template. */
export function placeholdersIn(body: string): string[] {
  return [...new Set([...body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]))];
}

export function unknownPlaceholders(body: string): string[] {
  return placeholdersIn(body).filter((p) => !(PLACEHOLDERS as readonly string[]).includes(p));
}

const rupees = (n: number) => `Rs. ${n.toLocaleString('en-IN')}`;
const dateText = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

export interface RenderContext {
  fileId: string;
  milestoneId?: string;
  paymentId?: string;
}

/** The values a document can draw on, read from the booking itself — never typed. */
export async function buildValues(ctx: RenderContext): Promise<Record<string, string>> {
  const file = await prisma.legalFile.findUniqueOrThrow({
    where: { id: ctx.fileId },
    include: { booking: { include: { unit: { include: { project: true } } } } },
  });
  const { booking } = file;
  const unit = booking.unit;
  const v: Record<string, string> = {
    buyer_name: file.buyerName, phone: file.phone, booking_reference: booking.reference, unit_number: unit.propertyNumber,
    project_name: unit.project.projectName, project_location: unit.project.projectLocation,
    area: `${unit.propertyArea} ${unit.propertyMeasurement}`.trim(), agreed_value: rupees(file.agreedValue),
    // The unit's total is area x rate; charges and GST/registration are payable on top of it.
    rate: rupees(unit.perAreaAmount), base_amount: rupees(unit.totalInvestmentAmount), other_charges: rupees(unit.charges),
    gst_registration: rupees(unit.gstAndRegistration), grand_total: rupees(unit.totalInvestmentAmount + unit.charges + unit.gstAndRegistration),
    token_amount: rupees(unit.tokenAmount > 0 ? unit.tokenAmount : booking.amount),
    balance_after_token: rupees(Math.max(0, unit.totalInvestmentAmount + unit.charges + unit.gstAndRegistration - (unit.tokenAmount > 0 ? unit.tokenAmount : booking.amount))),
    booking_amount: rupees(booking.amount), date: dateText(new Date()),
  };
  if (ctx.milestoneId) {
    const m = await prisma.paymentMilestone.findFirstOrThrow({ where: { id: ctx.milestoneId, fileId: file.id }, include: { payments: true } });
    const state = milestoneState(m);
    const penalty = penaltyFor(await getPolicy(), { outstanding: state.outstanding, instalment: m.amount, daysOverdue: state.daysOverdue });
    Object.assign(v, { milestone_name: m.name, milestone_amount: rupees(m.amount), milestone_due: dateText(m.dueOn), outstanding: rupees(state.outstanding), penalty: rupees(penalty), total_due: rupees(state.outstanding + penalty) });
  }
  if (ctx.paymentId) {
    const p = await prisma.milestonePayment.findFirstOrThrow({ where: { id: ctx.paymentId, milestone: { fileId: file.id } } });
    Object.assign(v, { paid_amount: rupees(p.amount), paid_on: dateText(p.paidOn), payment_reference: p.reference ?? 'Not recorded' });
  } else if (ctx.milestoneId === undefined) {
    // A receipt for the booking amount itself.
    Object.assign(v, { paid_amount: rupees(booking.amount), paid_on: dateText(booking.createdAt), payment_reference: booking.note ?? booking.paymentMode });
  }
  return v;
}

export class TemplateError extends Error {}

/**
 * The cost sheet for a booking, available before the legal file exists — it is needed when the
 * token is taken, which can be before the booking is confirmed. If the booking already has a legal
 * file the sheet is filed there too; otherwise it is simply handed back.
 */
export async function costSheetForBooking(bookingId: string, userId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { unit: { include: { project: true } }, legalFile: { select: { id: true } } } });
  if (!booking) return null;
  const unit = booking.unit;
  const total = unit.totalInvestmentAmount + unit.charges + unit.gstAndRegistration;
  const token = unit.tokenAmount > 0 ? unit.tokenAmount : booking.amount;
  const values: Record<string, string> = {
    buyer_name: booking.bookingName, phone: booking.phone, booking_reference: booking.reference, unit_number: unit.propertyNumber,
    project_name: unit.project.projectName, project_location: unit.project.projectLocation, area: `${unit.propertyArea} ${unit.propertyMeasurement}`.trim(),
    agreed_value: rupees(unit.totalInvestmentAmount), rate: rupees(unit.perAreaAmount), base_amount: rupees(unit.totalInvestmentAmount),
    other_charges: rupees(unit.charges), gst_registration: rupees(unit.gstAndRegistration), grand_total: rupees(total), token_amount: rupees(token),
    balance_after_token: rupees(Math.max(0, total - token)), booking_amount: rupees(booking.amount), date: dateText(new Date()),
  };
  const template = await getTemplate('cost_sheet');
  if (!template) throw new TemplateError('There is no cost sheet template.');
  const text = renderTemplate(template.body, values);
  const url = await writePdf(template.title, text, `Generated from booking ${booking.reference} on ${values.date}. Wording is a template and must be approved by counsel before use.`);
  if (booking.legalFile) {
    const doc = await prisma.legalDocument.create({ data: { fileId: booking.legalFile.id, kind: 'cost_sheet', title: template.title, url, generated: true, status: 'verified', createdById: userId } });
    return { url: doc.url, title: doc.title, filed: true };
  }
  return { url, title: template.title, filed: false };
}

export function renderTemplate(body: string, values: Record<string, string>): string {
  const missing = placeholdersIn(body).filter((p) => values[p] === undefined);
  if (missing.length) {
    // Better to refuse than to print a blank or a literal {{tag}} into a legal document.
    throw new TemplateError(`This template uses ${missing.map((m) => `{{${m}}}`).join(', ')}, which is not available for this document.`);
  }
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, name: string) => values[name]);
}

/** Writes a simple, clean PDF and returns its upload URL. */
export function writePdf(title: string, text: string, footer: string): Promise<string> {
  const name = `legal-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.pdf`;
  const target = path.join(UPLOAD_DIR, name);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 60 });
    const stream = fs.createWriteStream(target);
    doc.pipe(stream);
    doc.fontSize(10).fillColor('#652251').text('ROSIUM DEVELOPERS PVT. LTD.', { align: 'left' });
    doc.moveDown(0.3).strokeColor('#652251').lineWidth(1.2).moveTo(60, doc.y).lineTo(535, doc.y).stroke();
    doc.moveDown(1).fontSize(16).fillColor('#1a1a1a').text(title, { align: 'left' });
    doc.moveDown(1).fontSize(11).fillColor('#222222').text(text, { align: 'left', lineGap: 4 });
    doc.fontSize(8).fillColor('#888888').text(footer, 60, 770, { align: 'left', width: 475 });
    doc.end();
    stream.on('finish', () => resolve(`/uploads/${name}`));
    stream.on('error', reject);
  });
}

export async function generateDocument(kind: LegalDocKind, ctx: RenderContext, userId: string) {
  if (!GENERATED_KINDS.includes(kind)) throw new TemplateError(`A ${kind} cannot be generated; upload it instead.`);
  const template = await getTemplate(kind);
  if (!template) throw new TemplateError('There is no template for this document.');
  const values = await buildValues(ctx);
  let text = renderTemplate(template.body, values);
  // The demand letter must carry the penalty whatever the wording says: if the template does not
  // mention it and one is due, it is stated plainly underneath.
  if (kind === 'demand_note' && values.penalty && values.penalty !== rupees(0) && !/\{\{\s*penalty\s*\}\}/.test(template.body)) {
    text += `\n\nLate-payment charge as per policy: ${values.penalty}.\nTotal payable including the charge: ${values.total_due}.`;
  }
  const url = await writePdf(template.title, text, `Generated from booking ${values.booking_reference} on ${values.date}. Wording is a template and must be approved by counsel before use.`);
  const label = ctx.milestoneId ? ` — ${values.milestone_name}` : '';
  return prisma.legalDocument.create({
    data: { fileId: ctx.fileId, kind, title: `${template.title}${label}`, url, generated: true, status: 'verified', milestoneId: ctx.milestoneId ?? null, createdById: userId },
  });
}

export type FileWhere = Prisma.LegalFileWhereInput;
