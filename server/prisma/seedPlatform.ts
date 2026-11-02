import type { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Seeds the Propto operations + HRMS + partner-app side of the shared database:
 * one admin, a partner hierarchy, lookup tables, projects with plots, bookings with their
 * ledger side effects, attendance history, payouts, tickets and notifications.
 *
 * Idempotent: every write is keyed on a deterministic id or a natural unique key, so
 * running it twice changes nothing. That matters because it runs alongside the CRM seed.
 */

// A tiny deterministic PRNG, so re-seeding produces identical data.
function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}
const rng = makeRng(20260909);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length) % items.length];
const randInt = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);

const FIRST = ['Rohan', 'Priya', 'Amit', 'Sneha', 'Vikram', 'Ananya', 'Rahul', 'Pooja', 'Karan', 'Isha',
  'Sanjay', 'Neha', 'Arjun', 'Divya', 'Manoj', 'Ritu', 'Suresh', 'Kavita', 'Deepak', 'Meera',
  'Nikhil', 'Shreya', 'Ajay', 'Swati', 'Rakesh', 'Anjali', 'Vivek', 'Preeti', 'Gaurav', 'Nidhi'];
const LAST = ['Sharma', 'Verma', 'Gupta', 'Patel', 'Singh', 'Mehta', 'Joshi', 'Reddy', 'Iyer', 'Nair',
  'Kapoor', 'Malhotra', 'Chauhan', 'Bhatt', 'Agarwal', 'Rao', 'Desai', 'Pillai', 'Kulkarni', 'Yadav'];
const CITIES = ['Surat', 'Ahmedabad', 'Vadodara', 'Rajkot', 'Mumbai', 'Pune', 'Indore', 'Nagpur'];

const AMENITIES = ['Clubhouse', 'Swimming Pool', 'Gymnasium', 'Landscaped Garden', 'Children Play Area',
  'Covered Parking', '24x7 Security', 'Power Backup', 'Rainwater Harvesting', 'Jogging Track',
  'Indoor Games', 'Amphitheater'];
const PROPERTY_TYPES = ['Plot', 'Villa', 'Flat', 'Office', 'Shop', 'Farm Land'];
const ADDRESSES = ['Vesu', 'Adajan', 'Bopal', 'SG Highway', 'Alkapuri', 'Race Course', 'Baner',
  'Vijay Nagar', 'Manjalpur', 'Katargam', 'Gota', 'Wakad'];

const PROJECTS = [
  ['Propto Elysium', 'Vesu, Surat', 'residential'],
  ['Propto Meridian', 'Adajan, Surat', 'residential'],
  ['Propto Orchid Residency', 'Bopal, Ahmedabad', 'residential'],
  ['Propto Business Hub', 'SG Highway, Ahmedabad', 'commercial'],
  ['Propto Riverside Heights', 'Alkapuri, Vadodara', 'residential'],
  ['Propto Green Valley', 'Race Course, Rajkot', 'agricultural'],
  ['Propto Skyline Towers', 'Baner, Pune', 'residential'],
  ['Propto Sapphire Court', 'Vijay Nagar, Indore', 'commercial'],
  ['Propto Emerald Enclave', 'Manjalpur, Vadodara', 'residential'],
  ['Propto Platinum Square', 'Katargam, Surat', 'commercial'],
] as const;

const FACING_VALUES = ['North', 'South', 'East', 'West', 'North-East', 'South-West'];
const ROAD_WIDTHS = ['30 ft', '40 ft', '60 ft', '100 ft'];

/** Stable, human-readable ids so re-runs upsert instead of duplicating. */
const projectId = (i: number) => `PRJ-${String(i + 1).padStart(3, '0')}`;
const unitId = (p: number, u: number) => `${projectId(p)}-U${String(u + 1).padStart(3, '0')}`;

