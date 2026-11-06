import type Anthropic from '@anthropic-ai/sdk';
import { TOOLS, call, leadRow, obj, out, type Def } from './assistantTools';

/**
 * The CRM analyst's tools — read-only, CRM only. Each one calls an existing panel endpoint with
 * the signed-in person's own token, so the analyst sees exactly the leads, calls and team that
 * person may see and nothing else. Nothing here changes data.
 */

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'];
const isoDate = { type: 'string', description: 'A date as YYYY-MM-DD (India time).' };
const lim = (n: unknown, dflt: number, max: number) => String(Math.min(max, Math.max(1, Number(n) || dflt)));

/** The overview is large; the analyst asks for the parts it needs. */
const OVERVIEW_SECTIONS = [
  'kpis', 'period', 'pipeline', 'statuses', 'sources', 'sourceQuality', 'temperature', 'lostReasons', 'trend', 'pending',
  'followUps', 'siteVisits', 'calls', 'team', 'stageMoves', 'responseTime', 'heatmap', 'aging', 'value', 'demand',
  'followUpOnTime', 'visitToBooking', 'forms', 'engagement', 'recentLeads',
] as const;
const DEFAULT_SECTIONS = ['kpis', 'period', 'pipeline', 'statuses', 'sources', 'pending', 'followUps', 'calls', 'team', 'value', 'responseTime', 'visitToBooking'];

const reused = (name: string) => {
  const t = TOOLS.find((x) => x.name === name && !x.write);
  if (!t) throw new Error(`Missing read tool ${name}`);
  return t;
};

