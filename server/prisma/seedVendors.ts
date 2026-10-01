import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import type { PrismaClient, VendorCategory } from '@prisma/client';

/**
 * Demo vendors, work orders, bills and material. Two vendors have portal logins (password
 * SEED_VENDOR_PASSWORD or Rosium@2026) and are given a couple of construction activities each, so
 * their portal has work in it. Skipped if any vendor exists.
 */
const UPLOAD_DIR = path.resolve(__dirname, '../uploads');
const DAY = 86_400_000;
const day = (n: number) => new Date(Date.now() + n * DAY);

function photo(file: string, label: string) {
  fs.writeFileSync(path.join(UPLOAD_DIR, file), `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#d8d4cc"/><text x="320" y="240" font-family="Arial" font-size="28" text-anchor="middle" fill="#5b5140">${label}</text></svg>`);
  return `/uploads/${file}`;
}

const VENDORS: { name: string; category: VendorCategory; contact: string; phone: string; value: number; login?: string }[] = [
  { name: 'Shree Infra Contractors', category: 'contractor', contact: 'Mahesh Jain', phone: '9811100001', value: 18500000, login: 'shreeinfra@vendor.rosium.in' },
  { name: 'Bharat Cement & Aggregates', category: 'supplier', contact: 'Sunil Gupta', phone: '9811100002', value: 6200000, login: 'bharatcement@vendor.rosium.in' },
  { name: 'Studio Vastu Architects', category: 'architect', contact: 'Neha Kulkarni', phone: '9811100003', value: 2400000 },
  { name: 'TerraCheck Consultants', category: 'consultant', contact: 'Imran Qureshi', phone: '9811100004', value: 850000 },
  { name: 'BrandWave Media', category: 'agency', contact: 'Rhea Dsouza', phone: '9811100005', value: 1200000 },
];

