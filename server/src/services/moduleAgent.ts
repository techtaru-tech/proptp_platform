import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../prisma';
import { anthropicClient } from './anthropicKey';
import { AssistantError } from './assistant';
import { ToolError } from './assistantTools';
import { validateInput } from './crmAgentTools';
import { mayRun, moduleToolByName, moduleToolSpecs, toolsFor, type ToolCtx } from './moduleAgentTools';
import { SECTIONS, type Access, type SectionKey } from './sections';

/**
 * The assistant on each section's Overview: Claude with that section's read-only tools. It answers
 * about its own section only — the HRMS assistant does HRMS — streams every lookup and word as it
 * happens, and keeps each chat (kind "section:<key>") so a follow-up has the whole conversation.
 */

export const MODULE_AGENT_MODEL = process.env.MODULE_AGENT_MODEL || process.env.CRM_AGENT_MODEL || process.env.ASSISTANT_MODEL || 'claude-opus-5-5';
const EFFORT = (process.env.MODULE_AGENT_EFFORT || 'high') as 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const MAX_ROUNDS = 12;
const BETAS: Anthropic.Beta.AnthropicBeta[] = ['server-side-fallback-2026-07-01', 'thinking-display-updates-2026-08-18'];

export type AgentEvent =
  | { type: 'conversation'; id: string; title: string }
  | { type: 'step'; id: string; label: string }
  | { type: 'step_done'; id: string; ok: boolean; note?: string }
  | { type: 'progress'; text: string }
  | { type: 'text'; delta: string }
  | { type: 'notice'; text: string }
  | { type: 'done'; conversationId: string }
  | { type: 'error'; message: string };

export const kindOf = (section: SectionKey) => `section:${section}`;

/** What each assistant covers, in the words a person in that team would use. */
const SCOPE: Record<SectionKey, string> = {
  hrms: 'HRMS: staff attendance (check-ins, late marks, absences, geo-fence distance, corrections), leave requests and balances, holidays and payroll (payroll runs and payslips).',
  tasks: 'Tasks: the team\'s tasks — status, priority, due dates, overdue and blocked work, who has how much on their plate, and what got finished.',
  'real-estate': 'Real Estate: projects, plot inventory (available, on hold, booked, sold), plot holds, bookings and their confirmation, money still to collect on booked plots, investments/deposits and site cameras.',
  finance: 'Finance: money received (by mode and period), money still to collect, wallet deposits to approve, partner KYC verification, partner payouts and incentive requests.',
  'construction-legal': 'Construction & Legal: site progress plan vs actual, activities behind schedule, progress updates to review, site issues, vendors, work orders, bills and material; legal files, registry stages, project approvals and their validity, and court cases.',
  people: 'People & Partners: channel partners (status, KYC, city, joining, booking value), leaders and employees, teams/referrals and partner disputes.',
  support: 'Support & Comms: support tickets (open, waiting on us, resolved), notifications sent and how many were read, and WhatsApp template sends.',
  reports: 'Reports: the headline business numbers across bookings, collections, partners, attendance, payouts and support — summaries, comparisons and trends.',
  settings: 'Settings: operations rules (what each does, on/off, how often it ran), roles and access, client access expiry and the audit log of changes.',
};

function stablePrompt(section: SectionKey) {
  const label = SECTIONS[section].label;
  return [
    `You are the ${label} assistant inside Propto CRM, the software of a real-estate developer that sells plots, villas and flats through its own team and channel partners. You sit on the ${label} Overview page and work for the person who is signed in, seeing only what they may see.`,
    `Scope: ${SCOPE[section]} Answer only about ${label}. If they ask about another area (for example leads or the sales pipeline, which is the CRM), say in one line that you cover ${label} and which section's assistant to ask instead. You are read-only: you cannot approve, change or send anything. If they want something done, say exactly which page in the panel to do it on.`,
    'Truth: every number, name and date you state must come from a tool result in this conversation. Never estimate or invent. If a tool did not return something, say so. Start with section_overview for summaries and "what needs attention"; use the other tools to drill in. Turn names into ids with find_people before filtering by person. Make independent lookups in parallel.',
    `Analysis: think like the head of ${label}. Go past restating numbers — compute rates and shares, compare people, projects or periods, point out risks and what is stuck, and end with two or three concrete next actions with the numbers behind them. If the question is ambiguous, answer the most likely reading and state the assumption in one line rather than asking.`,
    'Format: lead with the direct answer in one or two sentences. Then a short markdown table or bullet list when there are several rows. Link records into the panel as markdown when a tool gives a link (e.g. [Task title](/tasks/<id>)). Money in rupees with Indian grouping (₹1,50,000) or L / Cr for large values. Dates in India time (5 Nov 2026). Keep it tight — no filler, no repeating the question.',
    'Language: reply in the language the person writes in — English, Hindi, or Hinglish in Roman script.',
  ].join('\n\n');
}