export const CRM_TOOLS: Def[] = [
  {
    name: 'crm_overview', label: 'Read the CRM overview',
    description:
      'The CRM in numbers for a lead filter, computed live: KPIs and the previous-period comparison, pipeline stages with values, statuses, sources and source quality (contact/qualify/win rates, first-response time), temperature, lost reasons, daily trend of leads/wins/calls, untouched leads by age, follow-ups (overdue/today/next 7 days, on-time rate), site visits, calls (connected, missed, talk time), per-person team activity, stage moves, speed-to-lead, arrival heatmap (weekday x hour, Mon first), aging of open leads, open pipeline value and expected closures, buyer demand (budgets, property types, cities, projects, locations), forms, automation/email/WhatsApp/AI SDR status and the latest leads. ' +
      'Ask only for the sections you need. Without dates, lead counts are all-time and activity covers the last 30 days. Use this first for any "how are we doing / why / compare / trend" question.',
    input_schema: obj({
      sections: { type: 'array', items: { type: 'string', enum: [...OVERVIEW_SECTIONS] }, description: `Which parts to return. Default: ${DEFAULT_SECTIONS.join(', ')}.` },
      from: isoDate, to: isoDate,
      pipeline_id: { type: 'string', description: 'Only this pipeline (ids from list_pipelines).' },
      stage_id: { type: 'string', description: 'Only leads currently in this stage.' },
      form_name: { type: 'string', description: 'Only leads from this Meta lead form (exact name).' },
      assigned_user_id: { type: 'string', description: 'Only this person\'s leads (ids from find_users), or "unassigned".' },
    }),
    run: async (a, i) => {
      const qs = new URLSearchParams();
      if (i.from) qs.set('from', String(i.from));
      if (i.to) qs.set('to', String(i.to));
      if (i.pipeline_id) qs.set('pipelineId', String(i.pipeline_id));
      if (i.stage_id) qs.set('stageId', String(i.stage_id));
      if (i.form_name) qs.set('formName', String(i.form_name));
      if (i.assigned_user_id) qs.set('assignedUserId', String(i.assigned_user_id));
      const d = await call(a, 'GET', `/reports/crm-overview?${qs}`);
      const wanted: string[] = Array.isArray(i.sections) && i.sections.length ? i.sections : DEFAULT_SECTIONS;
      const picked: Record<string, unknown> = { window: d.window };
      for (const s of wanted) if (s in d) picked[s] = d[s];
      return out(picked, 28_000);
    },
  },
  reused('find_users'),
  {
    name: 'list_pipelines', label: 'Looked up pipelines',
    description: 'Every pipeline with its stages in order (id, name, whether the stage means won or lost). Use it to turn a stage or pipeline name into an id.',
    input_schema: obj({}),
    run: async (a) => {
      const pipelines: any[] = await call(a, 'GET', '/pipelines');
      const withStages = await Promise.all(pipelines.map(async (p) => ({
        id: p.id, name: p.name, is_default: p.isDefault, leads: p._count?.leads,
        stages: ((await call(a, 'GET', `/pipelines/${encodeURIComponent(p.id)}/stages`).catch(() => [])) as any[]).map((s) => ({ id: s.id, name: s.name, won: s.isWon, lost: s.isLost })),
      })));
      return out({ pipelines: withStages });
    },
  },
  reused('list_projects'),
  {
    name: 'search_leads', label: 'Searched leads',
    description: 'Find leads this person can see. Filters combine. Returns a page of leads (newest first unless sorted) and the total that match — use the total for counts.',
    input_schema: obj({
      search: { type: 'string', description: 'Name, phone or email.' },
      status: { type: 'string', enum: LEAD_STATUSES },
      source: { type: 'string', description: 'Source key: meta, web_form, google_ads, whatsapp, manual, referral, walk_in, channel_partner, other…' },
      temperature: { type: 'string', enum: ['hot', 'warm', 'cold', 'none'] },
      stage_id: { type: 'string' },
      pipeline_id: { type: 'string' },
      form_name: { type: 'string', description: 'Exact Meta lead form name.' },
      assigned_to_user_id: { type: 'string', description: 'A user id, or "unassigned".' },
      created_from: isoDate, created_to: isoDate,
      sort: { type: 'string', enum: ['newest', 'oldest', 'deal_value', 'next_follow_up'], description: 'Default newest.' },
      limit: { type: 'integer', description: 'Rows to return, up to 50. Default 20.' },
    }),
    run: async (a, i) => {
      const qs = new URLSearchParams({ pageSize: lim(i.limit, 20, 50) });
      const map: Record<string, string> = { search: 'search', status: 'status', source: 'source', temperature: 'temperature', stage_id: 'stageId', pipeline_id: 'pipelineId', form_name: 'formName', assigned_to_user_id: 'assignedUserId', created_from: 'dateFrom', created_to: 'dateTo' };
      for (const [k, q] of Object.entries(map)) if (i[k]) qs.set(q, String(i[k]));
      const sort = ({ newest: ['createdAt', 'desc'], oldest: ['createdAt', 'asc'], deal_value: ['dealValue', 'desc'], next_follow_up: ['nextFollowUpAt', 'asc'] } as Record<string, string[]>)[String(i.sort ?? 'newest')] ?? ['createdAt', 'desc'];
      qs.set('sortBy', sort[0]); qs.set('sortDir', sort[1]);
      const d = await call(a, 'GET', `/leads?${qs}`);
      return out({ total: d.total, shown: d.items.length, leads: d.items.map((l: any) => ({ ...leadRow(l), deal_value: l.dealValue ?? null, city: l.city ?? null, budget: l.budgetRange ?? null })) });
    },
  },
  {
    name: 'get_lead', label: 'Opened a lead',
    description: 'Everything about one lead: contact, requirement, stage, owner, deal value, plus its recent activity timeline, notes, follow-ups and calls.',
    input_schema: obj({ lead_id: { type: 'string' } }, ['lead_id']),
    run: async (a, i) => {
      const id = encodeURIComponent(String(i.lead_id));
      const [l, acts, notes, fus, calls] = await Promise.all([
        call(a, 'GET', `/leads/${id}`),
        call(a, 'GET', `/leads/${id}/activities`).catch(() => []),
        call(a, 'GET', `/leads/${id}/notes`).catch(() => []),
        call(a, 'GET', `/leads/${id}/followups`).catch(() => []),
        call(a, 'GET', `/calls?leadId=${id}&pageSize=10`).catch(() => ({ items: [] })),
      ]);
      const list = (x: any) => (Array.isArray(x) ? x : x?.items ?? []);
      return out({
        ...leadRow(l), email: l.email, city: l.city, budget: l.budgetRange, purpose: l.purpose, property_type: l.propertyType,
        preferred_locations: l.preferredLocations, deal_value: l.dealValue, expected_close: l.expectedCloseDate, lost_reason: l.lostReason,
        contacted_at: l.contactedAt, ad: l.adDetail ?? null,
        activity: list(acts).slice(0, 15).map((x: any) => ({ at: x.createdAt, type: x.type, what: x.description, by: x.userName })),
        notes: list(notes).slice(0, 8).map((x: any) => ({ at: x.createdAt, by: x.userName, note: x.content ?? x.body ?? x.text })),
        follow_ups: list(fus).slice(0, 8).map((x: any) => ({ title: x.title, due: x.dueAt, status: x.status, done: x.completed })),
        calls: list(calls).slice(0, 10).map((x: any) => ({ at: x.startedAt, direction: x.direction, status: x.status, seconds: x.durationSeconds, agent: x.agentName ?? x.agentUserName ?? null })),
      });
    },
  },
  {
    name: 'follow_ups', label: 'Checked follow-ups',
    description: 'Follow-ups in a bucket: overdue (due before today, still open), today, upcoming, or all. Returns the total in the bucket and a page of rows.',
    input_schema: obj({
      bucket: { type: 'string', enum: ['overdue', 'today', 'upcoming', 'all'] },
      assigned_to_user_id: { type: 'string' },
      limit: { type: 'integer', description: 'Up to 50. Default 20.' },
    }, ['bucket']),
    run: async (a, i) => {
      const qs = new URLSearchParams({ bucket: String(i.bucket), pageSize: lim(i.limit, 20, 50) });
      if (i.assigned_to_user_id) qs.set('assignedUserId', String(i.assigned_to_user_id));
      const d = await call(a, 'GET', `/followups?${qs}`);
      return out({ bucket: i.bucket, total: d.total, shown: d.items.length, follow_ups: d.items.map((f: any) => ({ id: f.id, lead_id: f.leadId, lead: f.leadName, title: f.title, due: f.dueAt, status: f.status, priority: f.priority, assigned_user_id: f.assignedUserId })) });
    },
  },
  reused('site_visits'),
  {
    name: 'call_stats', label: 'Checked calling numbers',
    description: 'Outgoing calls between two dates: dialled, connected and talk seconds — totals and per person, most calls first. Use it for "who is calling enough", connect rates and talk time.',
    input_schema: obj({ from: isoDate, to: isoDate, user_id: { type: 'string', description: 'Only this person.' } }),
    run: async (a, i) => {
      const qs = new URLSearchParams();
      if (i.from) qs.set('from', new Date(`${i.from}T00:00:00+05:30`).toISOString());
      if (i.to) qs.set('to', new Date(`${i.to}T23:59:59+05:30`).toISOString());
      if (i.user_id) qs.set('userId', String(i.user_id));
      return out(await call(a, 'GET', `/calls/stats?${qs}`));
    },
  },
  {
    name: 'recent_calls', label: 'Looked at call history',
    description: 'Call log rows, newest first: lead, agent, direction, status (completed, missed, no_answer…), duration.',
    input_schema: obj({
      direction: { type: 'string', enum: ['incoming', 'outgoing'] },
      status: { type: 'string', description: 'completed, missed, no_answer, busy, failed…' },
      agent_user_id: { type: 'string' },
      limit: { type: 'integer', description: 'Up to 50. Default 20.' },
    }),
    run: async (a, i) => {
      const qs = new URLSearchParams({ pageSize: lim(i.limit, 20, 50) });
      if (i.direction) qs.set('direction', String(i.direction));
      if (i.status) qs.set('status', String(i.status));
      if (i.agent_user_id) qs.set('agentUserId', String(i.agent_user_id));
      const d = await call(a, 'GET', `/calls?${qs}`);
      return out({ total: d.total, calls: d.items.map((c: any) => ({ at: c.startedAt, lead_id: c.leadId, lead: c.leadName ?? null, agent: c.agentName ?? c.agentUserName ?? null, direction: c.direction, status: c.status, seconds: c.durationSeconds })) });
    },
  },
  {
    name: 'team_performance', label: 'Compared the team',
    description: 'Per salesperson for leads created in a date range: leads owned, won, lost, conversion and won value.',
    input_schema: obj({ from: isoDate, to: isoDate }),
    run: async (a, i) => {
      const qs = new URLSearchParams();
      if (i.from) qs.set('from', String(i.from));
      if (i.to) qs.set('to', String(i.to));
      return out(await call(a, 'GET', `/reports/agent-performance-report?${qs}`));
    },
  },
  {
    name: 'source_performance', label: 'Compared lead sources',
    description: 'Per lead source for leads created in a date range: volume, qualification, wins, conversion and value.',
    input_schema: obj({ from: isoDate, to: isoDate }),
    run: async (a, i) => {
      const qs = new URLSearchParams();
      if (i.from) qs.set('from', String(i.from));
      if (i.to) qs.set('to', String(i.to));
      return out(await call(a, 'GET', `/reports/source-performance-report?${qs}`));
    },
  },
];

