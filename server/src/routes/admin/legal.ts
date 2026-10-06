import { Router } from 'express';
import type { AgreementStage, LegalDocKind, MutationStatus, RegistryStatus } from '@prisma/client';
import { prisma } from '../../prisma';
import type { AuthedRequest } from '../../services/auth';
import { writeAudit } from '../../services/audit';
import { getPolicy, penaltyFor } from '../../services/salesPolicy';
import {
  GENERATED_KINDS, PLACEHOLDERS, STAGE_ORDER, TemplateError, complianceStatus, currentStage, generateDocument, getTemplate,
  milestoneState, openLegalFileFor, syncLegalFiles, unknownPlaceholders,
} from '../../services/legal';

/** Legal, compliance & registry — /api/legal. */
export const adminLegalRouter = Router();

const asDate = (v: unknown) => {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
};
const text = (v: unknown) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

const REGISTRY_ORDER: RegistryStatus[] = ['pending', 'documents_in_preparation', 'stamp_duty_paid', 'appointment_booked', 'registered'];
const DOC_KINDS: LegalDocKind[] = ['kyc', 'booking_form', 'allotment_letter', 'agreement', 'receipt', 'demand_note', 'correspondence', 'other'];

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

const fileInclude = {
  project: { select: { projectName: true } },
  stages: true,
  milestones: { include: { payments: true } },
  registry: true,
} as const;

function summarise(f: any) {
  const stage = currentStage(f.stages);
  const states = f.milestones.map((m: any) => milestoneState(m));
  return {
    id: f.id, bookingId: f.bookingId, buyerName: f.buyerName, phone: f.phone, projectId: f.projectId, projectName: f.project.projectName,
    unitId: f.unitId, agreedValue: f.agreedValue, openedAt: f.openedAt.toISOString(), closedAt: f.closedAt?.toISOString() ?? null,
    agreementStage: stage, registryStatus: f.registry?.status ?? 'pending',
    outstanding: states.reduce((s: number, x: any) => s + x.outstanding, 0),
    overdueMilestones: states.filter((x: any) => x.status === 'overdue').length,
    hasPlan: f.milestones.length > 0,
  };
}

adminLegalRouter.get('/files', async (req, res, next) => {
  try {
    await syncLegalFiles();
    const search = String(req.query.search ?? '').trim();
    const projectId = String(req.query.projectId ?? '');
    const rows = await prisma.legalFile.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        ...(search ? { OR: [{ buyerName: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }, { booking: { reference: { contains: search, mode: 'insensitive' } } }] } : {}),
      },
      include: fileInclude,
      orderBy: { openedAt: 'desc' },
      take: 300,
    });
    let items = rows.map(summarise);
    const stage = String(req.query.stage ?? 'all');
    if (stage === 'none') items = items.filter((i) => !i.agreementStage);
    else if (STAGE_ORDER.includes(stage as AgreementStage)) items = items.filter((i) => i.agreementStage === stage);
    if (req.query.overdue === '1') items = items.filter((i) => i.overdueMilestones > 0);
    res.json(items);
  } catch (err) {
    next(err);
  }
});

adminLegalRouter.get('/files/:id', async (req, res, next) => {
  try {
    const f = await prisma.legalFile.findUnique({
      where: { id: String(req.params.id) },
      include: {
        ...fileInclude,
        documents: { orderBy: { createdAt: 'desc' } },
        stages: { orderBy: { at: 'asc' } },
        milestones: { include: { payments: { orderBy: { paidOn: 'asc' } } }, orderBy: { sortOrder: 'asc' } },
        cases: true,
        booking: { select: { reference: true, amount: true, createdAt: true, unit: { select: { propertyNumber: true, propertyArea: true, propertyMeasurement: true } } } },
      },
    });
    if (!f) return res.status(404).json({ error: 'Legal file not found.' });
    const policy = await getPolicy();
    res.json({
      ...summarise(f),
      reference: f.booking.reference, bookingAmount: f.booking.amount,
      unit: `${f.booking.unit.propertyNumber} · ${f.booking.unit.propertyArea} ${f.booking.unit.propertyMeasurement}`.trim(),
      documents: f.documents, stages: f.stages, registry: f.registry, cases: f.cases,
      milestones: f.milestones.map((m) => {
        const st = milestoneState(m);
        const penalty = penaltyFor(policy, { outstanding: st.outstanding, instalment: m.amount, daysOverdue: st.daysOverdue });
        return { ...m, ...st, penalty, totalDue: st.outstanding + penalty };
      }),
      nextStage: STAGE_ORDER[(currentStage(f.stages) ? STAGE_ORDER.indexOf(currentStage(f.stages)!) : -1) + 1] ?? null,
    });
  } catch (err) {
    next(err);
  }
});

