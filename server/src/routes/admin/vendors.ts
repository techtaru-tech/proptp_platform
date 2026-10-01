import { Router } from 'express';
import type { Prisma, VendorCategory } from '@prisma/client';
import { prisma } from '../../prisma';
import { hashPassword, type AuthedRequest } from '../../services/auth';
import { writeAudit } from '../../services/audit';
import { notify } from '../../services/notify';
import { stockOf, stockPosition, vendorPerformance } from '../../services/material';
import { makeMaterialEntryHandler, materialPhotoFields } from '../materialEntry';

/** Vendors, work orders, bills and material — /api/vendors and /api/materials. */
export const adminVendorsRouter = Router();
export const adminMaterialsRouter = Router();

const CATEGORIES: VendorCategory[] = ['contractor', 'supplier', 'architect', 'consultant', 'agency'];
const str = (v: unknown) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

/** The panel role every vendor login is given: the portal and nothing else. */
async function vendorPortalRole() {
  return prisma.panelRole.upsert({
    where: { name: 'Vendor Portal' },
    update: {},
    create: { name: 'Vendor Portal', description: 'A vendor sees only their own work, material and bills.', modules: ['vendor_portal'], isSystem: true },
  });
}

// ---------------------------------------------------------------------------
// Directory
// ---------------------------------------------------------------------------

adminVendorsRouter.get('/', async (req, res, next) => {
  try {
    const category = String(req.query.category ?? 'all');
    const search = String(req.query.search ?? '').trim();
    const where: Prisma.VendorWhereInput = {};
    if (CATEGORIES.includes(category as VendorCategory)) where.category = category as VendorCategory;
    if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { contactPerson: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }];
    const rows = await prisma.vendor.findMany({
      where,
      include: { _count: { select: { documents: true, workOrders: true } }, user: { select: { email: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(rows.map(({ _count, user, ...v }) => ({ ...v, documentCount: _count.documents, workOrderCount: _count.workOrders, loginEmail: user?.email ?? null })));
  } catch (err) {
    next(err);
  }
});

function readVendor(body: any) {
  const name = String(body?.name ?? '').trim();
  const category = String(body?.category ?? '') as VendorCategory;
  if (!name) return { error: 'Vendor name is required.' };
  if (!CATEGORIES.includes(category)) return { error: 'Choose a category.' };
  const contractValue = Math.max(0, Math.round(Number(body?.contractValue ?? 0)) || 0);
  return {
    data: {
      name, category, contractValue, contactPerson: str(body?.contactPerson), phone: str(body?.phone), email: str(body?.email),
      address: str(body?.address), gstin: str(body?.gstin), notes: str(body?.notes), active: body?.active === undefined ? true : !!body.active,
    },
  };
}

adminVendorsRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const { data, error } = readVendor(req.body);
    if (error || !data) return res.status(400).json({ error });
    const login = req.body?.login as { email?: string; password?: string } | undefined;

    let userId: string | null = null;
    if (login?.email || login?.password) {
      const email = String(login.email ?? '').trim().toLowerCase();
      const password = String(login.password ?? '');
      const phone = String(req.body?.phone ?? '').trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'A valid login email is required.' });
      if (password.length < 8) return res.status(400).json({ error: 'The login password must be at least 8 characters.' });
      if (!/^\d{10}$/.test(phone)) return res.status(400).json({ error: 'A 10-digit phone number is required for a login.' });
      if (await prisma.user.findUnique({ where: { phone } })) return res.status(409).json({ error: 'That phone number already belongs to another account.' });
      if (await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } })) return res.status(409).json({ error: 'That email already belongs to another account.' });
      const role = await vendorPortalRole();
      const code = `SR-VND-${Date.now().toString(36).toUpperCase().slice(-6)}`;
      const user = await prisma.user.create({
        data: { name: data.name, email, phone, role: 'vendor', status: 'active', passwordHash: await hashPassword(password), panelRoleId: role.id, partnerCode: code, referralCode: code },
      });
      userId = user.id;
    }

    const created = await prisma.vendor.create({ data: { ...data, userId } });
    await writeAudit(req, { module: 'Vendors', action: 'Added vendor', recordId: created.id, recordLabel: created.name, description: userId ? 'With a portal login.' : '' });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

