import type { PrismaClient, User } from '@prisma/client';

/**
 * Seeds the CRM with demo data: leads and everything that hangs off them — activities,
 * notes, follow-ups, stage and assignment history, tags and custom fields — plus the
 * lead-capture forms, source connections, automations, email sequences, AI SDR agents,
 * call history and WhatsApp threads.
 *
 * The reference data these attach to (pipelines, stages, tags, email templates) is seeded
 * by seed.ts before this runs.
 *
 * **Nothing seeded here is left in a state a background poller will act on.** The engines
 * pick up email-sequence enrollments that are `active` with a due `nextSendAt`, automation
 * runs that are `waiting` with a past `resumeAt`, and follow-up reminders that have not been
 * sent — so enrollments land completed or stopped, runs land success or skipped, and past
 * reminders are stamped as already sent. Demo data that quietly starts mailing real
 * addresses on first boot would be a nasty surprise.
 */

// Deterministic, so re-seeding produces identical rows. A different constant from the other
// seed files, so the two do not draw the same sequence of names.
function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}
const rng = makeRng(20260920);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length) % items.length];
const randInt = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const chance = (p: number) => rng() < p;
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);
const hoursAgo = (n: number) => new Date(Date.now() - n * 3600000);
const daysAhead = (n: number) => new Date(Date.now() + n * 86400000);

const FIRST = ['Rohit', 'Sakshi', 'Imran', 'Tanvi', 'Yash', 'Aarti', 'Naveen', 'Payal', 'Harsh', 'Juhi',
  'Kunal', 'Sonal', 'Mohit', 'Rekha', 'Abhay', 'Nisha', 'Varun', 'Geeta', 'Siddharth', 'Bhavna',
  'Tarun', 'Komal', 'Devendra', 'Ritika', 'Aakash', 'Sneha', 'Pranav', 'Alka', 'Jatin', 'Madhu'];
const LAST = ['Shah', 'Trivedi', 'Kulkarni', 'Menon', 'Bansal', 'Saxena', 'Chopra', 'Dutta', 'Ghosh', 'Kaur',
  'Rathore', 'Sethi', 'Jain', 'Khanna', 'Bose', 'Shetty', 'Tiwari', 'Prasad', 'Mishra', 'Goel'];
const CITIES = ['Surat', 'Ahmedabad', 'Vadodara', 'Rajkot', 'Mumbai', 'Pune', 'Indore', 'Nagpur', 'Jaipur', 'Nashik'];
const COMPANIES = ['Zenith Textiles', 'Orbit Logistics', 'Meridian Exports', 'Skyline Traders', 'Nova Pharma',
  'Quartz Engineering', 'Pinnacle Realty', 'Helios Foods', 'Vertex Systems', 'Aurora Chemicals'];
const JOB_TITLES = ['Proprietor', 'Director', 'Senior Manager', 'Consultant', 'Partner', 'General Manager'];

const PURPOSES = ['Investment', 'Self Use', 'Resale', 'Rental Income', 'Second Home'];
const PROPERTY_TYPES = ['Plot', 'Villa', 'Flat', 'Office', 'Shop', 'Farm Land'];
const BUDGETS = ['Under ₹25 L', '₹25 L – ₹50 L', '₹50 L – ₹1 Cr', '₹1 Cr – ₹2 Cr', 'Above ₹2 Cr'];
const LOCATIONS = ['Vesu', 'Adajan', 'Bopal', 'SG Highway', 'Alkapuri', 'Race Course', 'Baner',
  'Vijay Nagar', 'Manjalpur', 'Katargam', 'Gota', 'Wakad'];

/**
 * The enum KEYS from src/constants/leadSources.ts, not display labels — the panel looks a
 * lead's source up in that map to colour its badge, and an unknown value silently renders
 * as "Other". Weighted so the demo looks like a real funnel rather than an even split.
 */
const SOURCES = ['meta', 'meta', 'meta', 'web_form', 'web_form', 'google_ads', 'whatsapp', 'manual', 'manual', 'other'];

const CAMPAIGNS = ['TechTaru Elysium — Launch', 'Monsoon Plots Offer', 'Vesu Premium Plots', 'NRI Investor Push'];
const ADS = ['Carousel — Plot Sizes', 'Video — Site Walkthrough', 'Single Image — Price Drop', 'Lead Form — Brochure'];
const META_FORMS = ['Brochure Download', 'Site Visit Booking', 'Price List Request'];

