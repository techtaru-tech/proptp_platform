import type { Prisma } from '@prisma/client';

/**
 * The lead list's filters, in one place.
 *
 * Both the Leads table and the WhatsApp broadcast audience ask the same question — "which
 * leads match this?" — and they have to agree. A count on the broadcast screen that came from
 * a different where-clause than the list it claims to mirror is worse than no count at all.
 */
export interface LeadFilter {
  search?: string;
  status?: string;
  priority?: string;
  source?: string;
  pipelineId?: string;
  stageId?: string;
  assignedUserId?: string;
  /** hot | warm | cold, or `none` for leads nobody has rated yet. */
  temperature?: string;
  tagId?: string;
  starred?: boolean;
  /** Created between these two dates, inclusive of both. Plain YYYY-MM-DD, read as IST. */
  dateFrom?: string;
  dateTo?: string;
  /** The lead's *newest* activity falls between these two — not merely some activity. */
  lastActivityFrom?: string;
  lastActivityTo?: string;
  /** Meta ad attribution. Matched on the names, which is what a person recognises. */
  campaignName?: string;
  adName?: string;
  /** The Meta lead form. The most specific attribution this account's token can see. */
  formName?: string;
}

/**
 * A date picker sends a bare day; the office reads it in IST. Without the offset these parse
 * as the server's own zone — UTC in production — and a lead created at 2am IST falls into the
 * day before, which is exactly the off-by-one the team keeps reporting.
 */
function startOfDay(day: string): Date {
  return new Date(`${day}T00:00:00.000+05:30`);
}
function endOfDay(day: string): Date {
  return new Date(`${day}T23:59:59.999+05:30`);
}

/** `all` and empty both mean "do not filter on this", which is how the selects send them. */
function chosen(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text && text !== 'all' ? text : undefined;
}

export function buildLeadWhere(filter: LeadFilter): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = {};

  const search = chosen(filter.search);
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
      { id: { contains: search } },
    ];
  }

  const status = chosen(filter.status);
  if (status) where.status = status as Prisma.LeadWhereInput['status'];

  const priority = chosen(filter.priority);
  if (priority) where.priority = priority as Prisma.LeadWhereInput['priority'];

  const source = chosen(filter.source);
  if (source) where.source = source;

  const pipelineId = chosen(filter.pipelineId);
  if (pipelineId) where.pipelineId = pipelineId;

  // `none` is how the Kanban board's Unassigned column asks for leads not yet on a pipeline.
  const stageId = chosen(filter.stageId);
  if (stageId === 'none') where.pipelineStageId = null;
  else if (stageId) where.pipelineStageId = stageId;

  const assignedUserId = chosen(filter.assignedUserId);
  if (assignedUserId === 'none') where.assignedUserId = null;
  else if (assignedUserId) where.assignedUserId = assignedUserId;

  const temperature = chosen(filter.temperature);
  if (temperature === 'none') where.temperature = null;
  else if (temperature === 'hot' || temperature === 'warm' || temperature === 'cold') where.temperature = temperature;

  const tagId = chosen(filter.tagId);
  if (tagId) where.tags = { some: { tagId } };

  if (filter.starred) where.isStarred = true;

  // Campaign is on utmCampaign for every Meta lead ever ingested; the ad name only exists on
  // the ones that arrived after adDetail was added, so it is matched inside that object.
  const campaignName = chosen(filter.campaignName);
  if (campaignName) where.utmCampaign = campaignName;

  const adName = chosen(filter.adName);
  if (adName) where.adDetail = { path: ['adName'], equals: adName };

  const formName = chosen(filter.formName);
  if (formName) where.adDetail = { path: ['formName'], equals: formName };

  const from = chosen(filter.dateFrom);
  const to = chosen(filter.dateTo);
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: startOfDay(from) } : {}),
      // Inclusive of the end date: someone picking a single day means that whole day.
      ...(to ? { lte: endOfDay(to) } : {}),
    };
  }

  const activityFrom = chosen(filter.lastActivityFrom);
  const activityTo = chosen(filter.lastActivityTo);
  if (activityFrom || activityTo) {
    // "Last activity in this window", not "any activity in this window" — which are different
    // questions, and only the first one matches the column the list shows. A lead qualifies
    // when it has an activity inside the window and none after it, so the newest one is the
    // one that landed there. An end date alone still needs `some`, or a lead that has never
    // had any activity would pass on the strength of having nothing after the window.
    const AND: Prisma.LeadWhereInput[] = [];
    AND.push({
      activities: {
        some: {
          createdAt: {
            ...(activityFrom ? { gte: startOfDay(activityFrom) } : {}),
            ...(activityTo ? { lte: endOfDay(activityTo) } : {}),
          },
        },
      },
    });
    if (activityTo) AND.push({ activities: { none: { createdAt: { gt: endOfDay(activityTo) } } } });
    where.AND = AND;
  }

  return where;
}
