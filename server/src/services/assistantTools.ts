import type Anthropic from '@anthropic-ai/sdk';

/**
 * What the assistant can do. Every tool is a thin wrapper over an existing panel endpoint, called
 * with the signed-in person's own token — so the assistant sees and changes exactly what that
 * person could, with the same permissions, validation and audit trail. Nothing here reaches the
 * database directly.
 */

const BASE = `http://127.0.0.1:${process.env.PORT || 4300}/api`;

export class ToolError extends Error {}

async function call(auth: string, method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', authorization: auth }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new ToolError(typeof data === 'object' && data?.error ? (typeof data.error === 'string' ? data.error : data.error.message ?? JSON.stringify(data.error)) : `The panel answered ${res.status}.`);
  return data;
}

const MAX_CHARS = 14_000;
/** A result the model can read: JSON, and never so long it drowns the conversation. */
const out = (data: unknown) => {
  const s = JSON.stringify(data);
  return s.length <= MAX_CHARS ? s : s.slice(0, MAX_CHARS) + ' …[cut: ask for fewer rows or a narrower search]';
};
const take = <T,>(rows: T[] | undefined, n: unknown, dflt = 15, max = 30) => (rows ?? []).slice(0, Math.min(max, Math.max(1, Number(n) || dflt)));
const leadName = (l: any) => `${l.firstName ?? ''} ${l.lastName ?? ''}`.trim();
const leadRow = (l: any) => ({
  id: l.id, name: leadName(l), phone: l.phone, status: l.status, stage: l.stage?.name ?? l.stageName ?? null, source: l.originalSource ?? l.source, temperature: l.temperature ?? null,
  assigned_to: l.assignedUserName ?? l.assignedTo ?? l.assignedUser?.name ?? null, assigned_user_id: l.assignedUserId ?? null, next_follow_up: l.nextFollowUpAt ?? null, created: l.createdAt,
});

type Def = {
  name: string;
  description: string;
  input_schema: Anthropic.Tool['input_schema'];
  /** A tool that changes something. It is never run until a person approves it. */
  write?: boolean;
  /** Short label for the chat ("Looked up overdue instalments"). */
  label: string;
  run: (auth: string, input: any) => Promise<string>;
  /** Plain words for the approval card. */
  describe?: (auth: string, input: any) => Promise<string>;
};

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, properties: properties as never, required, additionalProperties: false });