const ACTIVITY_TEMPLATES: [string, string][] = [
  ['call', 'Outbound call — discussed plot sizes and payment plan.'],
  ['call', 'Called back after missed call; asked for the brochure on WhatsApp.'],
  ['email', 'Sent the price list and the layout plan.'],
  ['whatsapp', 'Shared site walkthrough video.'],
  ['note', 'Wants a corner plot, willing to wait for the next phase.'],
  ['meeting', 'Site visit done at the Vesu layout.'],
  ['status_change', 'Status moved to Contacted.'],
  ['email', 'Follow-up email — no reply yet.'],
];

const NOTE_TEMPLATES = [
  'Budget is firm. Will not stretch beyond the quoted range.',
  'Decision is with the spouse; wants a joint site visit on a Sunday.',
  'Comparing us with two other layouts on the same road.',
  'Loan pre-approved, so registration can be quick once they pick a plot.',
  'Asked specifically about the RERA number and the JDA approval.',
  'Travelling this month — pick this up after the 20th.',
];

const FOLLOW_UP_TITLES = [
  'Call back with the revised quote',
  'Share the layout plan on WhatsApp',
  'Confirm the Sunday site visit',
  'Send the payment schedule',
  'Check if the loan sanction came through',
  'Reconnect after the festival break',
];

const LOST_REASONS = ['Budget mismatch', 'Bought elsewhere', 'Not responding', 'Location not suitable', 'Postponed the purchase'];