export async function seedVendors(prisma: PrismaClient) {
  if ((await prisma.vendor.count()) > 0) {
    console.log('  vendors already present — skipping.');
    return;
  }
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const projects = await prisma.project.findMany({ orderBy: { id: 'asc' }, take: 2 });
  const staff = (await prisma.user.findFirst({ where: { email: 'gaurav@rosium.in' } })) ?? (await prisma.user.findFirst({ where: { role: 'employee' } }));
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (projects.length === 0 || !staff || !admin) return;

  const role = await prisma.panelRole.upsert({
    where: { name: 'Vendor Portal' }, update: {},
    create: { name: 'Vendor Portal', description: 'A vendor sees only their own work, material and bills.', modules: ['vendor_portal'], isSystem: true },
  });
  const hash = await bcrypt.hash(process.env.SEED_VENDOR_PASSWORD || 'Rosium@2026', 10);

  const made: Record<string, { id: string; userId: string | null }> = {};
  for (const [i, v] of VENDORS.entries()) {
    let userId: string | null = null;
    if (v.login) {
      const code = `SR-VND-${1000 + i}`;
      userId = (await prisma.user.create({
        data: { name: v.name, email: v.login, phone: `98999000${10 + i}`, role: 'vendor', status: 'active', passwordHash: hash, panelRoleId: role.id, partnerCode: code, referralCode: code },
      })).id;
    }
    const vendor = await prisma.vendor.create({
      data: {
        name: v.name, category: v.category, contactPerson: v.contact, phone: v.phone, email: `contact${i + 1}@example.com`, contractValue: v.value,
        address: 'Jaipur, Rajasthan', gstin: `08AAAC${1000 + i}A1Z5`, userId,
        documents: { create: [
          { title: 'Contract agreement', url: photo(`demo-vdoc-${i}-a.svg`, `${v.name} contract`) },
          { title: 'GST certificate', url: photo(`demo-vdoc-${i}-b.svg`, 'GST certificate'), expiresAt: day(i === 1 ? 20 : 300) },
        ] },
      },
    });
    made[v.name] = { id: vendor.id, userId };
  }

  // Give the two portal vendors some of the construction work.
  const contractor = made['Shree Infra Contractors'];
  const supplier = made['Bharat Cement & Aggregates'];
  const acts = await prisma.constructionActivity.findMany({ where: { projectId: projects[0].id }, orderBy: { sortOrder: 'asc' } });
  for (const a of acts.filter((x) => /Road|Drainage/.test(x.name))) await prisma.constructionActivity.update({ where: { id: a.id }, data: { assigneeId: contractor.userId } });

  // Work orders and bills in every state.
  const wo = await prisma.workOrder.create({ data: { number: 'WO-0001-DEM', vendorId: contractor.id, projectId: projects[0].id, description: 'Internal roads and drainage, Blocks A and B', amount: 9000000 } });
  const wo2 = await prisma.workOrder.create({ data: { number: 'WO-0002-DEM', vendorId: supplier.id, projectId: projects[0].id, description: 'Cement and aggregate supply, Phase 1', amount: 3000000 } });
  const bill = (v: string, w: string, n: string, amt: number, status: any, extra: object = {}) =>
    prisma.vendorBill.create({ data: { vendorId: v, workOrderId: w, billNumber: n, amount: amt, billDate: day(-20), status, ...extra } });
  await bill(contractor.id, wo.id, 'SIC/001', 2500000, 'paid', { reviewedById: admin.id, reviewedAt: day(-15), paidAt: day(-10), paymentRef: 'NEFT-884210' });
  await bill(contractor.id, wo.id, 'SIC/002', 1800000, 'approved', { reviewedById: admin.id, reviewedAt: day(-3) });
  await bill(contractor.id, wo.id, 'SIC/003', 900000, 'submitted');
  await bill(supplier.id, wo2.id, 'BCA/11', 400000, 'rejected', { reviewedById: admin.id, reviewedAt: day(-6), rejectionReason: 'Quantity billed does not match verified deliveries.' });

  // Material: verified stock, one pending, one rejected, with issues drawn against it.
  const cement = await prisma.materialItem.create({ data: { name: 'Cement (OPC 53)', unit: 'bags' } });
  const sand = await prisma.materialItem.create({ data: { name: 'River sand', unit: 'tonnes' } });
  let n = 0;
  const entry = async (mat: { id: string }, qty: number, status: any, offset: number, onTime: boolean, extra: object = {}) => {
    n += 1;
    const at = day(offset);
    return prisma.materialEntry.create({
      data: {
        projectId: projects[0].id, materialId: mat.id, vendorId: supplier.id, quantity: qty, challanNo: `CH-${2400 + n}`, vehicleNo: `RJ14GA${3000 + n}`,
        receivedBy: staff.name, receivedOn: at, expectedOn: day(offset + (onTime ? 1 : -2)), createdById: supplier.userId!, status,
        verifiedById: status === 'pending' ? null : admin.id, verifiedAt: status === 'pending' ? null : at,
        photos: { create: ['material', 'challan', 'vehicle'].map((kind) => ({ kind, url: photo(`demo-mat-${n}-${kind}.svg`, `${kind} #${n}`), takenAt: at, latitude: 26.9, longitude: 75.8 })) },
        ...extra,
      },
    });
  };
  await entry(cement, 400, 'verified', -25, true);
  await entry(cement, 300, 'verified', -12, false);
  await entry(sand, 60, 'verified', -9, true);
  await entry(cement, 250, 'pending', -1, true);
  await entry(sand, 40, 'rejected', -5, true, { rejectionReason: 'Load found to be fine sand, not the specified coarse grade.' });
  await prisma.materialIssue.createMany({ data: [
    { projectId: projects[0].id, materialId: cement.id, quantity: 220, purpose: 'Block A kerbing', issuedTo: 'Shree Infra Contractors', issuedById: staff.id, issuedOn: day(-8) },
    { projectId: projects[0].id, materialId: sand.id, quantity: 25, purpose: 'Drainage bedding', issuedTo: 'Shree Infra Contractors', issuedById: staff.id, issuedOn: day(-4) },
  ] });
  console.log('  vendors: 5 (2 with portal logins), 2 work orders, 4 bills, 5 material entries, 2 issues');
}