adminVendorsRouter.get('/:id', async (req, res, next) => {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { id: String(req.params.id) },
      include: {
        documents: { orderBy: { createdAt: 'desc' } },
        workOrders: { include: { project: { select: { projectName: true } }, bills: { select: { amount: true, status: true } } }, orderBy: { createdAt: 'desc' } },
        user: { select: { email: true, status: true } },
      },
    });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found.' });
    const billed = (w: (typeof vendor.workOrders)[number]) => w.bills.filter((b) => b.status !== 'rejected').reduce((s, b) => s + b.amount, 0);
    res.json({
      ...vendor,
      workOrders: vendor.workOrders.map(({ bills, project, ...w }) => ({ ...w, projectName: project.projectName, billed: billed({ ...w, bills, project } as never), paid: bills.filter((b) => b.status === 'paid').reduce((s, b) => s + b.amount, 0) })),
      performance: await vendorPerformance(vendor),
    });
  } catch (err) {
    next(err);
  }
});

adminVendorsRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const existing = await prisma.vendor.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Vendor not found.' });
    const { data, error } = readVendor({ ...existing, ...req.body });
    if (error || !data) return res.status(400).json({ error });
    const updated = await prisma.vendor.update({ where: { id: existing.id }, data });
    // Switching a vendor off also switches their login off, so deactivating means what it says.
    if (existing.userId && updated.active !== existing.active) {
      await prisma.user.update({ where: { id: existing.userId }, data: { status: updated.active ? 'active' : 'inactive' } });
    }
    await writeAudit(req, { module: 'Vendors', action: 'Updated vendor', recordId: updated.id, recordLabel: updated.name, description: '' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

adminVendorsRouter.post('/:id/documents', async (req: AuthedRequest, res, next) => {
  try {
    const vendorId = String(req.params.id);
    if (!(await prisma.vendor.count({ where: { id: vendorId } }))) return res.status(404).json({ error: 'Vendor not found.' });
    const title = String(req.body?.title ?? '').trim();
    const url = String(req.body?.url ?? '').trim();
    if (!title || !url) return res.status(400).json({ error: 'A title and a file are required.' });
    const expiresAt = req.body?.expiresAt ? new Date(String(req.body.expiresAt)) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) return res.status(400).json({ error: 'Expiry date is not valid.' });
    res.status(201).json(await prisma.vendorDocument.create({ data: { vendorId, title, url, expiresAt } }));
  } catch (err) {
    next(err);
  }
});

adminVendorsRouter.delete('/documents/:docId', async (req, res, next) => {
  try {
    await prisma.vendorDocument.delete({ where: { id: String(req.params.docId) } }).catch(() => undefined);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Work orders and bills
// ---------------------------------------------------------------------------

adminVendorsRouter.post('/:id/work-orders', async (req: AuthedRequest, res, next) => {
  try {
    const vendorId = String(req.params.id);
    if (!(await prisma.vendor.count({ where: { id: vendorId } }))) return res.status(404).json({ error: 'Vendor not found.' });
    const projectId = String(req.body?.projectId ?? '');
    const amount = Math.round(Number(req.body?.amount));
    const description = String(req.body?.description ?? '').trim();
    if (!(await prisma.project.count({ where: { id: projectId } }))) return res.status(400).json({ error: 'Choose a project.' });
    if (!description) return res.status(400).json({ error: 'Describe the work.' });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'The amount must be more than zero.' });
    const count = await prisma.workOrder.count();
    const created = await prisma.workOrder.create({ data: { vendorId, projectId, description, amount, number: `WO-${String(count + 1).padStart(4, '0')}-${Date.now().toString(36).slice(-3).toUpperCase()}` } });
    await writeAudit(req, { module: 'Vendors', action: 'Created work order', recordId: created.id, recordLabel: created.number, description: `₹${amount}` });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

adminVendorsRouter.get('/bills/all', async (req, res, next) => {
  try {
    const status = String(req.query.status ?? 'submitted');
    const rows = await prisma.vendorBill.findMany({
      where: ['submitted', 'approved', 'rejected', 'paid'].includes(status) ? { status: status as never } : {},
      include: { vendor: { select: { name: true } }, workOrder: { select: { number: true, description: true, amount: true, project: { select: { projectName: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json(rows.map(({ vendor, workOrder, ...b }) => ({ ...b, vendorName: vendor.name, workOrderNumber: workOrder.number, workOrderAmount: workOrder.amount, projectName: workOrder.project.projectName, description: workOrder.description })));
  } catch (err) {
    next(err);
  }
});

adminVendorsRouter.post('/bills/:billId/review', async (req: AuthedRequest, res, next) => {
  try {
    const decision = String(req.body?.decision ?? '');
    if (!['approve', 'reject', 'pay'].includes(decision)) return res.status(400).json({ error: 'decision must be approve, reject or pay.' });
    const bill = await prisma.vendorBill.findUnique({ where: { id: String(req.params.billId) }, include: { vendor: true } });
    if (!bill) return res.status(404).json({ error: 'Bill not found.' });

    const reason = String(req.body?.reason ?? '').trim();
    const data: Prisma.VendorBillUpdateInput = {};
    if (decision === 'approve' || decision === 'reject') {
      if (bill.status !== 'submitted') return res.status(409).json({ error: `This bill is already ${bill.status}.` });
      if (decision === 'reject' && !reason) return res.status(400).json({ error: 'Give a reason when rejecting a bill.' });
      data.status = decision === 'approve' ? 'approved' : 'rejected';
      data.rejectionReason = decision === 'reject' ? reason : null;
      data.reviewedById = req.auth!.sub;
      data.reviewedAt = new Date();
    } else {
      // Only an approved bill is paid, and payment is recorded once.
      if (bill.status !== 'approved') return res.status(409).json({ error: bill.status === 'paid' ? 'This bill is already paid.' : 'Approve the bill before marking it paid.' });
      data.status = 'paid';
      data.paidAt = new Date();
      data.paymentRef = str(req.body?.paymentRef);
    }
    const updated = await prisma.vendorBill.update({ where: { id: bill.id }, data });
    await writeAudit(req, { module: 'Vendors', action: `Bill ${updated.status}`, recordId: bill.id, recordLabel: `${bill.vendor.name} · ${bill.billNumber}`, description: `₹${bill.amount}` });
    if (bill.vendor.userId) {
      await notify({ title: `Bill ${updated.status}`, body: `${bill.billNumber}: ₹${bill.amount}${reason ? ` — ${reason}` : ''}`, userIds: [bill.vendor.userId], type: 'system' }).catch(() => undefined);
    }
    res.json({ id: updated.id, status: updated.status });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

adminMaterialsRouter.get('/stock', async (req, res, next) => {
  try {
    res.json(await stockPosition(req.query.projectId ? String(req.query.projectId) : undefined));
  } catch (err) {
    next(err);
  }
});

adminMaterialsRouter.get('/entries', async (req, res, next) => {
  try {
    const status = String(req.query.status ?? 'pending');
    const rows = await prisma.materialEntry.findMany({
      where: ['pending', 'verified', 'rejected'].includes(status) ? { status: status as never } : {},
      include: { material: true, vendor: { select: { name: true } }, project: { select: { projectName: true } }, photos: true, createdBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(rows.map((e) => ({
      id: e.id, projectName: e.project.projectName, material: e.material.name, unit: e.material.unit, quantity: e.quantity, vendorName: e.vendor?.name ?? null,
      challanNo: e.challanNo, vehicleNo: e.vehicleNo, receivedBy: e.receivedBy, receivedOn: e.receivedOn.toISOString(), expectedOn: e.expectedOn?.toISOString() ?? null,
      enteredBy: e.createdBy.name, status: e.status, rejectionReason: e.rejectionReason,
      photos: e.photos.map((p) => ({ id: p.id, kind: p.kind, url: p.url, takenAt: p.takenAt.toISOString(), latitude: p.latitude, longitude: p.longitude })),
    })));
  } catch (err) {
    next(err);
  }
});

adminMaterialsRouter.post('/entries', materialPhotoFields, makeMaterialEntryHandler({ vendorFromLogin: false }));

adminMaterialsRouter.post('/entries/:id/review', async (req: AuthedRequest, res, next) => {
  try {
    const decision = String(req.body?.decision ?? '');
    const reason = String(req.body?.reason ?? '').trim();
    if (!['verify', 'reject'].includes(decision)) return res.status(400).json({ error: 'decision must be verify or reject.' });
    if (decision === 'reject' && !reason) return res.status(400).json({ error: 'Give a reason when rejecting an entry.' });
    const entry = await prisma.materialEntry.findUnique({ where: { id: String(req.params.id) }, include: { material: true } });
    if (!entry) return res.status(404).json({ error: 'Entry not found.' });
    if (entry.status !== 'pending') return res.status(409).json({ error: `This entry was already ${entry.status}.` });
    const updated = await prisma.materialEntry.update({
      where: { id: entry.id },
      data: { status: decision === 'verify' ? 'verified' : 'rejected', rejectionReason: decision === 'reject' ? reason : null, verifiedById: req.auth!.sub, verifiedAt: new Date() },
    });
    await writeAudit(req, { module: 'Vendors', action: decision === 'verify' ? 'Verified material entry' : 'Rejected material entry', recordId: entry.id, recordLabel: `${entry.quantity} ${entry.material.unit} ${entry.material.name}`, description: reason });
    await notify({ title: `Material entry ${updated.status}`, body: `${entry.material.name} (${entry.challanNo})${reason ? `: ${reason}` : ''}`, userIds: [entry.createdById], type: 'system' }).catch(() => undefined);
    res.json({ id: updated.id, status: updated.status });
  } catch (err) {
    next(err);
  }
});

adminMaterialsRouter.get('/issues', async (req, res, next) => {
  try {
    const rows = await prisma.materialIssue.findMany({
      where: req.query.projectId ? { projectId: String(req.query.projectId) } : {},
      include: { material: true, project: { select: { projectName: true } }, issuedBy: { select: { name: true } } },
      orderBy: { issuedOn: 'desc' },
      take: 100,
    });
    res.json(rows.map((i) => ({ id: i.id, projectName: i.project.projectName, material: i.material.name, unit: i.material.unit, quantity: i.quantity, purpose: i.purpose, issuedTo: i.issuedTo, issuedBy: i.issuedBy.name, issuedOn: i.issuedOn.toISOString() })));
  } catch (err) {
    next(err);
  }
});

/** Material leaving the store for work. It cannot take more than the verified stock on hand. */
adminMaterialsRouter.post('/issues', async (req: AuthedRequest, res, next) => {
  try {
    const projectId = String(req.body?.projectId ?? '');
    const materialId = String(req.body?.materialId ?? '');
    const quantity = Number(req.body?.quantity);
    const purpose = String(req.body?.purpose ?? '').trim();
    if (!purpose) return res.status(400).json({ error: 'Say what the material is for.' });
    if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'Quantity must be more than zero.' });
    const material = await prisma.materialItem.findUnique({ where: { id: materialId } });
    if (!material || !(await prisma.project.count({ where: { id: projectId } }))) return res.status(400).json({ error: 'Choose a project and a material.' });
    const onHand = await stockOf(projectId, materialId);
    if (quantity > onHand) return res.status(409).json({ error: `Only ${onHand} ${material.unit} of ${material.name} is in stock at this site.` });
    const issuedOn = req.body?.issuedOn ? new Date(String(req.body.issuedOn)) : new Date();
    if (Number.isNaN(issuedOn.getTime())) return res.status(400).json({ error: 'The date is not valid.' });
    const created = await prisma.materialIssue.create({ data: { projectId, materialId, quantity, purpose, issuedTo: str(req.body?.issuedTo), issuedById: req.auth!.sub, issuedOn } });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

/** The vendors and projects an entry form needs to offer. */
adminMaterialsRouter.get('/lookups', async (_req, res, next) => {
  try {
    const [vendors, projects, materials] = await Promise.all([
      prisma.vendor.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.project.findMany({ select: { id: true, projectName: true }, orderBy: { projectName: 'asc' } }),
      prisma.materialItem.findMany({ orderBy: { name: 'asc' } }),
    ]);
    res.json({ vendors, projects, materials });
  } catch (err) {
    next(err);
  }
});