/** The legal file of a booking, if it has one — for the link on the booking page. */
adminLegalRouter.get('/bookings/:bookingId', async (req, res, next) => {
  try {
    const f = await prisma.legalFile.findUnique({ where: { bookingId: String(req.params.bookingId) }, select: { id: true } });
    if (!f) return res.status(404).json({ error: 'No legal file for this booking.' });
    res.json(f);
  } catch (err) {
    next(err);
  }
});

/** Opens the file for one booking on demand — the same call the booking flow makes automatically. */
adminLegalRouter.post('/bookings/:bookingId/open', async (req, res, next) => {
  try {
    const file = await openLegalFileFor(String(req.params.bookingId));
    if (!file) return res.status(409).json({ error: 'A legal file opens only for a confirmed booking.' });
    res.json({ id: file.id });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

adminLegalRouter.post('/files/:id/documents', async (req: AuthedRequest, res, next) => {
  try {
    const fileId = String(req.params.id);
    if (!(await prisma.legalFile.count({ where: { id: fileId } }))) return res.status(404).json({ error: 'Legal file not found.' });
    const kind = String(req.body?.kind ?? '') as LegalDocKind;
    const title = String(req.body?.title ?? '').trim();
    const url = String(req.body?.url ?? '').trim();
    if (!DOC_KINDS.includes(kind)) return res.status(400).json({ error: 'Choose what kind of document this is.' });
    if (!title || !url) return res.status(400).json({ error: 'A title and a file are required.' });
    res.status(201).json(await prisma.legalDocument.create({ data: { fileId, kind, title, url, createdById: req.auth!.sub } }));
  } catch (err) {
    next(err);
  }
});

adminLegalRouter.delete('/documents/:docId', async (req, res, next) => {
  try {
    await prisma.legalDocument.delete({ where: { id: String(req.params.docId) } }).catch(() => undefined);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

adminLegalRouter.post('/files/:id/generate', async (req: AuthedRequest, res, next) => {
  try {
    const fileId = String(req.params.id);
    const kind = String(req.body?.kind ?? '') as LegalDocKind;
    if (!GENERATED_KINDS.includes(kind)) return res.status(400).json({ error: `Only ${GENERATED_KINDS.join(', ')} can be generated.` });
    if (!(await prisma.legalFile.count({ where: { id: fileId } }))) return res.status(404).json({ error: 'Legal file not found.' });
    const milestoneId = req.body?.milestoneId ? String(req.body.milestoneId) : undefined;
    const paymentId = req.body?.paymentId ? String(req.body.paymentId) : undefined;
    if (kind === 'demand_note' && !milestoneId) return res.status(400).json({ error: 'A demand note is raised against a payment milestone.' });
    const doc = await generateDocument(kind, { fileId, milestoneId, paymentId }, req.auth!.sub);
    await writeAudit(req, { module: 'Legal', action: `Generated ${kind.replace('_', ' ')}`, recordId: fileId, recordLabel: doc.title, description: '' });
    res.status(201).json(doc);
  } catch (err) {
    if (err instanceof TemplateError) return res.status(422).json({ error: err.message });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Agreement
// ---------------------------------------------------------------------------

/** Records the next step of the agreement. Steps go in order, and each is dated no earlier than the last. */
adminLegalRouter.post('/files/:id/agreement', async (req: AuthedRequest, res, next) => {
  try {
    const fileId = String(req.params.id);
    const steps = await prisma.agreementStep.findMany({ where: { fileId }, orderBy: { at: 'asc' } });
    if (!(await prisma.legalFile.count({ where: { id: fileId } }))) return res.status(404).json({ error: 'Legal file not found.' });
    const stage = String(req.body?.stage ?? '') as AgreementStage;
    if (!STAGE_ORDER.includes(stage)) return res.status(400).json({ error: 'Unknown agreement stage.' });
    const cur = currentStage(steps);
    const expected = STAGE_ORDER[(cur ? STAGE_ORDER.indexOf(cur) : -1) + 1];
    if (stage !== expected) {
      return res.status(409).json({ error: expected ? `The next step is "${expected.replace('_', ' ')}", not "${stage.replace('_', ' ')}".` : 'The agreement is already at its last step.' });
    }
    const at = asDate(req.body?.at) ?? new Date();
    if (Number.isNaN(at.getTime())) return res.status(400).json({ error: 'The date is not valid.' });
    const last = steps[steps.length - 1];
    if (last && at.getTime() < last.at.getTime()) return res.status(400).json({ error: `This step cannot be dated before the previous one (${last.at.toLocaleDateString('en-IN')}).` });
    const responsible = String(req.body?.responsible ?? '').trim();
    if (!responsible) return res.status(400).json({ error: 'Say who is responsible for this step.' });
    const created = await prisma.agreementStep.create({ data: { fileId, stage, at, responsible, note: text(req.body?.note) } });
    await writeAudit(req, { module: 'Legal', action: `Agreement: ${stage.replace('_', ' ')}`, recordId: fileId, recordLabel: stage, description: responsible });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Payment plan
// ---------------------------------------------------------------------------

/** Replaces the whole plan. It must add up to the agreed value, and cannot change once money is recorded against it. */
adminLegalRouter.put('/files/:id/milestones', async (req: AuthedRequest, res, next) => {
  try {
    const fileId = String(req.params.id);
    const file = await prisma.legalFile.findUnique({ where: { id: fileId } });
    if (!file) return res.status(404).json({ error: 'Legal file not found.' });
    if (await prisma.milestonePayment.count({ where: { milestone: { fileId } } })) {
      return res.status(409).json({ error: 'Payments are already recorded against this plan, so it can no longer be replaced.' });
    }
    const rows = Array.isArray(req.body?.milestones) ? req.body.milestones : null;
    if (!rows || rows.length === 0) return res.status(400).json({ error: 'Add at least one milestone.' });
    const clean: { name: string; dueOn: Date; amount: number }[] = [];
    for (const r of rows) {
      const name = String(r?.name ?? '').trim();
      const dueOn = asDate(r?.dueOn);
      const amount = Math.round(Number(r?.amount));
      if (!name || !dueOn || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Every milestone needs a name, a due date and an amount above zero.' });
      clean.push({ name, dueOn, amount });
    }
    const total = clean.reduce((s, m) => s + m.amount, 0);
    if (total !== file.agreedValue) {
      return res.status(400).json({ error: `The milestones add up to ₹${total.toLocaleString('en-IN')}, but the agreed value is ₹${file.agreedValue.toLocaleString('en-IN')}.` });
    }
    clean.sort((a, b) => a.dueOn.getTime() - b.dueOn.getTime());
    await prisma.$transaction([
      prisma.paymentMilestone.deleteMany({ where: { fileId } }),
      prisma.paymentMilestone.createMany({ data: clean.map((m, i) => ({ ...m, fileId, sortOrder: i })) }),
    ]);
    await writeAudit(req, { module: 'Legal', action: 'Set payment plan', recordId: fileId, recordLabel: `${clean.length} milestones`, description: `₹${total}` });
    res.json({ milestones: clean.length });
  } catch (err) {
    next(err);
  }
});

adminLegalRouter.post('/milestones/:id/payments', async (req: AuthedRequest, res, next) => {
  try {
    const m = await prisma.paymentMilestone.findUnique({ where: { id: String(req.params.id) }, include: { payments: true } });
    if (!m) return res.status(404).json({ error: 'Milestone not found.' });
    const amount = Math.round(Number(req.body?.amount));
    const paidOn = asDate(req.body?.paidOn) ?? new Date();
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'The amount must be more than zero.' });
    if (Number.isNaN(paidOn.getTime())) return res.status(400).json({ error: 'The date is not valid.' });
    const { outstanding } = milestoneState(m);
    if (amount > outstanding) return res.status(409).json({ error: `Only ₹${outstanding.toLocaleString('en-IN')} is outstanding on this milestone.` });
    const payment = await prisma.milestonePayment.create({ data: { milestoneId: m.id, amount, paidOn, reference: text(req.body?.reference) } });
    await writeAudit(req, { module: 'Legal', action: 'Recorded milestone payment', recordId: m.id, recordLabel: m.name, description: `₹${amount}` });
    res.status(201).json(payment);
  } catch (err) {
    next(err);
  }
});

/** Raises the demand note for a milestone and stamps when it went out. */
adminLegalRouter.post('/milestones/:id/demand', async (req: AuthedRequest, res, next) => {
  try {
    const m = await prisma.paymentMilestone.findUnique({ where: { id: String(req.params.id) }, include: { payments: true } });
    if (!m) return res.status(404).json({ error: 'Milestone not found.' });
    if (milestoneState(m).outstanding === 0) return res.status(409).json({ error: 'This milestone is already paid in full.' });
    const doc = await generateDocument('demand_note', { fileId: m.fileId, milestoneId: m.id }, req.auth!.sub);
    await prisma.paymentMilestone.update({ where: { id: m.id }, data: { demandedAt: new Date() } });
    res.status(201).json(doc);
  } catch (err) {
    if (err instanceof TemplateError) return res.status(422).json({ error: err.message });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

adminLegalRouter.patch('/files/:id/registry', async (req: AuthedRequest, res, next) => {
  try {
    const fileId = String(req.params.id);
    const current = await prisma.registry.upsert({ where: { fileId }, update: {}, create: { fileId } }).catch(() => null);
    if (!current) return res.status(404).json({ error: 'Legal file not found.' });
    const status = (req.body?.status ?? current.status) as RegistryStatus;
    if (!REGISTRY_ORDER.includes(status)) return res.status(400).json({ error: 'Unknown registry status.' });
    if (REGISTRY_ORDER.indexOf(status) < REGISTRY_ORDER.indexOf(current.status)) return res.status(409).json({ error: 'Registry progress cannot move backwards.' });

    const merged = {
      appointmentOn: req.body?.appointmentOn !== undefined ? asDate(req.body.appointmentOn) : current.appointmentOn,
      registryDate: req.body?.registryDate !== undefined ? asDate(req.body.registryDate) : current.registryDate,
      subRegistrar: req.body?.subRegistrar !== undefined ? text(req.body.subRegistrar) : current.subRegistrar,
      deedNumber: req.body?.deedNumber !== undefined ? text(req.body.deedNumber) : current.deedNumber,
      deedUrl: req.body?.deedUrl !== undefined ? text(req.body.deedUrl) : current.deedUrl,
    };
    if (merged.appointmentOn === undefined || merged.registryDate === undefined) return res.status(400).json({ error: 'A date is not valid.' });
    if (status === 'appointment_booked' && !merged.appointmentOn) return res.status(400).json({ error: 'Enter the appointment date.' });
    if (status === 'registered' && (!merged.registryDate || !merged.deedNumber || !merged.subRegistrar)) {
      return res.status(400).json({ error: 'A registered unit needs the registry date, the sub-registrar office and the deed number.' });
    }
    const updated = await prisma.registry.update({ where: { fileId }, data: { status, ...merged } });
    await writeAudit(req, { module: 'Legal', action: `Registry: ${status.replace(/_/g, ' ')}`, recordId: fileId, recordLabel: status, description: '' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Project approvals, land & title, disputes
// ---------------------------------------------------------------------------

adminLegalRouter.get('/approvals', async (req, res, next) => {
  try {
    const projectId = String(req.query.projectId ?? '');
    const rows = await prisma.projectApproval.findMany({ where: projectId ? { projectId } : {}, include: { project: { select: { projectName: true } } }, orderBy: [{ validUntil: 'asc' }, { issuedOn: 'desc' }] });
    res.json(rows.map(({ project, ...a }) => ({ ...a, projectName: project.projectName, ...complianceStatus(a.validUntil) })));
  } catch (err) {
    next(err);
  }
});

adminLegalRouter.post('/approvals', async (req: AuthedRequest, res, next) => {
  try {
    const projectId = String(req.body?.projectId ?? '');
    const kind = String(req.body?.kind ?? '').trim();
    const referenceNo = String(req.body?.referenceNo ?? '').trim();
    const issuedOn = asDate(req.body?.issuedOn);
    const validUntil = asDate(req.body?.validUntil);
    if (!(await prisma.project.count({ where: { id: projectId } }))) return res.status(400).json({ error: 'Choose a project.' });
    if (!kind || !referenceNo) return res.status(400).json({ error: 'The approval type and reference number are required.' });
    if (!issuedOn) return res.status(400).json({ error: 'The issue date is required.' });
    if (validUntil === undefined) return res.status(400).json({ error: 'The validity date is not valid.' });
    if (validUntil && validUntil < issuedOn) return res.status(400).json({ error: 'Validity cannot end before the issue date.' });
    const created = await prisma.projectApproval.create({ data: { projectId, kind, referenceNo, issuedOn, validUntil, documentUrl: text(req.body?.documentUrl) } });
    await writeAudit(req, { module: 'Legal', action: 'Recorded approval', recordId: created.id, recordLabel: `${kind} ${referenceNo}`, description: '' });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

adminLegalRouter.patch('/approvals/:id', async (req, res, next) => {
  try {
    const existing = await prisma.projectApproval.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Approval not found.' });
    const validUntil = req.body?.validUntil !== undefined ? asDate(req.body.validUntil) : existing.validUntil;
    if (validUntil === undefined) return res.status(400).json({ error: 'The validity date is not valid.' });
    if (validUntil && validUntil < existing.issuedOn) return res.status(400).json({ error: 'Validity cannot end before the issue date.' });
    res.json(await prisma.projectApproval.update({ where: { id: existing.id }, data: { validUntil, documentUrl: req.body?.documentUrl !== undefined ? text(req.body.documentUrl) : undefined, referenceNo: req.body?.referenceNo ? String(req.body.referenceNo).trim() : undefined } }));
  } catch (err) {
    next(err);
  }
});

adminLegalRouter.delete('/approvals/:id', async (req, res, next) => {
  try {
    await prisma.projectApproval.delete({ where: { id: String(req.params.id) } }).catch(() => undefined);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

adminLegalRouter.get('/land', async (req, res, next) => {
  try {
    const projectId = String(req.query.projectId ?? '');
    const rows = await prisma.landRecord.findMany({ where: projectId ? { projectId } : {}, include: { project: { select: { projectName: true } } }, orderBy: { createdAt: 'desc' } });
    res.json(rows.map(({ project, ...r }) => ({ ...r, projectName: project.projectName })));
  } catch (err) {
    next(err);
  }
});

adminLegalRouter.post('/land', async (req, res, next) => {
  try {
    const projectId = String(req.body?.projectId ?? '');
    const khasra = String(req.body?.khasra ?? '').trim();
    const mutation = String(req.body?.mutation ?? 'pending') as MutationStatus;
    if (!(await prisma.project.count({ where: { id: projectId } }))) return res.status(400).json({ error: 'Choose a project.' });
    if (!khasra) return res.status(400).json({ error: 'The khasra number is required.' });
    if (!['pending', 'applied', 'completed'].includes(mutation)) return res.status(400).json({ error: 'Unknown mutation status.' });
    res.status(201).json(await prisma.landRecord.create({ data: { projectId, khasra, mutation, area: text(req.body?.area), conversionOrder: text(req.body?.conversionOrder), titleDocUrl: text(req.body?.titleDocUrl), notes: text(req.body?.notes) } }));
  } catch (err) {
    next(err);
  }
});

adminLegalRouter.patch('/land/:id', async (req, res, next) => {
  try {
    const mutation = req.body?.mutation as MutationStatus | undefined;
    if (mutation && !['pending', 'applied', 'completed'].includes(mutation)) return res.status(400).json({ error: 'Unknown mutation status.' });
    res.json(await prisma.landRecord.update({ where: { id: String(req.params.id) }, data: { mutation, conversionOrder: req.body?.conversionOrder !== undefined ? text(req.body.conversionOrder) : undefined, titleDocUrl: req.body?.titleDocUrl !== undefined ? text(req.body.titleDocUrl) : undefined, notes: req.body?.notes !== undefined ? text(req.body.notes) : undefined } }));
  } catch (err) {
    next(err);
  }
});

adminLegalRouter.get('/cases', async (req, res, next) => {
  try {
    const status = String(req.query.status ?? 'open');
    const rows = await prisma.legalCase.findMany({
      where: status === 'all' ? {} : { closed: status === 'closed' },
      include: { project: { select: { projectName: true } }, file: { select: { buyerName: true } } },
      orderBy: [{ nextHearing: 'asc' }, { createdAt: 'desc' }],
    });
    const now = Date.now();
    res.json(rows.map(({ project, file, ...c }) => ({ ...c, projectName: project?.projectName ?? null, buyerName: file?.buyerName ?? null, hearingPassed: !c.closed && !!c.nextHearing && c.nextHearing.getTime() < now })));
  } catch (err) {
    next(err);
  }
});

adminLegalRouter.post('/cases', async (req: AuthedRequest, res, next) => {
  try {
    const title = String(req.body?.title ?? '').trim();
    const counterparty = String(req.body?.counterparty ?? '').trim();
    const stage = String(req.body?.stage ?? '').trim();
    const nextHearing = asDate(req.body?.nextHearing);
    if (!title || !counterparty || !stage) return res.status(400).json({ error: 'The title, the other party and the current stage are required.' });
    if (nextHearing === undefined) return res.status(400).json({ error: 'The hearing date is not valid.' });
    const projectId = req.body?.projectId ? String(req.body.projectId) : null;
    const fileId = req.body?.fileId ? String(req.body.fileId) : null;
    if (projectId && !(await prisma.project.count({ where: { id: projectId } }))) return res.status(400).json({ error: 'That project does not exist.' });
    if (fileId && !(await prisma.legalFile.count({ where: { id: fileId } }))) return res.status(400).json({ error: 'That legal file does not exist.' });
    const created = await prisma.legalCase.create({ data: { title, counterparty, stage, nextHearing, projectId, fileId, notes: text(req.body?.notes), documents: Array.isArray(req.body?.documents) ? req.body.documents.map(String) : [] } });
    await writeAudit(req, { module: 'Legal', action: 'Logged dispute / notice', recordId: created.id, recordLabel: title, description: counterparty });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

adminLegalRouter.patch('/cases/:id', async (req, res, next) => {
  try {
    const data: Record<string, unknown> = {};
    if (req.body?.stage !== undefined) data.stage = String(req.body.stage).trim();
    if (req.body?.closed !== undefined) data.closed = !!req.body.closed;
    if (req.body?.notes !== undefined) data.notes = text(req.body.notes);
    if (req.body?.nextHearing !== undefined) {
      const d = asDate(req.body.nextHearing);
      if (d === undefined) return res.status(400).json({ error: 'The hearing date is not valid.' });
      data.nextHearing = d;
    }
    if (Array.isArray(req.body?.documents)) data.documents = req.body.documents.map(String);
    res.json(await prisma.legalCase.update({ where: { id: String(req.params.id) }, data: data as never }));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Compliance board, overdue payments, templates
// ---------------------------------------------------------------------------

/** One board of everything with an expiry: project approvals and vendor documents, banded by how soon it lapses. */
adminLegalRouter.get('/compliance', async (_req, res, next) => {
  try {
    const [approvals, docs] = await Promise.all([
      prisma.projectApproval.findMany({ include: { project: { select: { projectName: true } } } }),
      prisma.vendorDocument.findMany({ where: { expiresAt: { not: null } }, include: { vendor: { select: { name: true } } } }),
    ]);
    const items = [
      ...approvals.map((a) => ({ id: a.id, source: 'approval' as const, label: a.kind, subject: a.project.projectName, reference: a.referenceNo, validUntil: a.validUntil?.toISOString() ?? null, ...complianceStatus(a.validUntil) })),
      ...docs.map((d) => ({ id: d.id, source: 'vendor_document' as const, label: d.title, subject: d.vendor.name, reference: null, validUntil: d.expiresAt!.toISOString(), ...complianceStatus(d.expiresAt) })),
    ];
    const count = (s: string) => items.filter((i) => i.status === s).length;
    res.json({
      counts: { valid: count('valid') + count('no_expiry'), expires_90: count('expires_90'), expires_60: count('expires_60'), expires_30: count('expires_30'), lapsed: count('lapsed') },
      items: items.sort((a, b) => (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999)),
    });
  } catch (err) {
    next(err);
  }
});

adminLegalRouter.get('/overdue', async (_req, res, next) => {
  try {
    const rows = await prisma.paymentMilestone.findMany({ where: { dueOn: { lt: new Date() } }, include: { payments: true, file: { select: { id: true, buyerName: true, phone: true, project: { select: { projectName: true } } } } } });
    const policy = await getPolicy();
    const overdue = rows.map((m) => ({ m, s: milestoneState(m) })).filter((x) => x.s.status === 'overdue');
    res.json({
      total: overdue.reduce((s, x) => s + x.s.outstanding, 0),
      items: overdue.sort((a, b) => b.s.daysOverdue - a.s.daysOverdue).map(({ m, s }) => ({
        milestoneId: m.id, fileId: m.file.id, buyerName: m.file.buyerName, phone: m.file.phone, projectName: m.file.project.projectName,
        milestone: m.name, dueOn: m.dueOn.toISOString(), amount: m.amount, outstanding: s.outstanding, daysOverdue: s.daysOverdue, penalty: penaltyFor(policy, { outstanding: s.outstanding, instalment: m.amount, daysOverdue: s.daysOverdue }), demandedAt: m.demandedAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

adminLegalRouter.get('/templates', async (_req, res, next) => {
  try {
    const out = [];
    for (const kind of GENERATED_KINDS) out.push(await getTemplate(kind));
    res.json({ placeholders: PLACEHOLDERS, templates: out });
  } catch (err) {
    next(err);
  }
});

adminLegalRouter.put('/templates/:kind', async (req: AuthedRequest, res, next) => {
  try {
    const kind = String(req.params.kind) as LegalDocKind;
    if (!GENERATED_KINDS.includes(kind)) return res.status(404).json({ error: 'No such template.' });
    const title = String(req.body?.title ?? '').trim();
    const body = String(req.body?.body ?? '');
    if (!title || !body.trim()) return res.status(400).json({ error: 'The title and the wording are required.' });
    const unknown = unknownPlaceholders(body);
    if (unknown.length) return res.status(400).json({ error: `Unknown placeholder${unknown.length > 1 ? 's' : ''}: ${unknown.map((u) => `{{${u}}}`).join(', ')}. Use only the ones listed.` });
    const saved = await prisma.legalTemplate.upsert({ where: { kind }, update: { title, body }, create: { kind, title, body } });
    await writeAudit(req, { module: 'Legal', action: 'Edited document template', recordId: kind, recordLabel: title, description: '' });
    res.json(saved);
  } catch (err) {
    next(err);
  }
});