const now = () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });

async function save(conversationId: string, role: 'user' | 'assistant', content: unknown) {
  await prisma.assistantMessage.create({ data: { conversationId, role, content: content as never } });
  await prisma.assistantConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
}

async function history(conversationId: string): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const rows = await prisma.assistantMessage.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
  return rows.map((r) => ({ role: r.role, content: r.content }) as unknown as Anthropic.Beta.BetaMessageParam);
}

async function runTool(ctx: ToolCtx, block: Anthropic.Beta.BetaToolUseBlock): Promise<{ result: Anthropic.Beta.BetaToolResultBlockParam; ok: boolean; note?: string }> {
  const def = toolsFor(ctx.section).find((t) => t.name === block.name);
  const fail = (content: string, note?: string) => ({ ok: false, note, result: { type: 'tool_result' as const, tool_use_id: block.id, is_error: true, content } });
  if (!def) return fail(`There is no tool called ${block.name} here.`);
  if (!mayRun(def, ctx)) return fail('NO_ACCESS: this person\'s role does not include that module. Tell them so; do not guess the figures.', 'no access');
  const invalid = validateInput(def as never, block.input);
  if (invalid) return fail(`INVALID_INPUT: ${invalid} Call it again with valid input.`, 'invalid input');
  try {
    return { ok: true, result: { type: 'tool_result', tool_use_id: block.id, content: await def.run(ctx, block.input) } };
  } catch (e) {
    const message = e instanceof ToolError ? e.message : `That lookup failed: ${(e as Error).message}`;
    return fail(message, message);
  }
}

function apiError(e: unknown): AssistantError | null {
  if (e instanceof Anthropic.AuthenticationError) return new AssistantError('The Anthropic API key was refused. Update it in Settings > AI Assistant.', 503);
  if (e instanceof Anthropic.PermissionDeniedError) return new AssistantError('This API key is not allowed to use the model. Check the key\'s workspace in the Anthropic Console.', 503);
  if (e instanceof Anthropic.RateLimitError) return new AssistantError('The assistant is busy right now (rate limit). Try again in a minute.', 429);
  if (e instanceof Anthropic.BadRequestError) return new AssistantError(`The request was not accepted: ${e.message}`, 502);
  if (e instanceof Anthropic.APIError) return new AssistantError(`The AI service had a problem (${e.status ?? 'network'}). Try again.`, 502);
  return null;
}