export async function seedPlatform(prisma: PrismaClient) {
  // -------------------------------------------------------------------------
  // Lookups & singletons
  // -------------------------------------------------------------------------
  for (const name of AMENITIES) {
    await prisma.amenity.upsert({ where: { name }, update: {}, create: { name } });
  }
  for (const name of PROPERTY_TYPES) {
    await prisma.propertyTypeOption.upsert({ where: { name }, update: {}, create: { name } });
  }
  for (const name of ADDRESSES) {
    await prisma.addressOption.upsert({ where: { name }, update: {}, create: { name } });
  }
  const amenities = await prisma.amenity.findMany({ orderBy: { name: 'asc' } });
  const addresses = await prisma.addressOption.findMany({ orderBy: { name: 'asc' } });

  await prisma.organizationSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      companyName: 'Propto CRM',
      logoUrl: '',
      contactEmail: 'contact@proptocrm.com',
      contactPhone: '+91 90000 00000',
      address: 'Propto Corporate House, Vesu, Surat, Gujarat 395007',
    },
  });
  await prisma.notificationSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
  await prisma.referralToggleSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
  const policy = await prisma.attendancePolicySettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });
  await prisma.workLocation.upsert({
    where: { id: 'LOC-HQ' },
    update: {},
    create: {
      id: 'LOC-HQ',
      name: 'Propto Office',
      area: 'Vesu, Surat',
      latitude: policy.officeLat,
      longitude: policy.officeLng,
      radius: policy.geoFenceRadiusMeters,
      isDefault: true,
    },
  });

  // Return-schedule options, badges and the referral ladders the booking engine reads.
  const schedules = [[30, 'Days'], [90, 'Days'], [6, 'Months'], [12, 'Months'], [24, 'Months']] as const;
  for (let i = 0; i < schedules.length; i += 1) {
    const [time, timeType] = schedules[i];
    await prisma.manageTime.upsert({ where: { id: `MT-${i + 1}` }, update: {}, create: { id: `MT-${i + 1}`, time, timeType } });
  }

  const badges = [
    ['Starter', 1, 'Entry-level rank for new agents.', 0, 0, 0, 0, 1],
    ['Achiever', 2, 'Awarded after the first completed sale.', 100000, 50000, 5000, 1000, 1],
    ['Elite', 3, 'Top-performing agents.', 500000, 200000, 25000, 5000, 1],
    ['Legend', 4, 'Highest rank, reserved for top sellers.', 2000000, 1000000, 100000, 25000, 0],
  ] as const;
  for (let i = 0; i < badges.length; i += 1) {
    const [rankName, rankLevel, description, minInvest, minDeposit, minEarning, bonus, status] = badges[i];
    await prisma.badge.upsert({
      where: { id: `BADGE-${i + 1}` },
      update: {},
      create: { id: `BADGE-${i + 1}`, rankName, rankLevel, description, minInvest, minDeposit, minEarning, bonus, status, sortOrder: i + 1 },
    });
  }

  const planLevels = [
    ['Bronze', 0, 499, 2], ['Silver', 500, 1999, 4], ['Gold', 2000, 4999, 6], ['Platinum', 5000, 999999, 8],
  ] as const;
  for (let i = 0; i < planLevels.length; i += 1) {
    const [levelTitle, rangeFrom, rangeTo, incentive] = planLevels[i];
    await prisma.planLevel.upsert({
      where: { id: `PL-${i + 1}` },
      update: {},
      create: { id: `PL-${i + 1}`, levelTitle, rangeFrom, rangeTo, incentive },
    });
  }

  const referralRules: [('deposit' | 'investment' | 'profit'), number[]][] = [
    ['deposit', [5, 2, 1]],
    ['investment', [4, 2, 1, 0.5]],
    ['profit', [2, 1]],
  ];
  for (const [commissionType, percents] of referralRules) {
    for (let i = 0; i < percents.length; i += 1) {
      await prisma.referralLevelRule.upsert({
        where: { commissionType_level: { commissionType, level: i + 1 } },
        update: { percent: percents[i] },
        create: { commissionType, level: i + 1, percent: percents[i] },
      });
    }
  }

  // -------------------------------------------------------------------------
  // People: one admin, then leaders -> employees -> agents
  // -------------------------------------------------------------------------
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@proptocrm.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Propto@2026';
  const admin = await prisma.user.upsert({
    where: { phone: '9800000001' },
    update: { passwordHash: await bcrypt.hash(adminPassword, 10) },
    create: {
      id: 'ADMIN-1',
      name: 'Propto',
      phone: '9800000001',
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, 10),
      role: 'admin',
      partnerCode: 'SR-ADM-0001',
      referralCode: 'SR-ADM-0001',
      kycStatus: 1,
    },
  });

  const phoneFor = (index: number) => `9${String(700000000 + index * 137).slice(0, 9)}`;
  const nameFor = () => `${pick(FIRST)} ${pick(LAST)}`;

  async function upsertPartner(seq: number, role: UserRole, extra: Record<string, unknown>) {
    const prefix = role === 'channel_partner' ? 'AGT' : role === 'employee' ? 'EMP' : 'LDR';
    const code = `SR-${prefix}-${1000 + seq}`;
    const name = nameFor();
    return prisma.user.upsert({
      where: { phone: phoneFor(seq) },
      update: {},
      create: {
        name,
        phone: phoneFor(seq),
        email: `${name.toLowerCase().replace(/\s+/g, '.')}${seq}@proptocrm.com`,
        role,
        status: rng() > 0.12 ? 'active' : rng() > 0.5 ? 'inactive' : 'suspended',
        partnerCode: code,
        referralCode: code,
        city: pick(CITIES),
        walletBalance: randInt(0, 400) * 1000,
        kycStatus: rng() > 0.25 ? 1 : rng() > 0.5 ? 0 : 2,
        joinedOn: daysAgo(randInt(30, 800)),
        aadhaarNumber: `XXXXXXXX${randInt(1000, 9999)}`,
        panNumber: `ABCDE${randInt(1000, 9999)}F`,
        ...extra,
      },
    });
  }

  let seq = 10;
  const leaders = [];
  for (let i = 0; i < 5; i += 1) {
    seq += 1;
    leaders.push(
      await upsertPartner(seq, 'leader', {
        designation: 'Sales Leader',
        area: `${pick(ADDRESSES)}, ${pick(CITIES)}`,
        leaderCode: `LDR-${1000 + seq}`,
      })
    );
  }

  // One team per leader, with the leader linked both ways.
  for (const leader of leaders) {
    const team = await prisma.team.upsert({
      where: { leaderId: leader.id },
      update: {},
      create: { name: `${leader.name.split(' ')[0]}'s Team`, leaderId: leader.id },
    });
    await prisma.user.update({ where: { id: leader.id }, data: { teamId: team.id } });
  }
  const teams = await prisma.team.findMany({ where: { leaderId: { in: leaders.map((l) => l.id) } } });
  const teamByLeader = new Map(teams.map((t) => [t.leaderId!, t.id]));

  const employees = [];
  for (let i = 0; i < 12; i += 1) {
    seq += 1;
    const leader = leaders[i % leaders.length];
    employees.push(
      await upsertPartner(seq, 'employee', {
        designation: pick(['Sales Executive', 'Senior Sales Executive', 'Site Coordinator', 'Relationship Manager']),
        area: `${pick(ADDRESSES)}, ${pick(CITIES)}`,
        reportingLeaderId: leader.id,
        sponsorId: leader.id,
        teamId: teamByLeader.get(leader.id) ?? null,
      })
    );
  }

  const agents = [];
  for (let i = 0; i < 30; i += 1) {
    seq += 1;
    // Two thirds hang off a leader directly; the rest off another agent, so the downline
    // is genuinely multi-level and the referral ladder has something to walk.
    const sponsor = i < 20 ? leaders[i % leaders.length] : agents[i - 20];
    agents.push(
      await upsertPartner(seq, 'channel_partner', {
        sponsorId: sponsor.id,
        teamId: sponsor.teamId ?? teamByLeader.get(sponsor.id) ?? null,
      })
    );
  }
  const partners = [...leaders, ...employees, ...agents];

  // -------------------------------------------------------------------------
  // Projects & plots
  // -------------------------------------------------------------------------
  for (let p = 0; p < PROJECTS.length; p += 1) {
    const [name, location, category] = PROJECTS[p];
    const id = projectId(p);
    const amenityIds = amenities.slice(0, randInt(4, 8)).map((a) => a.id);
    const inactive = p === PROJECTS.length - 1;

    await prisma.project.upsert({
      where: { id },
      update: {},
      create: {
        id,
        projectName: name,
        projectType: category === 'agricultural' ? 'Farm Land' : 'Plots',
        category,
        projectLocation: location,
        landArea: `${randInt(2000, 50000)} sq yard`,
        projectPrice: `Starting ₹${randInt(28, 60)} L`,
        projectDescription: `${name} is a premium development at ${location}, offering modern planning, quality construction and thoughtfully designed amenities.`,
        // The last project is deactivated on purpose, so the app has an `onHold` project
        // with a real hold reason to render.
        status: inactive ? 0 : 1,
        holdReason: inactive ? 'Layout approval renewal in progress with the local authority.' : null,
        sortOrder: p + 1,
        banner: `https://placehold.co/1200x480/652251/ffffff?text=${encodeURIComponent(name)}`,
        thumbnail: `https://placehold.co/300x200/652251/ffffff?text=${encodeURIComponent(name.split(' ').slice(-1)[0])}`,
        map: 'https://placehold.co/800x500/eef0f3/667085?text=Site+Map',
        googleLocation: `https://maps.google.com/?q=${encodeURIComponent(location)}`,
        latitude: Number((21.17 + rng() * 2).toFixed(6)),
        longitude: Number((72.83 + rng() * 2).toFixed(6)),
        layoutPlanUrl: 'https://placehold.co/800x1100/eef0f3/667085?text=Layout+Plan',
        amenityIds,
        gallery: [
          `https://placehold.co/1200x800/652251/ffffff?text=${encodeURIComponent(name)}+1`,
          `https://placehold.co/1200x800/9e4a82/ffffff?text=${encodeURIComponent(name)}+2`,
        ],
        files: {
          create: [
            { kind: 'jda', file: 'https://placehold.co/800x1100/eef0f3/667085?text=JDA+Certificate' },
            { kind: 'rera', file: 'https://placehold.co/800x1100/eef0f3/667085?text=RERA+Certificate' },
            {
              kind: 'construction',
              file: 'https://placehold.co/1200x800/eef0f3/667085?text=Boundary+wall',
              caption: 'Boundary wall complete',
              capturedOn: daysAgo(randInt(10, 60)),
            },
            {
              kind: 'construction',
              file: 'https://placehold.co/1200x800/eef0f3/667085?text=Internal+roads',
              caption: 'Internal roads laid',
              capturedOn: daysAgo(randInt(2, 9)),
            },
          ],
        },
      },
    });

    const unitCount = randInt(8, 16);
    for (let u = 0; u < unitCount; u += 1) {
      const uid = unitId(p, u);
      const area = randInt(1200, 2400);
      const perArea = randInt(1600, 2600);
      const total = area * perArea;
      const perAreaProfit = Math.round(perArea * (randInt(20, 35) / 1000));

      await prisma.propertyUnit.upsert({
        where: { id: uid },
        update: {},
        create: {
          id: uid,
          projectId: id,
          addressId: pick(addresses).id,
          propertyTitle: `${name} — Plot ${String.fromCharCode(65 + (u % 4))}-${String(u + 1).padStart(2, '0')}`,
          propertyNumber: `${String.fromCharCode(65 + (u % 4))}-${String(u + 1).padStart(2, '0')}`,
          propertyType: category === 'commercial' ? 'Shop' : 'Plot',
          propertyArea: String(area),
          propertyMeasurement: 'Sq feet',
          width: String(randInt(30, 60)),
          length: String(randInt(40, 80)),
          status: 1,
          // Every plot starts Available. Booked/Sold-Out states are produced by actually
          // running bookings through the shared booking engine (see seedOperations), so the
          // seeded plot status, ledger and investment rows can never disagree.
          bookingStatus: 0,
          isCorner: rng() > 0.8,
          isFeatured: rng() > 0.85,
          isVerified: false,
          thumbnail: `https://placehold.co/600x400/652251/ffffff?text=Plot+${u + 1}`,
          sitePlan: 'https://placehold.co/800x600/eef0f3/667085?text=Plot+Site+Plan',
          images: [`https://placehold.co/1200x800/652251/ffffff?text=Plot+${u + 1}`],
          amenityIds,
          perAreaAmount: perArea,
          perAreaProfit,
          totalInvestmentAmount: total,
          profit: perAreaProfit * area,
          charges: Math.round(total * 0.05),
          gstAndRegistration: Math.round(total * 0.07),
          tokenAmount: 50000,
          facings: {
            create: [
              { key: 'Facing', value: pick(FACING_VALUES) },
              { key: 'Road Width', value: pick(ROAD_WIDTHS) },
            ],
          },
        },
      });
    }
  }

  // A few short holds on available plots, so the app has `onHold` plots to render.
  const holdCandidates = await prisma.propertyUnit.findMany({
    where: { bookingStatus: 0 },
    take: 6,
    orderBy: { id: 'asc' },
  });
  for (let i = 0; i < holdCandidates.length; i += 1) {
    const id = `HOLD-${String(i + 1).padStart(4, '0')}`;
    await prisma.plotHold.upsert({
      where: { id },
      update: {},
      create: {
        id,
        unitId: holdCandidates[i].id,
        userId: pick(partners).id,
        holdStart: daysAgo(randInt(0, 2)),
        holdEnd: daysAgo(-randInt(1, 4)),
        status: 1,
      },
    });
  }

  return { admin, partners, leaders, employees, agents, adminEmail, adminPassword };
}
