import { Router } from 'express';
import { prisma } from '../prisma';
import type { AuthedRequest } from '../services/auth';
import { upload } from '../services/upload';
import { listMyActivities, postProgressUpdate } from './app/construction';
import { makeMaterialEntryHandler, materialPhotoFields } from './materialEntry';

/**
 * What a vendor sees: /api/vendor-portal.
 *
 * Everything is keyed off the signed-in login's own Vendor row, never an id from the request, so
 * there is no parameter a vendor could change to read somebody else's work. Nothing here touches
 * leads, buyers or other vendors; the panel guard also keeps a vendor login to this module alone.
 */
export const vendorPortalRouter = Router();

async function me(req: AuthedRequest) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.auth!.sub } });
  return vendor && vendor.active ? vendor : null;
}

vendorPortalRouter.use(async (req: AuthedRequest, res, next) => {
  try {
    if (!(await me(req))) return res.status(403).json({ error: 'This login is not linked to an active vendor.' });
    next();
  } catch (err) {
    next(err);
  }
});

vendorPortalRouter.get('/me', async (req: AuthedRequest, res, next) => {
  try {
    const v = (await me(req))!;
    const orders = await prisma.workOrder.findMany({ where: { vendorId: v.id }, include: { project: { select: { id: true, projectName: true } }, bills: { select: { amount: true, status: true } } }, orderBy: { createdAt: 'desc' } });
    res.json({
      id: v.id, name: v.name, category: v.category, contractValue: v.contractValue,
      workOrders: orders.map(({ bills, project, ...w }) => ({
        ...w, projectId: project.id, projectName: project.projectName,
        billed: bills.filter((b) => b.status !== 'rejected').reduce((s, b) => s + b.amount, 0),
        paid: bills.filter((b) => b.status === 'paid').reduce((s, b) => s + b.amount, 0),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Progress: the same handlers the site app uses, so the rules (photo stamps, assigned-only,
// offline-safe retry) are one implementation.
vendorPortalRouter.get('/activities', listMyActivities);
vendorPortalRouter.post('/updates', upload.array('photos', 10), postProgressUpdate);
vendorPortalRouter.get('/updates', async (req: AuthedRequest, res, next) => {
  try {
    const rows = await prisma.progressUpdate.findMany({ where: { authorId: req.auth!.sub }, include: { activity: { select: { name: true } } }, orderBy: { capturedAt: 'desc' }, take: 50 });
    res.json({ updates: rows.map((u) => ({ id: u.id, activity: u.activity.name, work_done: u.workDone, percent_complete: u.percentComplete, status: u.status, rejection_reason: u.rejectionReason, captured_at: u.capturedAt.toISOString() })) });
  } catch (err) {
    next(err);
  }
});

// Material: entered under their own vendor id regardless of what the form says.
vendorPortalRouter.post('/materials', materialPhotoFields, makeMaterialEntryHandler({ vendorFromLogin: true }));
vendorPortalRouter.get('/materials', async (req: AuthedRequest, res, next) => {
  try {
    const v = (await me(req))!;
    const rows = await prisma.materialEntry.findMany({ where: { vendorId: v.id }, include: { material: true, project: { select: { projectName: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    res.json(rows.map((e) => ({ id: e.id, projectName: e.project.projectName, material: e.material.name, unit: e.material.unit, quantity: e.quantity, challanNo: e.challanNo, receivedOn: e.receivedOn.toISOString(), status: e.status, rejectionReason: e.rejectionReason })));
  } catch (err) {
    next(err);
  }
});

// Bills against their own work orders.
vendorPortalRouter.get('/bills', async (req: AuthedRequest, res, next) => {
  try {
    const v = (await me(req))!;
    const rows = await prisma.vendorBill.findMany({ where: { vendorId: v.id }, include: { workOrder: { select: { number: true } } }, orderBy: { createdAt: 'desc' } });
    res.json(rows.map(({ workOrder, ...b }) => ({ ...b, workOrderNumber: workOrder.number })));
  } catch (err) {
    next(err);
  }
});

vendorPortalRouter.post('/bills', async (req: AuthedRequest, res, next) => {
  try {
    const v = (await me(req))!;
    const workOrder = await prisma.workOrder.findFirst({ where: { id: String(req.body?.workOrderId ?? ''), vendorId: v.id }, include: { bills: { select: { amount: true, status: true } } } });
    if (!workOrder) return res.status(404).json({ error: 'That work order is not yours.' });
    const amount = Math.round(Number(req.body?.amount));
    const billNumber = String(req.body?.billNumber ?? '').trim();
    const billDate = new Date(String(req.body?.billDate ?? ''));
    if (!billNumber) return res.status(400).json({ error: 'The bill number is required.' });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'The amount must be more than zero.' });
    if (Number.isNaN(billDate.getTime())) return res.status(400).json({ error: 'The bill date is not valid.' });
    const already = workOrder.bills.filter((b) => b.status !== 'rejected').reduce((s, b) => s + b.amount, 0);
    if (already + amount > workOrder.amount) {
      return res.status(409).json({ error: `Bills on ${workOrder.number} would total ₹${already + amount}, more than the work order's ₹${workOrder.amount}.` });
    }
    if (await prisma.vendorBill.findUnique({ where: { vendorId_billNumber: { vendorId: v.id, billNumber } } })) {
      return res.status(409).json({ error: `You already raised a bill numbered ${billNumber}.` });
    }
    const created = await prisma.vendorBill.create({ data: { vendorId: v.id, workOrderId: workOrder.id, billNumber, amount, billDate, fileUrl: req.body?.fileUrl ? String(req.body.fileUrl) : null } });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});