/** One question, answered: streams events through `emit` until the answer is complete. */
export async function askModuleAgent(opts: {
  section: SectionKey;
  access: Access;
  conversationId: string | null;
  message: string;
  emit: (e: AgentEvent) => void;
  signal?: AbortSignal;
}) {
  const { section, access, emit, signal } = opts;
  const userId = access.userId;
  const kind = kindOf(section);
  const client = await anthropicClient();
  if (!client) throw new AssistantError('The assistant is not set up yet. Add an Anthropic API key in Settings > AI Assistant.', 503);
  const text = opts.message.trim();
  if (!text) throw new AssistantError('Write a question first.', 400);
  if (text.length > 4000) throw new AssistantError('That question is too long — keep it under 4,000 characters.', 400);

  let conv = opts.conversationId ? await prisma.assistantConversation.findFirst({ where: { id: opts.conversationId, userId, kind } }) : null;
  if (opts.conversationId && !conv) throw new AssistantError('That chat was not found.', 404);
  conv ??= await prisma.assistantConversation.create({ data: { userId, kind, title: text.slice(0, 70) } });
  emit({ type: 'conversation', id: conv.id, title: conv.title });
  await save(conv.id, 'user', [{ type: 'text', text }]);

  const ctx: ToolCtx = { access, section };
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: stablePrompt(section), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `Now: ${now()} (India time).` },
  ];
  const tools = moduleToolSpecs(section);

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let message: Anthropic.Beta.BetaMessage;
    try {
      const stream = client.beta.messages.stream(
        {
          model: MODULE_AGENT_MODEL,
          max_tokens: 32000,
          betas: BETAS,
          fallbacks: 'default',
          thinking: { type: 'adaptive', display: 'updates' },
          output_config: { effort: EFFORT },
          cache_control: { type: 'ephemeral' },
          system,
          tools,
          messages: await history(conv.id),
        },
        { signal },
      );
      for await (const event of stream) {
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          emit({ type: 'step', id: event.content_block.id, label: moduleToolByName(event.content_block.name)?.label ?? event.content_block.name });
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') emit({ type: 'text', delta: event.delta.text });
          else if (event.delta.type === 'thinking_delta' && event.delta.thinking) emit({ type: 'progress', text: event.delta.thinking });
        }
      }
      message = await stream.finalMessage();
    } catch (e) {
      if (signal?.aborted) return;
      throw apiError(e) ?? e;
    }

    await save(conv.id, 'assistant', message.content);
    if (message.content.some((b) => b.type === 'fallback')) emit({ type: 'notice', text: 'Answered by a fallback model after the first one declined.' });
    const uses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    // Every tool_use in the history needs an answer, or the next request is rejected.
    const answerAsErrors = (why: string) => save(conv!.id, 'user', uses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: why })));

    if (message.stop_reason === 'refusal') {
      if (uses.length) await answerAsErrors('Not run: the turn was declined.');
      emit({ type: 'text', delta: `\n\nI can’t help with that one. Ask me about ${SECTIONS[section].label}.` });
      break;
    }
    if (!uses.length) {
      if (message.stop_reason === 'max_tokens') emit({ type: 'notice', text: 'The answer hit the length limit and was cut short. Ask for a narrower view.' });
      break;
    }
    if (message.stop_reason === 'max_tokens') {
      await answerAsErrors('INVALID_JSON: the input was cut off by the length limit. Call the tool again with a smaller request.');
      continue;
    }

    const results = await Promise.all(uses.map(async (u) => {
      const r = await runTool(ctx, u);
      emit({ type: 'step_done', id: u.id, ok: r.ok, note: r.note });
      return r;
    }));
    await save(conv.id, 'user', results.map((r) => r.result));
    if (round === MAX_ROUNDS - 1) {
      const last = 'That took more lookups than I allow for one question. Ask again more narrowly.';
      emit({ type: 'text', delta: `\n\n${last}` });
      await save(conv.id, 'assistant', [{ type: 'text', text: last }]);
    }
  }
  emit({ type: 'done', conversationId: conv.id });
}

// ---------------------------------------------------------------------------
// The chat as a person reads it
// ---------------------------------------------------------------------------

type Block = { type: string; text?: string; name?: string; id?: string; tool_use_id?: string; is_error?: boolean };

export async function moduleChatView(userId: string, section: SectionKey, conversationId: string) {
  const conv = await prisma.assistantConversation.findFirst({ where: { id: conversationId, userId, kind: kindOf(section) }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
  if (!conv) return null;
  const failed = new Set<string>();
  for (const m of conv.messages) if (m.role === 'user') for (const b of m.content as unknown as Block[]) if (b.type === 'tool_result' && b.is_error) failed.add(b.tool_use_id!);

  // One assistant turn spans several stored messages (lookups, then the answer); fold them together.
  const out: { id: string; role: 'user' | 'assistant'; text: string; steps: { label: string; failed?: boolean }[]; at: string }[] = [];
  for (const m of conv.messages) {
    const blocks = m.content as unknown as Block[];
    if (m.role === 'user') {
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      if (text) out.push({ id: m.id, role: 'user', text, steps: [], at: m.createdAt.toISOString() });
      continue;
    }
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const steps = blocks.filter((b) => b.type === 'tool_use').map((b) => ({ label: moduleToolByName(b.name!)?.label ?? b.name!, failed: failed.has(b.id!) }));
    const last = out[out.length - 1];
    if (last?.role === 'assistant') { last.text += text; last.steps.push(...steps); }
    else out.push({ id: m.id, role: 'assistant', text, steps, at: m.createdAt.toISOString() });
  }
  return { id: conv.id, title: conv.title, messages: out };
}
