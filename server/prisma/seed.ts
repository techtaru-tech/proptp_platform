import { PrismaClient } from '@prisma/client';
import { seedPlatform } from './seedPlatform';
import { seedOperations } from './seedOperations';

const prisma = new PrismaClient();

/**
 * Seeds pipelines/stages/tags using the EXACT same IDs as the frontend's static mock reference
 * data (src/data/mockPipelines.ts). The frontend still resolves pipeline/stage/tag names, colors
 * and won/lost flags from that static module everywhere (stageById(), tagsByIds(), the Add/Edit
 * Lead form's dropdowns, the Pipeline board's columns) — only the Lead rows themselves now come
 * from this database. Keeping the IDs identical means a lead's `pipelineId`/`pipelineStageId`/
 * `tagIds` written by either side always resolves correctly on the other.
 */
async function main() {
  const salesPipeline = await prisma.pipeline.upsert({
    where: { id: 'PPL-SALES' },
    update: {},
    create: {
      id: 'PPL-SALES',
      name: 'Sales Pipeline',
      description: 'Primary pipeline for inbound property-buyer leads.',
      isDefault: true,
      stages: {
        create: [
          { id: 'STG-SALES-1', name: 'New Lead', color: '#6366f1', sortOrder: 1 },
          { id: 'STG-SALES-2', name: 'Contacted', color: '#3b82f6', sortOrder: 2 },
          { id: 'STG-SALES-3', name: 'Qualified', color: '#f59e0b', sortOrder: 3 },
          { id: 'STG-SALES-4', name: 'Proposal Sent', color: '#8b5cf6', sortOrder: 4 },
          { id: 'STG-SALES-5', name: 'Negotiation', color: '#ec4899', sortOrder: 5 },
          { id: 'STG-SALES-6', name: 'Won', color: '#22c55e', sortOrder: 6, isWon: true, winProbability: 100 },
          { id: 'STG-SALES-7', name: 'Lost', color: '#ef4444', sortOrder: 7, isLost: true, winProbability: 0 },
        ],
      },
    },
  });

  await prisma.pipeline.upsert({
    where: { id: 'PPL-ONBOARD' },
    update: {},
    create: {
      id: 'PPL-ONBOARD',
      name: 'Onboarding',
      description: 'Post-sale onboarding for won customers.',
      stages: {
        create: [
          { id: 'STG-ONB-1', name: 'Welcome', color: '#6366f1', sortOrder: 1 },
          { id: 'STG-ONB-2', name: 'Setup Call', color: '#3b82f6', sortOrder: 2 },
          { id: 'STG-ONB-3', name: 'Configuration', color: '#f59e0b', sortOrder: 3 },
          { id: 'STG-ONB-4', name: 'Training', color: '#8b5cf6', sortOrder: 4 },
          { id: 'STG-ONB-5', name: 'Active', color: '#22c55e', sortOrder: 5, isWon: true, winProbability: 100 },
        ],
      },
    },
  });

  await prisma.pipeline.upsert({
    where: { id: 'PPL-PARTNER' },
    update: {},
    create: {
      id: 'PPL-PARTNER',
      name: 'Partnership Pipeline',
      description: 'Channel partner and referral-source inquiries.',
      stages: {
        create: [
          { id: 'STG-PART-1', name: 'Inquiry', color: '#6366f1', sortOrder: 1 },
          { id: 'STG-PART-2', name: 'Evaluation', color: '#f59e0b', sortOrder: 2 },
          { id: 'STG-PART-3', name: 'Terms Discussion', color: '#8b5cf6', sortOrder: 3 },
          { id: 'STG-PART-4', name: 'Agreement', color: '#22c55e', sortOrder: 4, isWon: true, winProbability: 100 },
          { id: 'STG-PART-5', name: 'Declined', color: '#ef4444', sortOrder: 5, isLost: true, winProbability: 0 },
        ],
      },
    },
  });

  const tags = [
    ['Hot Lead', '#ef4444'], ['Cold Lead', '#64748b'], ['Warm Lead', '#f59e0b'], ['VIP', '#8b5cf6'],
    ['Follow-up', '#3b82f6'], ['Nurture', '#06b6d4'], ['High Budget', '#22c55e'], ['Enterprise', '#6366f1'],
    ['SMB', '#84cc16'], ['Referral', '#ec4899'], ['Re-engaged', '#14b8a6'], ['Decision Maker', '#a855f7'],
    ['Urgent', '#dc2626'], ['Demo Requested', '#0ea5e9'], ['Price Sensitive', '#eab308'],
  ] as const;

  for (let i = 0; i < tags.length; i++) {
    const [name, color] = tags[i];
    const id = `TAG-${i + 1}`;
    await prisma.leadTag.upsert({ where: { id }, update: {}, create: { id, name, color } });
  }

  console.log(`Seeded pipelines (default: ${salesPipeline.name}) and ${tags.length} tags.`);

  // Starter email templates. Sequence steps load from these to prefill a subject and body;
  // the step then keeps its own copy, so editing a template never rewrites a live sequence.
  const templates: [string, string, string][] = [
    [
      'Follow-up — no reply',
      'Following up, {{lead.first_name}}',
      'Hi {{lead.first_name}},\n\nJust checking in to see if you had any questions about our last conversation.',
    ],
    [
      'Introduction',
      'Great to connect, {{lead.first_name}}',
      'Hi {{lead.first_name}},\n\nThanks for your interest in Rosium Developers. I would love to understand what you are looking for so I can point you at the right project.',
    ],
    [
      'Site visit invitation',
      'Would you like to visit the site, {{lead.first_name}}?',
      'Hi {{lead.first_name}},\n\nWe run guided site visits over the weekend. Tell me a day that suits you and I will reserve a slot.',
    ],
    [
      'Last touch before closing the file',
      'Should I close your file, {{lead.first_name}}?',
      'Hi {{lead.first_name}},\n\nI have not heard back, so I will assume the timing is not right. If that changes, just reply to this email and I will pick it straight back up.',
    ],
  ];
  for (const [name, subject, body] of templates) {
    await prisma.emailTemplate.upsert({ where: { name }, update: {}, create: { name, subject, body } });
  }
  console.log(`Seeded ${templates.length} email templates.`);

  // Rosium operations + HRMS + partner app share this database, so they seed here too.
  console.log('Seeding platform (users, teams, projects, plots, lookups)...');
  const people = await seedPlatform(prisma);
  console.log('Seeding operations (bookings, attendance, payouts, tickets, notifications)...');
  await seedOperations(prisma, people);

  console.log('');
  console.log('Done. Admin sign-in:');
  console.log(`  email:    ${people.adminEmail}`);
  console.log(`  password: ${people.adminPassword}`);
  console.log('Partner app sign-in: any seeded partner phone + the dev_otp returned by POST /api/v1/app/auth/otp.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
