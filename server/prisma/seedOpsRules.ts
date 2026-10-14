import type { PrismaClient } from '@prisma/client';

/**
 * The PDF's ten automation rows as starting rules. All of them are seeded OFF: switching one on is
 * a decision about who gets messaged and what changes, and a seed must never make it. Recipients
 * are modules ("everyone with Legal access"), not named people, so they hold on any database.
 * Skipped if any rule exists.
 */
const notify = (recipients: string[], message: string, title?: string, channel: 'in_app' | 'email' | 'whatsapp' = 'in_app') => ({ kind: 'notify', recipients, channel, title, message });

const RULES = [
  { name: 'Booking confirmed → payment schedule and legal team', trigger: 'booking_confirmed', config: {}, steps: [
    { delayHours: 0, action: { kind: 'create_payment_schedule', schedule: [{ name: 'Booking amount', percent: 20, offsetDays: 0 }, { name: 'On agreement', percent: 30, offsetDays: 30 }, { name: 'On plinth completion', percent: 30, offsetDays: 150 }, { name: 'On possession', percent: 20, offsetDays: 330 }] } },
    { delayHours: 0, action: notify(['module:legal'], 'New booking: {{buyer}}, plot {{unit}} in {{project}} ({{amount}}). The legal file is open.', 'Booking confirmed') },
  ] },
  { name: 'Payment falling due → demand note', trigger: 'payment_due', config: { leadDays: 3 }, steps: [
    { delayHours: 0, action: { kind: 'generate_demand_note' } },
    { delayHours: 0, action: notify(['module:legal'], '{{milestone}} of {{amount}} for {{buyer}} ({{unit}}) falls due on {{due}}. The demand note is ready to send.', 'Payment falling due') },
  ] },
  { name: 'Payment overdue → remind, then escalate to collections', trigger: 'payment_overdue', config: {}, steps: [
    { delayHours: 0, action: notify(['module:legal'], '{{buyer}} ({{unit}}) is {{days}} day(s) overdue on {{milestone}}: {{amount}}.', 'Payment overdue') },
    { delayHours: 168, repeatEveryHours: 168, action: { kind: 'create_task', recipients: ['module:payments'], title: 'Collect from {{buyer}}', message: '{{amount}} for {{milestone}} has been overdue {{days}} days.', dueInHours: 72 } },
  ] },
  { name: 'Daily site update missing → remind, then escalate', trigger: 'update_missing', config: { graceDays: 1 }, steps: [
    { delayHours: 0, action: notify(['owner'], 'No update posted for {{activity}} ({{project}}) in {{days}} day(s). Please post today’s progress.', 'Site update missing') },
    { delayHours: 48, action: notify(['owner_manager', 'module:construction'], '{{owner}} has not reported on {{activity}} ({{project}}) for {{days}} days.', 'Site update still missing') },
  ] },
  { name: 'Material awaiting verification → task and reminders', trigger: 'material_unverified', config: {}, steps: [
    { delayHours: 0, action: { kind: 'create_task', recipients: ['module:construction'], title: 'Verify {{material}} at {{project}}', message: '{{quantity}} from {{vendor}}, challan {{challan}}.', dueInHours: 24 } },
    { delayHours: 12, repeatEveryHours: 12, action: notify(['module:construction'], '{{quantity}} of {{material}} ({{challan}}) has waited {{hours}}h for verification.', 'Material still unverified') },
  ] },
  { name: 'Milestone slipping → alert management', trigger: 'milestone_slipping', config: { minDaysBehind: 5 }, steps: [
    { delayHours: 0, action: notify(['module:construction', 'module:dashboard'], '{{activity}} at {{project}} is {{days}} day(s) behind plan.', 'Milestone slipping') },
  ] },
  { name: 'Agreement pending signature → staged reminders', trigger: 'agreement_pending', config: {}, steps: [
    { delayHours: 72, action: notify(['module:legal'], 'Agreement for {{buyer}} ({{unit}}) has been {{stage}} for {{days}} days.', 'Agreement pending') },
    { delayHours: 168, action: notify(['module:legal'], 'Agreement for {{buyer}} still {{stage}} after {{days}} days. Follow up with the buyer.', 'Agreement overdue') },
  ] },
  { name: 'Approval or document nearing expiry → alert at 90, 60, 30 days', trigger: 'approval_expiring', config: { band1: 90, band2: 60, band3: 30 }, steps: [
    { delayHours: 0, action: notify(['module:legal'], '{{item}} for {{subject}} ({{reference}}) is valid until {{valid_until}} — {{days_left}} days left.', 'Approval nearing expiry') },
  ] },
  { name: 'Hold period over → release the plot and tell the executive', trigger: 'hold_expired', config: {}, steps: [
    { delayHours: 0, action: { kind: 'release_hold' } },
    { delayHours: 0, action: notify(['owner'], 'Your hold on plot {{unit}} ({{project}}) ran out and the plot is available again.', 'Hold released') },
  ] },
  { name: 'Registry completed → close the file and mark the plot sold', trigger: 'registry_completed', config: {}, steps: [
    { delayHours: 0, action: { kind: 'close_file_mark_sold' } },
    { delayHours: 0, action: notify(['module:legal'], 'Registry done for {{buyer}}, plot {{unit}} ({{project}}), deed {{deed}}. File closed.', 'Registry completed') },
  ] },
];

export async function seedOpsRules(prisma: PrismaClient) {
  if ((await prisma.opsRule.count()) > 0) {
    console.log('  operations rules already present — skipping.');
    return;
  }
  for (const r of RULES) await prisma.opsRule.create({ data: { name: r.name, trigger: r.trigger, config: r.config, steps: r.steps as never, enabled: false } });
  console.log(`  operations rules: ${RULES.length} (all switched off)`);
}