export async function seedCrm(
  prisma: PrismaClient,
  people: { admin: User; agents: User[]; employees: User[]; leaders: User[] }
) {
  const { admin, agents, employees, leaders } = people;
  /**
   * Who can own a lead. This must match `listAssignableUsers()` in the panel
   * (src/services/leadService.ts), which offers employees and leaders only — a lead owned by
   * an agent has an id the panel cannot resolve, and every card renders "Unassigned".
   */
  const owners = [...employees, ...leaders].filter(Boolean);
  if (owners.length === 0) throw new Error('seedCrm needs seeded partners to assign leads to.');

  // Leads are not upsertable (no natural key), so this half runs once.
  if ((await prisma.lead.count()) > 0) {
    console.log('  CRM demo data already present — skipping.');
    return;
  }

  const pipelines = await prisma.pipeline.findMany({ include: { stages: { orderBy: { sortOrder: 'asc' } } } });
  const salesPipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];
  if (!salesPipeline) throw new Error('seedCrm needs the pipelines seeded first.');
  const stages = salesPipeline.stages;
  const tags = await prisma.leadTag.findMany();

  // -------------------------------------------------------------------------
  // Custom fields — the extra columns a sales team always ends up wanting
  // -------------------------------------------------------------------------
  const customFields = [
    { key: 'loan_required', label: 'Loan required', type: 'dropdown', options: ['Yes', 'No', 'Not sure'], sortOrder: 1 },
    { key: 'site_visit_done', label: 'Site visit done', type: 'checkbox', sortOrder: 2 },
    { key: 'preferred_call_time', label: 'Preferred call time', type: 'dropdown', options: ['Morning', 'Afternoon', 'Evening'], sortOrder: 3 },
  ];
  for (const field of customFields) {
    await prisma.leadCustomField.upsert({
      where: { key: field.key },
      update: {},
      create: {
        key: field.key,
        label: field.label,
        type: field.type,
        options: field.options ?? undefined,
        sortOrder: field.sortOrder,
      },
    });
  }
  const fieldByKey = new Map((await prisma.leadCustomField.findMany()).map((f) => [f.key, f]));

  // -------------------------------------------------------------------------
  // Source connections — where leads arrive from
  // -------------------------------------------------------------------------
  const connections = [
    {
      id: 'CONN-META',
      source: 'meta',
      name: 'TechTaru — Facebook Page',
      status: 'connected',
      connectedAccountLabel: 'TechTaru Digital',
      lastReceivedAt: hoursAgo(5),
    },
    {
      id: 'CONN-WEB',
      source: 'web_form',
      name: 'Website — Enquiry Form',
      status: 'connected',
      connectedAccountLabel: 'console.techtaru.com',
      lastReceivedAt: hoursAgo(19),
    },
    {
      id: 'CONN-GADS',
      source: 'google_ads',
      name: 'Google Ads — Lead Form',
      status: 'error',
      connectedAccountLabel: 'TechTaru Search',
      lastError: 'Refresh token expired. Reconnect the account.',
      lastReceivedAt: daysAgo(9),
    },
  ];
  for (const c of connections) {
    // No credentials: those are encrypted at rest by the app layer, and a fake one here
    // would only look like a working integration until somebody tried to use it.
    await prisma.leadSourceConnection.upsert({
      where: { id: c.id },
      update: {},
      create: { ...c, active: c.status !== 'error' },
    });
  }

  // -------------------------------------------------------------------------
  // Leads
  // -------------------------------------------------------------------------
  const LEAD_COUNT = 140;
  const wonStage = stages.find((s) => s.isWon);
  const lostStage = stages.find((s) => s.isLost);
  const openStages = stages.filter((s) => !s.isWon && !s.isLost);
  const stageByName = (needle: string) =>
    openStages.find((s) => s.name.toLowerCase().includes(needle));
  /** Everything from Qualified onwards — a qualified lead can sit in any of them. */
  const qualifiedIndex = openStages.findIndex((s) => s.name.toLowerCase().includes('qualified'));
  const qualifiedStages = qualifiedIndex >= 0 ? openStages.slice(qualifiedIndex) : openStages.slice(2);

  const createdLeads: { id: string; status: string; email: string | null; ownerId: string; createdAt: Date }[] = [];

  for (let i = 0; i < LEAD_COUNT; i += 1) {
    const firstName = pick(FIRST);
    const lastName = pick(LAST);
    const source = pick(SOURCES);
    const createdAt = daysAgo(randInt(0, 120));
    const owner = pick(owners);

    // Status drives the stage, the money fields and the history below, so it is decided first.
    const roll = rng();
    const status = roll < 0.3 ? 'new' : roll < 0.58 ? 'contacted' : roll < 0.78 ? 'qualified' : roll < 0.9 ? 'won' : 'lost';
    // Matched by name so the board's columns agree with the status filter. Qualified leads
    // spread over the later open stages, which is what a real pipeline looks like.
    const stage =
      status === 'won' ? (wonStage ?? pick(stages))
      : status === 'lost' ? (lostStage ?? pick(stages))
      : status === 'qualified' ? pick(qualifiedStages)
      : status === 'contacted' ? (stageByName('contacted') ?? openStages[1] ?? pick(openStages))
      : (stageByName('new') ?? openStages[0] ?? pick(openStages));

    const dealValue = randInt(8, 90) * 100000;
    const isMeta = source === 'meta';

    const lead = await prisma.lead.create({
      data: {
        firstName,
        lastName,
        email: chance(0.85) ? `${firstName}.${lastName}${i}`.toLowerCase() + '@example.com' : null,
        phone: `9${String(600000000 + i * 977).slice(0, 9)}`,
        city: pick(CITIES),
        company: chance(0.4) ? pick(COMPANIES) : null,
        jobTitle: chance(0.35) ? pick(JOB_TITLES) : null,
        purpose: pick(PURPOSES),
        propertyType: pick(PROPERTY_TYPES),
        budgetRange: pick(BUDGETS),
        preferredLocations: chance(0.5) ? [pick(LOCATIONS), pick(LOCATIONS)] : [pick(LOCATIONS)],
        source,
        sourceConnectionId: isMeta ? 'CONN-META' : source === 'web_form' ? 'CONN-WEB' : source === 'google_ads' ? 'CONN-GADS' : null,
        externalLeadId: isMeta ? `lg_${900000000 + i}` : null,
        adDetail: isMeta
          ? {
              campaignName: pick(CAMPAIGNS),
              adName: pick(ADS),
              formName: pick(META_FORMS),
              campaignId: `23${randInt(10000000, 99999999)}`,
              adId: `23${randInt(10000000, 99999999)}`,
            }
          : undefined,
        utmSource: isMeta ? 'facebook' : source === 'google_ads' ? 'google' : source === 'web_form' ? 'direct' : null,
        utmMedium: isMeta || source === 'google_ads' ? 'cpc' : null,
        utmCampaign: isMeta || source === 'google_ads' ? pick(CAMPAIGNS) : null,
        landingPage: source === 'web_form' ? 'https://console.techtaru.com/enquiry' : null,
        status: status as never,
        priority: (chance(0.18) ? 'high' : chance(0.3) ? 'low' : 'normal') as never,
        leadScore: randInt(10, 98),
        isStarred: chance(0.12),
        // Roughly a third of Meta leads land after hours, which is the point of the badge.
        receivedOutsideBusinessHours: isMeta && chance(0.3),
        pipelineId: salesPipeline.id,
        pipelineStageId: stage.id,
        stageEnteredAt: createdAt,
        dealValue,
        dealCurrency: 'INR',
        expectedCloseDate: status === 'won' || status === 'lost' ? null : daysAhead(randInt(5, 75)),
        wonValue: status === 'won' ? dealValue : null,
        wonAt: status === 'won' ? new Date(createdAt.getTime() + randInt(3, 30) * 86400000) : null,
        lostReason: status === 'lost' ? pick(LOST_REASONS) : null,
        lostAt: status === 'lost' ? new Date(createdAt.getTime() + randInt(3, 40) * 86400000) : null,
        assignedUserId: owner.id,
        assignedTo: owner.name,
        contactedAt: status === 'new' ? null : new Date(createdAt.getTime() + randInt(1, 48) * 3600000),
        createdAt,
        updatedAt: createdAt,
      },
    });
    createdLeads.push({ id: lead.id, status, email: lead.email, ownerId: owner.id, createdAt });

    // Tags — most leads carry one or two.
    if (tags.length && chance(0.75)) {
      const chosen = new Set([pick(tags).id, ...(chance(0.4) ? [pick(tags).id] : [])]);
      for (const tagId of chosen) {
        await prisma.leadTagOnLead.create({ data: { leadId: lead.id, tagId } }).catch(() => undefined);
      }
    }

    // Custom values
    if (chance(0.6)) {
      const loan = fieldByKey.get('loan_required');
      if (loan) {
        await prisma.leadCustomValue.create({
          data: { leadId: lead.id, fieldId: loan.id, value: pick(['Yes', 'No', 'Not sure']) },
        });
      }
    }
    if (chance(0.35)) {
      const visit = fieldByKey.get('site_visit_done');
      if (visit) {
        await prisma.leadCustomValue.create({ data: { leadId: lead.id, fieldId: visit.id, value: 'true' } });
      }
    }

    // Activity timeline — every lead has the "created" entry, most have a few more.
    await prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        type: 'created',
        description: `Lead created from ${source}.`,
        userId: admin.id,
        userName: admin.name,
        createdAt,
      },
    });
    const activityCount = status === 'new' ? randInt(0, 1) : randInt(2, 6);
    for (let a = 0; a < activityCount; a += 1) {
      const [type, description] = pick(ACTIVITY_TEMPLATES);
      await prisma.leadActivity.create({
        data: {
          leadId: lead.id,
          type,
          description,
          userId: owner.id,
          userName: owner.name,
          createdAt: new Date(createdAt.getTime() + (a + 1) * randInt(4, 40) * 3600000),
        },
      });
    }

    // Notes
    if (chance(0.45)) {
      await prisma.leadNote.create({
        data: {
          leadId: lead.id,
          userId: owner.id,
          userName: owner.name,
          body: pick(NOTE_TEMPLATES),
          createdAt: new Date(createdAt.getTime() + randInt(2, 60) * 3600000),
        },
      });
    }

    /**
     * Follow-ups.
     *
     * Overdue ones stay `pending` rather than being marked missed: "overdue" on the
     * Follow-ups screen means open and past due, so closing them all would leave its
     * default tab empty, which is not what a real pipeline looks like. They carry a
     * `reminderSentAt` so the reminder poller does not fire a burst of notifications the
     * first time the server starts after seeding.
     */
    if (status !== 'won' && status !== 'lost' && chance(0.55)) {
      const overdue = chance(0.35);
      const dueAt = overdue ? daysAgo(randInt(1, 12)) : daysAhead(randInt(0, 14));
      const completed = overdue && chance(0.35);
      await prisma.leadFollowUp.create({
        data: {
          leadId: lead.id,
          title: pick(FOLLOW_UP_TITLES),
          description: chance(0.4) ? pick(NOTE_TEMPLATES) : null,
          dueAt,
          reminderAt: dueAt,
          reminderSentAt: overdue ? dueAt : null,
          priority: (chance(0.25) ? 'high' : 'normal') as never,
          status: completed ? 'completed' : 'pending',
          assignedUserId: owner.id,
          completed,
          completedAt: completed ? new Date(dueAt.getTime() + 3600000) : null,
          createdAt,
        },
      });
      // Denormalised onto the lead — the Leads list reads this column rather than joining.
      if (!completed) {
        await prisma.lead.update({ where: { id: lead.id }, data: { nextFollowUpAt: dueAt } });
      }
    }

    // Stage history — how it got where it is.
    const path = stages.slice(0, Math.max(1, stages.indexOf(stage) + 1));
    for (let s = 0; s < path.length; s += 1) {
      await prisma.leadStageHistoryEntry.create({
        data: {
          leadId: lead.id,
          fromStageName: s === 0 ? null : path[s - 1].name,
          toStageName: path[s].name,
          actorId: owner.id,
          actorName: owner.name,
          createdAt: new Date(createdAt.getTime() + s * randInt(6, 60) * 3600000),
        },
      });
    }

    // Assignment history. Round-robin automation reads this to find who was assigned least
    // recently, so every lead gets the row that made it theirs.
    await prisma.leadAssignmentHistoryEntry.create({
      data: {
        leadId: lead.id,
        fromUserId: null,
        toUserId: owner.id,
        actorId: admin.id,
        actorName: admin.name,
        createdAt,
      },
    });
    if (chance(0.15)) {
      const reassigned = pick(owners);
      if (reassigned.id !== owner.id) {
        await prisma.leadAssignmentHistoryEntry.create({
          data: {
            leadId: lead.id,
            fromUserId: owner.id,
            toUserId: reassigned.id,
            actorId: admin.id,
            actorName: admin.name,
            createdAt: new Date(createdAt.getTime() + randInt(12, 96) * 3600000),
          },
        });
      }
    }
  }
  console.log(`  leads: ${createdLeads.length}`);

  // -------------------------------------------------------------------------
  // Integration activity — the webhook log behind those leads
  // -------------------------------------------------------------------------
  const metaLeads = createdLeads.slice(0, 25);
  for (const lead of metaLeads) {
    await prisma.integrationActivity.create({
      data: {
        connectionId: 'CONN-META',
        source: 'meta',
        status: 'processed',
        leadId: lead.id,
        leadsCreated: 1,
        rawPayload: { object: 'page', entry: [{ changes: [{ field: 'leadgen' }] }] },
        receivedAt: lead.createdAt,
        processedAt: new Date(lead.createdAt.getTime() + 1200),
      },
    });
  }
  for (let i = 0; i < 4; i += 1) {
    await prisma.integrationActivity.create({
      data: {
        connectionId: 'CONN-GADS',
        source: 'google_ads',
        status: 'failed',
        leadsCreated: 0,
        errorMessage: 'Refresh token expired. Reconnect the account.',
        receivedAt: daysAgo(randInt(1, 9)),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Lead capture forms
  // -------------------------------------------------------------------------
  const forms = [
    {
      id: 'FORM-ENQUIRY',
      name: 'Website Enquiry',
      slug: 'enquiry',
      displayTitle: 'Talk to a TechTaru advisor',
      description: 'Tell us what you are looking for and we will call you back the same day.',
      thankYouMessage: 'Thanks! One of our advisors will call you shortly.',
      isMultiStep: false,
    },
    {
      id: 'FORM-SITEVISIT',
      name: 'Site Visit Booking',
      slug: 'site-visit',
      displayTitle: 'Book a site visit',
      description: 'Pick a day and we will arrange the pickup.',
      thankYouMessage: 'Your site visit request is in. We will confirm the slot on WhatsApp.',
      isMultiStep: true,
    },
    {
      id: 'FORM-BROCHURE',
      name: 'Brochure Download',
      slug: 'brochure',
      displayTitle: 'Download the project brochure',
      description: null,
      thankYouMessage: 'Check your email — the brochure is on its way.',
      isMultiStep: false,
      isActive: false,
    },
  ];
  const FORM_FIELDS: Record<string, { type: string; label: string; fieldKey: string; required?: boolean; step?: number; options?: string[] }[]> = {
    'FORM-ENQUIRY': [
      { type: 'text', label: 'Full name', fieldKey: 'firstName', required: true },
      { type: 'phone', label: 'Mobile number', fieldKey: 'phone', required: true },
      { type: 'email', label: 'Email', fieldKey: 'email' },
      { type: 'dropdown', label: 'Budget', fieldKey: 'budgetRange', options: BUDGETS },
      { type: 'textarea', label: 'What are you looking for?', fieldKey: 'notes' },
    ],
    'FORM-SITEVISIT': [
      { type: 'text', label: 'Full name', fieldKey: 'firstName', required: true, step: 1 },
      { type: 'phone', label: 'Mobile number', fieldKey: 'phone', required: true, step: 1 },
      { type: 'dropdown', label: 'Project', fieldKey: 'purpose', options: ['TechTaru Elysium', 'TechTaru Meridian', 'TechTaru Green Valley'], step: 2 },
      { type: 'date', label: 'Preferred date', fieldKey: 'expectedCloseDate', step: 2 },
    ],
    'FORM-BROCHURE': [
      { type: 'text', label: 'Name', fieldKey: 'firstName', required: true },
      { type: 'email', label: 'Email', fieldKey: 'email', required: true },
    ],
  };

  for (const form of forms) {
    await prisma.leadForm.upsert({
      where: { id: form.id },
      update: {},
      create: {
        ...form,
        isActive: form.isActive ?? true,
        pipelineId: salesPipeline.id,
        pipelineStageId: openStages[0]?.id ?? stages[0].id,
        accentColor: '#007d7d',
        submitLabel: form.isMultiStep ? 'Book my visit' : 'Send enquiry',
      },
    });
    const fields = FORM_FIELDS[form.id] ?? [];
    for (let f = 0; f < fields.length; f += 1) {
      const field = fields[f];
      await prisma.leadFormField.create({
        data: {
          formId: form.id,
          type: field.type,
          label: field.label,
          fieldKey: field.fieldKey,
          placeholder: field.type === 'textarea' ? 'Plot size, location, timeline…' : null,
          required: field.required ?? false,
          step: field.step ?? 1,
          options: field.options ?? undefined,
          sortOrder: f + 1,
        },
      });
    }
  }

  // Submissions, tied to the website leads they produced.
  const webLeads = createdLeads.filter((_, i) => i % 7 === 0).slice(0, 18);
  for (const lead of webLeads) {
    await prisma.leadFormSubmission.create({
      data: {
        formId: chance(0.6) ? 'FORM-ENQUIRY' : 'FORM-SITEVISIT',
        leadId: lead.id,
        data: { firstName: 'See lead', phone: 'See lead', budgetRange: pick(BUDGETS) },
        ipAddress: `49.36.${randInt(1, 254)}.${randInt(1, 254)}`,
        userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36',
        pageUrl: 'https://console.techtaru.com/enquiry',
        createdAt: lead.createdAt,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Automations
  //
  // Only the round-robin one is enabled: it is the one worth demonstrating, and it does
  // something harmless. The rest are left disabled so seeded demo data cannot start
  // emailing or reassigning anything the moment a real lead arrives.
  // -------------------------------------------------------------------------
  const automations = [
    {
      id: 'AUTO-RR',
      name: 'Round-robin new leads',
      description: 'Every new lead goes to whoever was assigned least recently.',
      enabled: true,
      triggerType: 'lead_created',
      steps: [{ type: 'action', config: { action: 'assign', mode: 'round_robin', assignUserIds: owners.slice(0, 6).map((u) => u.id) } }],
    },
    {
      id: 'AUTO-HOT',
      name: 'Tag high-score leads as Hot',
      description: 'Anything scoring above 80 gets the Hot tag and high priority.',
      enabled: false,
      triggerType: 'lead_score_threshold',
      triggerConfig: { threshold: 80 },
      steps: [
        { type: 'condition', config: { field: 'leadScore', operator: 'gte', value: 80 } },
        { type: 'action', config: { action: 'set_priority', priority: 'high' } },
      ],
    },
    {
      id: 'AUTO-STALE',
      name: 'Nudge stale leads',
      description: 'No activity for 7 days — create a follow-up for the owner.',
      enabled: false,
      triggerType: 'no_activity',
      triggerConfig: { days: 7 },
      steps: [
        { type: 'delay', config: { days: 7 } },
        { type: 'action', config: { action: 'create_follow_up', title: 'Reconnect — no activity for a week' } },
      ],
    },
  ];
  for (const auto of automations) {
    const { steps, ...rest } = auto;
    await prisma.automation.upsert({
      where: { id: auto.id },
      update: {},
      create: { ...rest, respectBusinessHours: true, triggerConfig: rest.triggerConfig ?? undefined },
    });
    for (let s = 0; s < steps.length; s += 1) {
      await prisma.automationStep.create({
        data: { automationId: auto.id, type: steps[s].type, sortOrder: s, config: steps[s].config },
      });
    }
  }
  // Runs, all terminal — nothing `waiting` for the resume poller to pick up.
  for (let i = 0; i < 30; i += 1) {
    const lead = pick(createdLeads);
    const outcome = rng();
    await prisma.automationRun.create({
      data: {
        automationId: 'AUTO-RR',
        automationName: 'Round-robin new leads',
        leadId: lead.id,
        status: outcome < 0.8 ? 'success' : outcome < 0.93 ? 'skipped' : 'failed',
        message:
          outcome < 0.8 ? 'Assigned to the next agent in rotation.'
          : outcome < 0.93 ? 'Lead already had an owner.'
          : 'No eligible assignee was available.',
        ranAt: lead.createdAt,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Email sequences — definitions plus finished enrollments
  // -------------------------------------------------------------------------
  const sequence = await prisma.emailSequence.upsert({
    where: { id: 'SEQ-NURTURE' },
    update: {},
    create: {
      id: 'SEQ-NURTURE',
      name: 'New enquiry nurture',
      description: 'Three touches over a week for leads that go quiet after the first call.',
      // Paused rather than active: an active sequence with due enrollments would start
      // sending on the first poller tick.
      status: 'paused',
      stopOnReply: true,
      stopOnWon: true,
    },
  });
  const seqSteps = [
    { sortOrder: 0, delayDays: 0, delayHours: 1, subject: 'Thanks for your interest in TechTaru', body: 'Hi {{lead.first_name}},\n\nThanks for reaching out. Here is the price list and the layout plan.\n\n— TechTaru Digital' },
    { sortOrder: 1, delayDays: 3, delayHours: 0, subject: 'Still looking, {{lead.first_name}}?', body: 'Hi {{lead.first_name}},\n\nJust checking whether you had a chance to look at the layout. Happy to arrange a site visit this weekend.' },
    { sortOrder: 2, delayDays: 7, delayHours: 0, subject: 'Last note from us', body: 'Hi {{lead.first_name}},\n\nWe will stop emailing after this one. If plots are still on your mind later, we are a call away.' },
  ];
  const createdSteps = [];
  for (const step of seqSteps) {
    createdSteps.push(await prisma.emailSequenceStep.create({ data: { sequenceId: sequence.id, ...step } }));
  }

  const enrollable = createdLeads.filter((l) => l.email).slice(0, 20);
  for (const lead of enrollable) {
    const finished = chance(0.6);
    const enrollment = await prisma.emailSequenceEnrollment.create({
      data: {
        sequenceId: sequence.id,
        leadId: lead.id,
        // Terminal states only. `active` with a past nextSendAt is exactly what the poller
        // looks for, and this is demo data pointed at example.com addresses.
        status: finished ? 'completed' : 'stopped',
        currentStep: finished ? seqSteps.length : randInt(1, 2),
        nextSendAt: null,
        completedAt: finished ? daysAgo(randInt(1, 30)) : null,
        stoppedAt: finished ? null : daysAgo(randInt(1, 30)),
        stoppedReason: finished ? null : pick(['Lead replied', 'Lead marked won', 'Stopped by hand']),
        createdAt: lead.createdAt,
      },
    });
    const sent = finished ? seqSteps.length : randInt(1, 2);
    for (let s = 0; s < sent; s += 1) {
      await prisma.emailSequenceSend.create({
        data: {
          enrollmentId: enrollment.id,
          stepId: createdSteps[s].id,
          stepIndex: s,
          subject: createdSteps[s].subject,
          body: createdSteps[s].body,
          status: chance(0.92) ? 'sent' : 'failed',
          message: chance(0.92) ? null : 'Mailbox full',
          sentAt: new Date(lead.createdAt.getTime() + s * 3 * 86400000),
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // AI SDR — one agent, with a handful of conversations
  // -------------------------------------------------------------------------
  const sdrAgent = await prisma.aiSdrAgent.upsert({
    where: { id: 'SDR-QUALIFY' },
    update: {},
    create: {
      id: 'SDR-QUALIFY',
      name: 'Plot enquiry qualifier',
      // Inactive: the engine should not start writing to demo leads on its own.
      active: false,
      goal: 'qualify_lead',
      channel: 'whatsapp',
      persona: 'Polite, brief, never pushy. Speaks in simple English with a little Hindi if the lead does.',
      offerContext: 'TechTaru plots in Surat, Ahmedabad, Vadodara and Rajkot. Sizes 1000–3000 sq ft, JDA and RERA approved.',
      maxFollowUps: 3,
      minHoursBetweenFollowUps: 24,
      respectBusinessHours: true,
      handoffUserId: owners[0]?.id,
      meetingType: 'Site visit',
    },
  });
  for (const lead of createdLeads.slice(30, 42)) {
    const outcome = rng();
    const state = outcome < 0.35 ? 'qualified' : outcome < 0.6 ? 'handed_off' : outcome < 0.85 ? 'exhausted' : 'stopped';
    const enrollment = await prisma.aiSdrEnrollment.create({
      data: {
        agentId: sdrAgent.id,
        leadId: lead.id,
        status: state,
        followUpsSent: randInt(1, 3),
        lastMessageAt: daysAgo(randInt(1, 20)),
        nextEligibleAt: null,
        handedOffAt: state === 'handed_off' ? daysAgo(randInt(1, 15)) : null,
        handedOffToUserId: state === 'handed_off' ? owners[0]?.id : null,
        stoppedReason: state === 'stopped' ? 'Lead asked to stop' : null,
        createdAt: lead.createdAt,
      },
    });
    const script: [string, string, string][] = [
      ['outbound', 'ai', 'Hi! This is TechTaru. You enquired about our plots — may I share the sizes and prices?'],
      ['inbound', 'human', 'Yes please send'],
      ['outbound', 'ai', 'Sizes are 1000 to 3000 sq ft, starting ₹18 L. Which location suits you — Surat or Ahmedabad?'],
      ['inbound', 'human', 'Surat. What is the payment plan?'],
      ['outbound', 'ai', '20% booking, rest in 12 monthly instalments. Shall I arrange a site visit this weekend?'],
    ];
    for (let m = 0; m < script.length; m += 1) {
      const [direction, author, body] = script[m];
      await prisma.aiSdrMessage.create({
        data: {
          enrollmentId: enrollment.id,
          direction,
          channel: 'whatsapp',
          body,
          author,
          status: 'logged',
          createdAt: new Date(lead.createdAt.getTime() + m * randInt(2, 20) * 3600000),
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Call history
  // -------------------------------------------------------------------------
  for (let i = 0; i < 60; i += 1) {
    const lead = pick(createdLeads);
    const agent = pick(owners);
    const incoming = chance(0.6);
    const answered = chance(0.72);
    const duration = answered ? randInt(25, 540) : 0;
    const startedAt = daysAgo(randInt(0, 45));
    await prisma.callLog.create({
      data: {
        requestId: `req_${20260920}_${i}`,
        uniqueId: `call_${20260920}_${i}`,
        direction: incoming ? 'incoming' : 'outgoing',
        status: answered ? 'completed' : chance(0.5) ? 'missed' : 'no_answer',
        callerNumber: incoming ? `9${String(600000000 + i * 977).slice(0, 9)}` : agent.phone,
        agentNumber: agent.phone,
        virtualNumber: '918048123456',
        leadId: lead.id,
        agentUserId: agent.id,
        durationSeconds: duration,
        recordingDurationSeconds: duration,
        feedback: answered && chance(0.3) ? pick(['Interested', 'Call back later', 'Wrong number']) : null,
        startedAt,
        endedAt: answered ? new Date(startedAt.getTime() + duration * 1000) : null,
      },
    });
  }

  // -------------------------------------------------------------------------
  // WhatsApp — one account with threads
  //
  // `active: false` and no access token: the conversations are there to fill the
  // Conversations screen, not to make the panel think it can send.
  // -------------------------------------------------------------------------
  const waAccount = await prisma.whatsAppAccount.upsert({
    where: { id: 'WA-MAIN' },
    update: {},
    create: {
      id: 'WA-MAIN',
      label: 'TechTaru Sales',
      displayPhone: '918048123456',
      phoneNumberId: 'demo-phone-number-id',
      verifyToken: 'demo-verify-token',
      active: false,
      status: 'disconnected',
      lastError: 'No access token configured — this is demo data.',
      createLeadOnInbound: true,
      lastMessageAt: hoursAgo(3),
    },
  });
  const WA_SCRIPT: [string, string][] = [
    ['inbound', 'Hi, saw your ad. Plot price?'],
    ['outbound', 'Hello! Plots start at ₹18 L for 1000 sq ft in Vesu. Shall I send the layout?'],
    ['inbound', 'Yes send'],
    ['outbound', 'Sent on email as well. Would you like to visit the site this Sunday?'],
    ['inbound', 'Let me check and confirm'],
  ];
  for (const lead of createdLeads.slice(50, 64)) {
    const full = await prisma.lead.findUnique({ where: { id: lead.id }, select: { phone: true, firstName: true, lastName: true } });
    if (!full) continue;
    const lastAt = daysAgo(randInt(0, 14));
    const conversation = await prisma.whatsAppConversation.create({
      data: {
        accountId: waAccount.id,
        contactPhone: full.phone,
        contactName: `${full.firstName} ${full.lastName}`.trim(),
        leadId: lead.id,
        assignedUserId: lead.ownerId,
        lastMessageAt: lastAt,
        lastMessagePreview: WA_SCRIPT[WA_SCRIPT.length - 1][1],
        lastInboundAt: lastAt,
        unreadCount: chance(0.4) ? randInt(1, 3) : 0,
        createdAt: lead.createdAt,
      },
    });
    for (let m = 0; m < WA_SCRIPT.length; m += 1) {
      const [direction, body] = WA_SCRIPT[m];
      await prisma.whatsAppMessage.create({
        data: {
          conversationId: conversation.id,
          providerMessageId: `wamid.demo.${conversation.id}.${m}`,
          direction,
          type: 'text',
          body,
          status: direction === 'outbound' ? 'delivered' : 'received',
          sentByUserId: direction === 'outbound' ? lead.ownerId : null,
          sentAt: new Date(lastAt.getTime() - (WA_SCRIPT.length - m) * 900000),
        },
      });
    }
  }

  console.log('  forms, connections, automations, sequences, SDR, calls and WhatsApp threads seeded.');
  void leaders;
}