export const crmToolByName = (name: string) => CRM_TOOLS.find((t) => t.name === name);

/**
 * Tool definitions for a streaming request. `eager_input_streaming` streams each input as it is
 * written; the API then no longer validates it, so `validateInput` checks it before anything runs.
 */
export const crmToolSpecs = (): Anthropic.Beta.BetaTool[] =>
  CRM_TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema, eager_input_streaming: true }) as Anthropic.Beta.BetaTool);

/** Checks a parsed tool input against the tool's schema: required keys, types and enums. */
export function validateInput(def: Def, input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Input must be an object.';
  const schema = def.input_schema as { properties?: Record<string, any>; required?: string[] };
  const props = schema.properties ?? {};
  for (const key of schema.required ?? []) if ((input as any)[key] === undefined) return `Missing "${key}".`;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const p = props[key];
    if (!p) return `Unknown field "${key}".`;
    if (value === null || value === undefined) continue;
    if (p.type === 'string' && typeof value !== 'string') return `"${key}" must be text.`;
    if (p.type === 'integer' && !Number.isInteger(value)) return `"${key}" must be a whole number.`;
    if (p.type === 'array' && !Array.isArray(value)) return `"${key}" must be a list.`;
    if (p.enum && !p.enum.includes(value)) return `"${key}" must be one of ${p.enum.join(', ')}.`;
    if (p.type === 'array' && p.items?.enum) {
      const bad = (value as unknown[]).find((v) => !p.items.enum.includes(v));
      if (bad !== undefined) return `"${key}" has an unknown entry "${String(bad)}".`;
    }
  }
  return null;
}
