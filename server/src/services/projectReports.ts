import { prisma } from '../prisma';
import { projectProgress } from './construction';
import { stockPosition, vendorPerformance } from './material';
import { STAGE_ORDER, complianceStatus, currentStage, milestoneState } from './legal';
import { PLOT_STAGES, isHoldActive, plotStage, propertyStatus } from './derive';
import { getPolicy, penaltyFor } from './salesPolicy';

/**
 * The project and operations reports (Reports → Project reports).
 *
 * Each report is defined once, here, as summary figures plus one or more tables. The screen, the
 * Excel export and the PDF export all render that same object, so a figure on screen and the same
 * figure in a file cannot differ. Every number comes from the same derivations the modules use
 * (progress from approved updates, stock from verified receipts, inventory from unit status and
 * live holds, milestone status from payments and dates), never from a copy kept for reporting.
 */

export interface ReportTable {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  /** Columns holding rupee amounts, so exports can format them. */
  money?: number[];
}
export interface Report {
  key: string;
  title: string;
  description: string;
  summary: { label: string; value: string | number }[];
  tables: ReportTable[];
}
export interface ReportParams {
  projectId?: string;
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const day = (d: Date | null | undefined) => (d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—');
const cap = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const DAY = 86_400_000;

export const REPORT_CATALOGUE: { key: string; title: string; description: string; takesProject: boolean }[] = [
  { key: 'construction-progress', title: 'Construction progress', description: 'Planned against actual, project-wise, block-wise and activity-wise, with days behind.', takesProject: true },
  { key: 'update-compliance', title: 'Daily update compliance', description: 'Who is reporting from site and who has gone quiet, by vendor and by engineer.', takesProject: true },
  { key: 'material-register', title: 'Material register', description: 'Material received with photographs, current site stock and what has been issued.', takesProject: true },
  { key: 'vendor-performance', title: 'Vendor performance & site issues', description: 'On-time delivery, rejections, update discipline and every open site issue.', takesProject: false },
  { key: 'inventory', title: 'Live inventory position', description: 'Available, held, booked and sold plots, by count and by value, for each project.', takesProject: true },
  { key: 'legal-status', title: 'Legal status board', description: 'Agreements by stage, registry by stage, and buyers whose documents are still pending.', takesProject: true },
  { key: 'collections', title: 'Collections vs payment plans', description: 'Due, collected and outstanding against each plan, with overdue ageing.', takesProject: true },
  { key: 'compliance-expiry', title: 'Compliance expiry', description: 'Approvals and documents that are valid, expiring soon or lapsed.', takesProject: true },
];

// ---------------------------------------------------------------------------

async function constructionProgress(p: ReportParams): Promise<Report> {
  const projects = await prisma.project.findMany({ where: p.projectId ? { id: p.projectId } : {}, select: { id: true, projectName: true }, orderBy: { projectName: 'asc' } });
  const projectRows: ReportTable['rows'] = [];
  const blockRows: ReportTable['rows'] = [];
  const activityRows: ReportTable['rows'] = [];
  let behind = 0;
  for (const proj of projects) {
    const pr = await projectProgress(proj.id);
    if (pr.project.activities === 0) continue;
    projectRows.push([proj.projectName, pr.project.activities, `${pr.project.planned}%`, `${pr.project.actual}%`, pr.project.daysBehind]);
    for (const b of pr.blocks) blockRows.push([proj.projectName, b.name || 'No block', b.activities, `${b.planned}%`, `${b.actual}%`, b.daysBehind]);
    for (const a of pr.rows) {
      if (a.progress.daysBehind > 0) behind += 1;
      activityRows.push([proj.projectName, a.block || '—', a.phase || '—', a.name, day(a.plannedStart), day(a.plannedEnd), `${a.progress.planned}%`, `${a.progress.actual}%`, a.progress.daysBehind > 0 ? `${a.progress.daysBehind} days behind` : 'On track']);
    }
  }
  return {
    key: 'construction-progress', title: 'Construction progress against plan', description: 'Actual counts only approved site updates.',
    summary: [{ label: 'Projects with a schedule', value: projectRows.length }, { label: 'Activities', value: activityRows.length }, { label: 'Running behind', value: behind }],
    tables: [
      { title: 'By project', columns: ['Project', 'Activities', 'Planned', 'Actual', 'Days behind (worst)'], rows: projectRows },
      { title: 'By block', columns: ['Project', 'Block', 'Activities', 'Planned', 'Actual', 'Days behind (worst)'], rows: blockRows },
      { title: 'By activity / milestone', columns: ['Project', 'Block', 'Phase', 'Activity', 'Start', 'End', 'Planned', 'Actual', 'Status'], rows: activityRows },
    ],
  };
}

async function updateCompliance(p: ReportParams): Promise<Report> {
  const now = Date.now();
  const acts = await prisma.constructionActivity.findMany({
    where: { ...(p.projectId ? { projectId: p.projectId } : {}), assigneeId: { not: null }, plannedStart: { lte: new Date(now) } },
    include: { assignee: { select: { id: true, name: true, role: true } }, updates: { select: { capturedAt: true, status: true, percentComplete: true } } },
  });
  // Only work still in progress is owed a daily update.
  const running = acts.filter((a) => !a.updates.some((u) => u.status === 'approved' && u.percentComplete >= 100));
  const by = new Map<string, { name: string; kind: string; activities: number; last: number | null; week: number }>();
  for (const a of running) {
    const u = a.assignee!;
    const e = by.get(u.id) ?? { name: u.name, kind: u.role === 'vendor' ? 'Vendor' : 'Engineer', activities: 0, last: null, week: 0 };
    e.activities += 1;
    for (const up of a.updates) {
      const t = up.capturedAt.getTime();
      if (e.last === null || t > e.last) e.last = t;
      if (t >= now - 7 * DAY) e.week += 1;
    }
    by.set(u.id, e);
  }
  const rows = [...by.values()].map((e) => {
    const silent = e.last === null ? null : Math.floor((now - e.last) / DAY);
    const status = silent === null ? 'Never reported' : silent <= 2 ? 'Reporting' : silent <= 7 ? 'Late' : 'Not reporting';
    return { e, silent, status };
  }).sort((a, b) => (b.silent ?? 9999) - (a.silent ?? 9999));
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  return {
    key: 'update-compliance', title: 'Daily update compliance', description: 'Reporting = an update in the last 2 days; late = 3–7 days; not reporting = more than 7 days.',
    summary: [{ label: 'People owed updates', value: rows.length }, { label: 'Reporting', value: count('Reporting') }, { label: 'Late', value: count('Late') }, { label: 'Not reporting / never', value: count('Not reporting') + count('Never reported') }],
    tables: [{ title: 'By person', columns: ['Name', 'Role', 'Active activities', 'Updates in 7 days', 'Last update', 'Days silent', 'Status'], rows: rows.map(({ e, silent, status }) => [e.name, e.kind, e.activities, e.week, e.last ? day(new Date(e.last)) : 'Never', silent ?? '—', status]) }],
  };
}

async function materialRegister(p: ReportParams): Promise<Report> {
  const [entries, stock, issues] = await Promise.all([
    prisma.materialEntry.findMany({ where: p.projectId ? { projectId: p.projectId } : {}, include: { material: true, vendor: { select: { name: true } }, project: { select: { projectName: true } }, photos: { select: { id: true } } }, orderBy: { receivedOn: 'desc' }, take: 500 }),
    stockPosition(p.projectId),
    prisma.materialIssue.findMany({ where: p.projectId ? { projectId: p.projectId } : {}, include: { material: true, project: { select: { projectName: true } } }, orderBy: { issuedOn: 'desc' }, take: 500 }),
  ]);
  return {
    key: 'material-register', title: 'Material received, stock and consumption', description: 'Stock counts verified receipts only.',
    summary: [{ label: 'Entries', value: entries.length }, { label: 'Awaiting verification', value: entries.filter((e) => e.status === 'pending').length }, { label: 'Rejected', value: entries.filter((e) => e.status === 'rejected').length }, { label: 'Materials in stock', value: stock.filter((s) => s.inStock > 0).length }],
    tables: [
      { title: 'Current site stock', columns: ['Site', 'Material', 'Received', 'Issued', 'In stock', 'Unit'], rows: stock.map((s) => [s.projectName, s.material, s.received, s.issued, s.inStock, s.unit]) },
      { title: 'Received register', columns: ['Received on', 'Site', 'Material', 'Quantity', 'Unit', 'Vendor', 'Challan', 'Vehicle', 'Photos', 'Status'], rows: entries.map((e) => [day(e.receivedOn), e.project.projectName, e.material.name, e.quantity, e.material.unit, e.vendor?.name ?? '—', e.challanNo, e.vehicleNo, e.photos.length, cap(e.status)]) },
      { title: 'Consumption (issued for work)', columns: ['Date', 'Site', 'Material', 'Quantity', 'Unit', 'Used for', 'Issued to'], rows: issues.map((i) => [day(i.issuedOn), i.project.projectName, i.material.name, i.quantity, i.material.unit, i.purpose, i.issuedTo ?? '—']) },
    ],
  };
}

async function vendorPerf(): Promise<Report> {
  const vendors = await prisma.vendor.findMany({ orderBy: { name: 'asc' } });
  const perf = await Promise.all(vendors.map(async (v) => ({ v, p: await vendorPerformance(v) })));
  const issues = await prisma.siteIssue.findMany({ where: { status: { not: 'closed' } }, include: { project: { select: { projectName: true } }, owner: { select: { name: true } } }, orderBy: { dueDate: 'asc' } });
  const pct = (n: number | null) => (n === null ? '—' : `${n}%`);
  const overdue = issues.filter((i) => i.dueDate && i.dueDate.getTime() < Date.now()).length;
  return {
    key: 'vendor-performance', title: 'Vendor performance and open site issues', description: 'Performance is computed from deliveries, reviews and updates actually recorded.',
    summary: [{ label: 'Vendors', value: vendors.length }, { label: 'Open site issues', value: issues.length }, { label: 'Overdue issues', value: overdue }],
    tables: [
      { title: 'Vendors', columns: ['Vendor', 'Category', 'Deliveries', 'On-time', 'Rejected', 'Open issues', 'Update discipline'], rows: perf.map(({ v, p }) => [v.name, cap(v.category), p.deliveries, pct(p.onTimePct), pct(p.rejectionPct), p.pendingIssues, pct(p.updateDisciplinePct)]) },
      { title: 'Open site issues', columns: ['Project', 'Issue', 'Owner', 'Due', 'Status'], rows: issues.map((i) => [i.project.projectName, i.title, i.owner?.name ?? 'Nobody yet', day(i.dueDate), i.dueDate && i.dueDate.getTime() < Date.now() ? 'Overdue' : cap(i.status)]) },
    ],
  };
}

async function inventory(p: ReportParams): Promise<Report> {
  const projects = await prisma.project.findMany({ where: p.projectId ? { id: p.projectId } : {}, include: { units: { select: { id: true, bookingStatus: true, totalInvestmentAmount: true } } }, orderBy: { projectName: 'asc' } });
  const holds = await prisma.plotHold.findMany({ where: { status: 1, holdEnd: { gt: new Date() } }, select: { unitId: true, status: true, holdEnd: true } });
  const held = new Set(holds.filter((h) => isHoldActive(h)).map((h) => h.unitId));
  const policy = await getPolicy();
  const liveBookings = await prisma.booking.findMany({
    where: { propertyId: { in: projects.flatMap((p) => p.units.map((u) => u.id)) }, isDeposit: 0, status: { not: 'cancelled' } },
    include: { legalFile: { include: { stages: { select: { id: true } }, registry: { select: { status: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  const bookingOf = new Map<string, (typeof liveBookings)[number]>();
  for (const b of liveBookings) if (!bookingOf.has(b.propertyId)) bookingOf.set(b.propertyId, b);
  const stageRows: ReportTable['rows'] = [];
  const zero = () => ({ available: 0, onHold: 0, booked: 0, soldOut: 0 });
  const tot = { c: zero(), v: zero() };
  const rows: ReportTable['rows'] = [];
  const valueRows: ReportTable['rows'] = [];
  for (const proj of projects) {
    const c = zero(); const v = zero();
    for (const u of proj.units) { const s = propertyStatus(u, held.has(u.id)); c[s] += 1; v[s] += u.totalInvestmentAmount; }
    (Object.keys(c) as (keyof typeof c)[]).forEach((k) => { tot.c[k] += c[k]; tot.v[k] += v[k]; });
    const st = Object.fromEntries(PLOT_STAGES.map((s) => [s, 0])) as Record<(typeof PLOT_STAGES)[number], number>;
    for (const u of proj.units) st[plotStage(u, held.has(u.id), bookingOf.get(u.id), policy.showTokenStage)] += 1;
    stageRows.push([proj.projectName, proj.units.length, ...PLOT_STAGES.map((s) => st[s])]);
    rows.push([proj.projectName, proj.units.length, c.available, c.onHold, c.booked, c.soldOut]);
    valueRows.push([proj.projectName, v.available, v.onHold, v.booked, v.soldOut, v.available + v.onHold + v.booked + v.soldOut]);
  }
  return {
    key: 'inventory', title: 'Live inventory position', description: 'Read from the same plot status the plot map shows, including live holds.',
    summary: [{ label: 'Available', value: tot.c.available }, { label: 'Held', value: tot.c.onHold }, { label: 'Booked', value: tot.c.booked }, { label: 'Sold', value: tot.c.soldOut }, { label: 'Available value', value: inr(tot.v.available) }],
    tables: [
      { title: 'By stage (hold → token → booked → agreement → registered)', columns: ['Project', 'Total plots', ...PLOT_STAGES.map(cap)], rows: stageRows },
      { title: 'By count', columns: ['Project', 'Total plots', 'Available', 'Held', 'Booked', 'Sold'], rows },
      { title: 'By value (₹)', columns: ['Project', 'Available', 'Held', 'Booked', 'Sold', 'Total'], rows: valueRows, money: [1, 2, 3, 4, 5] },
    ],
  };
}

async function legalStatus(p: ReportParams): Promise<Report> {
  const files = await prisma.legalFile.findMany({ where: p.projectId ? { projectId: p.projectId } : {}, include: { project: { select: { projectName: true } }, stages: true, registry: true, documents: { select: { kind: true } } } });
  const byProject = new Map<string, typeof files>();
  files.forEach((f) => byProject.set(f.project.projectName, [...(byProject.get(f.project.projectName) ?? []), f]));
  const stageRows = [...byProject.entries()].map(([name, fs]) => [name, fs.length, fs.filter((f) => !currentStage(f.stages)).length, ...STAGE_ORDER.map((s) => fs.filter((f) => currentStage(f.stages) === s).length)]);
  const REG = ['pending', 'documents_in_preparation', 'stamp_duty_paid', 'appointment_booked', 'registered'];
  const regRows = [...byProject.entries()].map(([name, fs]) => [name, ...REG.map((r) => fs.filter((f) => (f.registry?.status ?? 'pending') === r).length)]);
  const pending = files.filter((f) => !f.documents.some((d) => d.kind === 'kyc'));
  return {
    key: 'legal-status', title: 'Legal status board', description: 'Pending documents = buyers with no KYC document on their file.',
    summary: [{ label: 'Legal files', value: files.length }, { label: 'Agreement not started', value: files.filter((f) => !currentStage(f.stages)).length }, { label: 'Registered', value: files.filter((f) => f.registry?.status === 'registered').length }, { label: 'Buyers with KYC pending', value: pending.length }],
    tables: [
      { title: 'Agreements by stage', columns: ['Project', 'Files', 'Not started', ...STAGE_ORDER.map(cap)], rows: stageRows },
      { title: 'Registry by stage', columns: ['Project', ...REG.map(cap)], rows: regRows },
      { title: 'Documents pending from buyers', columns: ['Buyer', 'Phone', 'Project', 'Missing'], rows: pending.map((f) => [f.buyerName, f.phone, f.project.projectName, 'KYC documents']) },
    ],
  };
}

async function collections(p: ReportParams): Promise<Report> {
  const files = await prisma.legalFile.findMany({ where: p.projectId ? { projectId: p.projectId } : {}, include: { project: { select: { projectName: true } }, milestones: { include: { payments: true } } } });
  const policy = await getPolicy();
  let penaltyTotal = 0;
  const today = Date.now();
  const proj = new Map<string, { due: number; collected: number; outstanding: number; plans: number }>();
  const age = { '1–30 days': 0, '31–60 days': 0, '61–90 days': 0, 'Over 90 days': 0 };
  const items: ReportTable['rows'] = [];
  let planTotal = 0; let collectedTotal = 0; let overdueTotal = 0;
  for (const f of files) {
    if (f.milestones.length === 0) continue;
    const e = proj.get(f.project.projectName) ?? { due: 0, collected: 0, outstanding: 0, plans: 0 };
    e.plans += 1;
    for (const m of f.milestones) {
      const s = milestoneState(m);
      planTotal += m.amount; collectedTotal += s.paid; e.collected += s.paid;
      if (m.dueOn.getTime() <= today) e.due += m.amount;
      if (s.status === 'overdue') {
        e.outstanding += s.outstanding; overdueTotal += s.outstanding;
        const k = s.daysOverdue <= 30 ? '1–30 days' : s.daysOverdue <= 60 ? '31–60 days' : s.daysOverdue <= 90 ? '61–90 days' : 'Over 90 days';
        age[k] += s.outstanding;
        const pen = penaltyFor(policy, { outstanding: s.outstanding, instalment: m.amount, daysOverdue: s.daysOverdue });
        penaltyTotal += pen;
        items.push([f.buyerName, f.phone, f.project.projectName, m.name, day(m.dueOn), s.daysOverdue, s.outstanding, pen]);
      }
    }
    proj.set(f.project.projectName, e);
  }
  items.sort((a, b) => Number(b[5]) - Number(a[5]));
  return {
    key: 'collections', title: 'Collections against payment plans', description: 'Overdue = past its due date with an amount still outstanding.',
    summary: [{ label: 'Planned', value: inr(planTotal) }, { label: 'Collected', value: inr(collectedTotal) }, { label: 'Overdue', value: inr(overdueTotal) }, { label: 'Penalty accrued', value: inr(penaltyTotal) }, { label: 'Buyers overdue', value: new Set(items.map((i) => i[1])).size }],
    tables: [
      { title: 'By project', columns: ['Project', 'Plans', 'Due to date', 'Collected', 'Overdue'], rows: [...proj.entries()].map(([n, e]) => [n, e.plans, e.due, e.collected, e.outstanding]), money: [2, 3, 4] },
      { title: 'Overdue ageing', columns: ['Age', 'Outstanding'], rows: Object.entries(age), money: [1] },
      { title: 'Overdue instalments', columns: ['Buyer', 'Phone', 'Project', 'Milestone', 'Due', 'Days overdue', 'Outstanding', 'Penalty'], rows: items, money: [6, 7] },
    ],
  };
}

async function complianceExpiry(p: ReportParams): Promise<Report> {
  const [approvals, docs] = await Promise.all([
    prisma.projectApproval.findMany({ where: p.projectId ? { projectId: p.projectId } : {}, include: { project: { select: { projectName: true } } } }),
    p.projectId ? Promise.resolve([]) : prisma.vendorDocument.findMany({ where: { expiresAt: { not: null } }, include: { vendor: { select: { name: true } } } }),
  ]);
  const items = [
    ...approvals.map((a) => ({ what: a.kind, who: a.project.projectName, ref: a.referenceNo, until: a.validUntil, ...complianceStatus(a.validUntil) })),
    ...docs.map((d) => ({ what: d.title, who: `${d.vendor.name} (vendor)`, ref: '—', until: d.expiresAt, ...complianceStatus(d.expiresAt) })),
  ].sort((a, b) => (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999));
  const n = (...s: string[]) => items.filter((i) => s.includes(i.status)).length;
  return {
    key: 'compliance-expiry', title: 'Compliance expiry', description: 'Soonest to lapse first.',
    summary: [{ label: 'Valid', value: n('valid', 'no_expiry') }, { label: 'Expiring in 90 days', value: n('expires_90', 'expires_60', 'expires_30') }, { label: 'Within 30 days', value: n('expires_30') }, { label: 'Lapsed', value: n('lapsed') }],
    tables: [{ title: 'Approvals and documents', columns: ['Item', 'For', 'Reference', 'Valid until', 'Days left', 'Status'], rows: items.map((i) => [i.what, i.who, i.ref, i.until ? day(i.until) : 'No expiry', i.daysLeft ?? '—', cap(i.status)]) }],
  };
}

const BUILDERS: Record<string, (p: ReportParams) => Promise<Report>> = {
  'construction-progress': constructionProgress,
  'update-compliance': updateCompliance,
  'material-register': materialRegister,
  'vendor-performance': () => vendorPerf(),
  inventory,
  'legal-status': legalStatus,
  collections,
  'compliance-expiry': complianceExpiry,
};

export function hasReport(key: string) {
  return key in BUILDERS;
}
export function buildReport(key: string, params: ReportParams): Promise<Report> {
  return BUILDERS[key](params);
}