export const TOOLS: Def[] = [
  {
    name: 'find_users', label: 'Looked up people',
    description: 'Find the staff you may assign leads to or name as a host, by name. Use it to turn a name like "Rakesh" into a user id before assigning. Returns id, name, role.',
    input_schema: obj({ query: { type: 'string', description: 'Part of the name. Leave empty to list everyone.' } }),
    run: async (a, i) => {
      const d = await call(a, 'GET', '/leads/assignees');
      const q = String(i.query ?? '').trim().toLowerCase();
      return out({ can_assign: d.canAssign, users: take((d.users ?? []).filter((u: any) => !q || u.name.toLowerCase().includes(q)).map((u: any) => ({ id: u.id, name: u.name, role: u.role })), 30, 30, 60) });
    },
  },
  {
    name: 'list_projects', label: 'Looked up projects',
    description: 'List the projects (id and name). Use it to find a project id for a site visit, or to match a project name.',
    input_schema: obj({}),
    run: async (a) => out(await call(a, 'GET', '/leads/project-options')),
  },
  {
    name: 'search_leads', label: 'Searched leads',
    description: 'Search the leads this person can see. Filters combine. Returns a page of leads and the total count.',
    input_schema: obj({
      search: { type: 'string', description: 'Name, phone or email.' },
      status: { type: 'string', enum: ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'], description: 'Lead status.' },
      source: { type: 'string', description: 'Lead source key such as meta, web_form, walk_in, referral, channel_partner.' },
      temperature: { type: 'string', enum: ['hot', 'warm', 'cold'] },
      assigned_to_user_id: { type: 'string', description: 'A user id from find_users.' },
      limit: { type: 'integer', description: 'Rows to return, up to 30. Default 15.' },
    }),
    run: async (a, i) => {
      const qs = new URLSearchParams({ pageSize: String(Math.min(30, Math.max(1, Number(i.limit) || 15))) });
      if (i.search) qs.set('search', String(i.search));
      if (i.status) qs.set('status', String(i.status));
      if (i.source) qs.set('source', String(i.source));
      if (i.temperature) qs.set('temperature', String(i.temperature));
      if (i.assigned_to_user_id) qs.set('assignedUserId', String(i.assigned_to_user_id));
      const d = await call(a, 'GET', `/leads?${qs}`);
      return out({ total: d.total, shown: d.items.length, leads: d.items.map(leadRow) });
    },
  },
  {
    name: 'get_lead', label: 'Opened a lead',
    description: 'Everything about one lead: contact, source, stage, owner, interest, notes.',
    input_schema: obj({ lead_id: { type: 'string' } }, ['lead_id']),
    run: async (a, i) => {
      const l = await call(a, 'GET', `/leads/${encodeURIComponent(String(i.lead_id))}`);
      return out({ ...leadRow(l), email: l.email, city: l.city, budget: l.budgetRange, purpose: l.purpose, property_type: l.propertyType, notes: l.notes, deal_value: l.dealValue, original_source: l.originalSource });
    },
  },
  {
    name: 'overdue_followups', label: 'Checked overdue follow-ups',
    description: 'Follow-ups that were due before today and are still open — the leads nobody called back. Newest problem first is not guaranteed; they come oldest due first.',
    input_schema: obj({ assigned_to_user_id: { type: 'string', description: 'Only this person\'s follow-ups.' }, limit: { type: 'integer', description: 'Up to 30. Default 15.' } }),
    run: async (a, i) => {
      const qs = new URLSearchParams({ bucket: 'overdue', pageSize: String(Math.min(30, Math.max(1, Number(i.limit) || 15))) });
      if (i.assigned_to_user_id) qs.set('assignedUserId', String(i.assigned_to_user_id));
      const d = await call(a, 'GET', `/followups?${qs}`);
      return out({ total_overdue: d.total, shown: d.items.length, followups: d.items.map((f: any) => ({ id: f.id, lead_id: f.leadId, lead: f.leadName, title: f.title, due: f.dueAt, priority: f.priority, assigned_user_id: f.assignedUserId })) });
    },
  },
  {
    name: 'overdue_instalments', label: 'Checked overdue instalments',
    description: 'Buyers whose payment instalment is past its due date: buyer, project, what is outstanding, days late and the late-payment penalty so far.',
    input_schema: obj({ limit: { type: 'integer', description: 'Up to 30. Default 15.' } }),
    run: async (a, i) => {
      const d = await call(a, 'GET', '/legal/overdue');
      const rows = [...(d.items ?? [])].sort((x: any, y: any) => y.outstanding - x.outstanding);
      return out({ total_outstanding_overdue: d.total, count: rows.length, shown: take(rows, i.limit).length, instalments: take(rows, i.limit).map((r: any) => ({ buyer: r.buyerName, phone: r.phone, project: r.projectName, milestone: r.milestone, due: r.dueOn, outstanding: r.outstanding, days_overdue: r.daysOverdue, penalty: r.penalty, legal_file_id: r.fileId })) });
    },
  },
  {
    name: 'project_progress', label: 'Checked project progress',
    description: 'Construction progress of a project: planned vs actual, how far behind, and the activities that are behind. Give a project name (part of it is fine) or id. With no name, lists every project with its progress.',
    input_schema: obj({ project: { type: 'string', description: 'Project name or id.' } }),
    run: async (a, i) => {
      const all: any[] = await call(a, 'GET', '/construction/projects');
      const q = String(i.project ?? '').trim().toLowerCase();
      const hits = q ? all.filter((p) => p.id.toLowerCase() === q || p.projectName.toLowerCase().includes(q)) : all;
      if (!q || hits.length !== 1) return out({ projects: hits.map((p) => ({ id: p.id, name: p.projectName, planned_percent: p.planned, actual_percent: p.actual, days_behind: p.daysBehind, activities: p.activities, updates_waiting_review: p.pendingReviews, open_issues: p.openIssues })), note: q && hits.length === 0 ? 'No project matched.' : hits.length > 1 ? 'Several matched; ask which one.' : undefined });
      const d = await call(a, 'GET', `/construction/projects/${encodeURIComponent(hits[0].id)}`);
      const behind = (d.activities ?? []).filter((x: any) => x.daysBehind > 0).sort((x: any, y: any) => y.daysBehind - x.daysBehind);
      return out({ project: d.project?.projectName, planned_percent: d.summary?.planned, actual_percent: d.summary?.actual, days_behind: d.summary?.daysBehind, remaining_percent: d.summary ? Math.max(0, 100 - d.summary.actual) : null, activities_total: d.activities?.length ?? 0, activities_behind: take(behind, 12, 12, 12).map((x: any) => ({ name: x.name, phase: x.phase, block: x.block, planned: x.planned, actual: x.actual, days_behind: x.daysBehind, assignee: x.assigneeName })) });
    },
  },
  {
    name: 'site_visits', label: 'Looked at site visits',
    description: 'Site visits with lead, project, host, time and status (scheduled, completed, cancelled, no_show).',
    input_schema: obj({ limit: { type: 'integer', description: 'Up to 30. Default 15.' } }),
    run: async (a, i) => {
      const d = await call(a, 'GET', '/site-visits');
      const rows = Array.isArray(d) ? d : d.items ?? [];
      return out({ total: rows.length, visits: take(rows, i.limit).map((v: any) => ({ id: v.id, lead_id: v.leadId, lead: v.leadName, project: v.projectName, host: v.hostName, scheduled_at: v.scheduledAt, status: v.status, outcome: v.outcome })) });
    },
  },
  {
    name: 'recent_bookings', label: 'Looked at bookings',
    description: 'Recent bookings: reference, buyer, plot, project, amount, status and which partner made it.',
    input_schema: obj({ limit: { type: 'integer', description: 'Up to 30. Default 10.' } }),
    run: async (a, i) => {
      const d = await call(a, 'GET', `/bookings?pageSize=${Math.min(30, Math.max(1, Number(i.limit) || 10))}`);
      return out({ total: d.total, bookings: d.items.map((b: any) => ({ reference: b.reference, buyer: b.bookingName, plot: b.unitLabel, project: b.projectName, amount: b.amount, status: b.status, partner: b.partnerName, created: b.createdAt })) });
    },
  },
  {
    name: 'dashboard_overview', label: 'Read the dashboard',
    description: 'The management overview: leads by pipeline stage and by source, expected business, bookings pending and confirmed, collections outstanding and overdue, post-sales status, top channel partners.',
    input_schema: obj({}),
    run: async (a) => out(await call(a, 'GET', '/dashboard/management')),
  },

  // -- writes: never run until a person approves them --------------------------------------
  {
    name: 'assign_lead', write: true, label: 'Proposed assigning a lead',
    description: 'Assign one lead to a person (a user id from find_users). A person approves it first.',
    input_schema: obj({ lead_id: { type: 'string' }, user_id: { type: 'string' } }, ['lead_id', 'user_id']),
    describe: async (a, i) => {
      const [l, u] = await Promise.all([call(a, 'GET', `/leads/${encodeURIComponent(i.lead_id)}`).catch(() => null), call(a, 'GET', '/leads/assignees').catch(() => null)]);
      const who = u?.users?.find((x: any) => x.id === i.user_id)?.name ?? i.user_id;
      return `Assign lead “${l ? leadName(l) : i.lead_id}” to ${who}.`;
    },
    run: async (a, i) => { await call(a, 'POST', `/leads/${encodeURIComponent(String(i.lead_id))}/assign`, { userId: String(i.user_id) }); return out({ ok: true }); },
  },
  {
    name: 'schedule_site_visit', write: true, label: 'Proposed a site visit',
    description: 'Schedule a site visit for a lead. scheduled_at is an ISO 8601 time with the +05:30 offset. The host defaults to the lead\'s owner. A person approves it first.',
    input_schema: obj({ lead_id: { type: 'string' }, project_id: { type: 'string', description: 'From list_projects.' }, scheduled_at: { type: 'string', description: 'e.g. 2026-10-09T11:00:00+05:30' }, host_user_id: { type: 'string' }, visitors: { type: 'integer' } }, ['lead_id', 'project_id', 'scheduled_at']),
    describe: async (a, i) => {
      const [l, p] = await Promise.all([call(a, 'GET', `/leads/${encodeURIComponent(i.lead_id)}`).catch(() => null), call(a, 'GET', '/leads/project-options').catch(() => null)]);
      const pn = (Array.isArray(p) ? p : p?.projects ?? []).find((x: any) => x.id === i.project_id)?.projectName ?? i.project_id;
      return `Schedule a site visit for “${l ? leadName(l) : i.lead_id}” at ${pn} on ${new Date(i.scheduled_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}.`;
    },
    run: async (a, i) => out(await call(a, 'POST', '/site-visits', { leadId: i.lead_id, projectId: i.project_id, scheduledAt: i.scheduled_at, hostId: i.host_user_id, visitorCount: i.visitors ?? 1 }).then((v) => ({ ok: true, id: v.id }))),
  },
  {
    name: 'add_follow_up', write: true, label: 'Proposed a follow-up',
    description: 'Add a follow-up reminder on a lead. due_at is ISO 8601 with +05:30. A person approves it first.',
    input_schema: obj({ lead_id: { type: 'string' }, title: { type: 'string' }, due_at: { type: 'string' }, assigned_user_id: { type: 'string' } }, ['lead_id', 'title', 'due_at']),
    describe: async (a, i) => {
      const l = await call(a, 'GET', `/leads/${encodeURIComponent(i.lead_id)}`).catch(() => null);
      return `Add a follow-up “${i.title}” on “${l ? leadName(l) : i.lead_id}”, due ${new Date(i.due_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}.`;
    },
    run: async (a, i) => out(await call(a, 'POST', '/followups', { leadId: i.lead_id, title: i.title, dueAt: i.due_at, assignedUserId: i.assigned_user_id }).then((f) => ({ ok: true, id: f.id }))),
  },
  {
    name: 'add_lead_note', write: true, label: 'Proposed a note',
    description: 'Add a note to a lead. A person approves it first.',
    input_schema: obj({ lead_id: { type: 'string' }, note: { type: 'string' } }, ['lead_id', 'note']),
    describe: async (a, i) => {
      const l = await call(a, 'GET', `/leads/${encodeURIComponent(i.lead_id)}`).catch(() => null);
      return `Add this note to “${l ? leadName(l) : i.lead_id}”: ${String(i.note).slice(0, 200)}`;
    },
    run: async (a, i) => { await call(a, 'POST', `/leads/${encodeURIComponent(String(i.lead_id))}/notes`, { body: String(i.note) }); return out({ ok: true }); },
  },
];

export const toolByName = (name: string) => TOOLS.find((t) => t.name === name);
export const toolSpecs = (): Anthropic.Tool[] => TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
