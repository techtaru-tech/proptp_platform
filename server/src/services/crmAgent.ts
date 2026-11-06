import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../prisma';
import { anthropicClient } from './anthropicKey';
import { AssistantError } from './assistant';
import { ToolError } from './assistantTools';
import { crmToolByName, crmToolSpecs, validateInput } from './crmAgentTools';

/**
 * The CRM analyst on CRM Overview: Claude with read-only CRM tools, answering as the signed-in
 * person and seeing only what they may see. It streams — every lookup it makes and every word it
 * writes reaches the screen as it happens — and keeps each chat so a follow-up question has the
 * whole conversation behind it.
 */

export const CRM_AGENT_MODEL = process.env.CRM_AGENT_MODEL || process.env.ASSISTANT_MODEL || 'claude-opus-5-5';
const EFFORT = (process.env.CRM_AGENT_EFFORT || 'high') as 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const MAX_ROUNDS = 14;
// Fallbacks: a request the model declines on safety grounds is re-run by the API on a model that
// can answer it, inside the same call. Progress updates: what it is doing between lookups.
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

/** What the person is looking at, so "this filter" and "these numbers" mean something. */
export interface PageContext {
  page?: string;
  filters?: Record<string, string>;
  /** Readable versions of the filter ids, e.g. { assignedUserId: "Gaurav" }. */
  labels?: Record<string, string>;
}

const STABLE_PROMPT = [
  'You are the CRM analyst inside Propto CRM, the sales software of a real-estate developer that sells plots, villas and flats through its own sales team and channel partners. You answer questions about the CRM: leads, sources and ad forms, the pipeline and its stages, follow-ups, site visits, calls, the sales team, speed to lead, conversion, demand and the automation/messaging channels. You work for the person who is signed in and see only what they are allowed to see.',
  'Scope: CRM only. If asked about payroll, attendance, legal files, construction, accounts or anything outside sales, say in one line that you only cover the CRM and where in the panel to look instead. You cannot change data — you are read-only. If they want something changed (assign a lead, move a stage, add a follow-up), say exactly where to do it or suggest the general Assistant.',
  'Truth: every number, name and date you state must come from a tool result in this conversation. Never estimate or invent. If a tool did not return something, say so. Prefer crm_overview for anything about overall performance, trends, comparisons or causes; use search_leads (its total is the count), get_lead, follow_ups, call_stats, recent_calls, team_performance and source_performance to drill in. Turn names into ids with find_users and list_pipelines before filtering. Make independent lookups in parallel.',
  'Analysis: think like a sales head. Go past restating numbers — compute rates and shares, compare with the previous period or with peers, point out what changed and the likely reason the data supports, flag risks (untouched leads, overdue follow-ups, slow first response, a source that brings volume but no wins), and end with two or three concrete next actions with the numbers behind them. Say what period the figures cover. If the question is ambiguous, answer the most likely reading and state the assumption in one line rather than asking.',
  'Format: lead with the direct answer in one or two sentences. Then a short markdown table or bullet list when there are several rows. Use ### headings only for longer answers. Link leads and people into the panel as markdown: a lead as [Name](/crm/leads/<lead id>), a person\'s leads as [Name](/crm/leads?assignedUserId=<user id>). Money in rupees with Indian grouping (₹1,50,000) or L / Cr for large values. Dates in India time (5 Nov 2026). Keep it tight — no filler, no repeating the question.',
  'Language: reply in the language the person writes in — English, Hindi, or Hinglish in Roman script.',
].join('\n\n');

function contextPrompt(ctx: PageContext | undefined) {
  const today = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const lines = [`Now: ${today} (India time).`];
  const f = ctx?.filters ?? {};
  const active = Object.entries(f).filter(([, v]) => v);
  if (active.length) {
    lines.push(
      `The person is on ${ctx?.page ?? 'CRM Overview'} with these filters applied (pass them to crm_overview / search_leads when they say "this", "here" or "these numbers"):`,
      ...active.map(([k, v]) => `- ${k}: ${v}${ctx?.labels?.[k] ? ` (${ctx.labels[k]})` : ''}`),
    );
  } else {
    lines.push(`The person is on ${ctx?.page ?? 'CRM Overview'} with no filters applied.`);
  }
  return lines.join('\n');
}

type Stored = { role: 'user' | 'assistant'; content: unknown };

async function save(conversationId: string, role: 'user' | 'assistant', content: unknown) {
  await prisma.assistantMessage.create({ data: { conversationId, role, content: content as never } });
  await prisma.assistantConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
}

async function history(conversationId: string): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const rows = await prisma.assistantMessage.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
  // Every block goes back exactly as it came, thinking and fallback blocks included.
  return rows.map((r) => ({ role: r.role, content: r.content } as Stored as Anthropic.Beta.BetaMessageParam));
}

async function runTool(auth: string, block: Anthropic.Beta.BetaToolUseBlock): Promise<{ result: Anthropic.Beta.BetaToolResultBlockParam; ok: boolean; note?: string }> {
  const def = crmToolByName(block.name);
  if (!def) return { ok: false, result: { type: 'tool_result', tool_use_id: block.id, is_error: true, content: `There is no tool called ${block.name}.` } };
  const invalid = validateInput(def, block.input);
  if (invalid) return { ok: false, note: 'invalid input', result: { type: 'tool_result', tool_use_id: block.id, is_error: true, content: `INVALID_INPUT: ${invalid} Call it again with valid input.` } };
  try {
    return { ok: true, result: { type: 'tool_result', tool_use_id: block.id, content: await def.run(auth, block.input) } };
  } catch (e) {
    const message = e instanceof ToolError ? e.message : `That lookup failed: ${(e as Error).message}`;
    return { ok: false, note: message, result: { type: 'tool_result', tool_use_id: block.id, is_error: true, content: message } };
  }
}

function apiError(e: unknown): AssistantError | null {
  if (e instanceof Anthropic.AuthenticationError) return new AssistantError('The Anthropic API key was refused. Update it in Settings > AI Assistant.', 503);
  if (e instanceof Anthropic.PermissionDeniedError) return new AssistantError('This API key is not allowed to use the model. Check the key\'s workspace in the Anthropic Console.', 503);
  if (e instanceof Anthropic.RateLimitError) return new AssistantError('The analyst is busy right now (rate limit). Try again in a minute.', 429);
  if (e instanceof Anthropic.BadRequestError) return new AssistantError(`The request was not accepted: ${e.message}`, 502);
  if (e instanceof Anthropic.APIError) return new AssistantError(`The AI service had a problem (${e.status ?? 'network'}). Try again.`, 502);
  return null;
}

/** One question, answered: streams events through `emit` until the answer is complete. */
export async function askCrmAgent(opts: {
  userId: string;
  auth: string;
  conversationId: string | null;
  message: string;
  context?: PageContext;
  emit: (e: AgentEvent) => void;
  signal?: AbortSignal;
}) {
  const { userId, auth, emit, signal } = opts;
  const client = await anthropicClient();
  if (!client) throw new AssistantError('The CRM analyst is not set up yet. Add an Anthropic API key in Settings > AI Assistant.', 503);
  const text = opts.message.trim();
  if (!text) throw new AssistantError('Write a question first.', 400);
  if (text.length > 4000) throw new AssistantError('That question is too long — keep it under 4,000 characters.', 400);

  let conv = opts.conversationId ? await prisma.assistantConversation.findFirst({ where: { id: opts.conversationId, userId, kind: 'crm' } }) : null;
  if (opts.conversationId && !conv) throw new AssistantError('That chat was not found.', 404);
  conv ??= await prisma.assistantConversation.create({ data: { userId, kind: 'crm', title: text.slice(0, 70) } });
  emit({ type: 'conversation', id: conv.id, title: conv.title });
  await save(conv.id, 'user', [{ type: 'text', text }]);

  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    // Stable first, so the prompt and tool definitions are cached across questions.
    { type: 'text', text: STABLE_PROMPT, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: contextPrompt(opts.context) },
  ];
  const tools = crmToolSpecs();

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let message: Anthropic.Beta.BetaMessage;
    try {
      const stream = client.beta.messages.stream(
        {
          model: CRM_AGENT_MODEL,
          max_tokens: 64000,
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
          emit({ type: 'step', id: event.content_block.id, label: crmToolByName(event.content_block.name)?.label ?? event.content_block.name });
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
    if (message.content.some((b) => b.type === 'fallback')) {
      emit({ type: 'notice', text: 'Answered by a fallback model after the first one declined.' });
    }
    const uses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    // Every tool_use in the history needs an answer, or the next request is rejected.
    const answerAsErrors = (why: string) => save(conv!.id, 'user', uses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: why })));

    if (message.stop_reason === 'refusal') {
      if (uses.length) await answerAsErrors('Not run: the turn was declined.');
      emit({ type: 'text', delta: '\n\nI can’t help with that one. Ask me about leads, the pipeline, follow-ups, visits, calls or the team.' });
      break;
    }
    if (!uses.length) {
      if (message.stop_reason === 'max_tokens') emit({ type: 'notice', text: 'The answer hit the length limit and was cut short. Ask for a narrower view.' });
      break;
    }
    if (message.stop_reason === 'max_tokens') {
      // A tool call cut off by the length limit has truncated input; never run it, ask again instead.
      await answerAsErrors('INVALID_JSON: the input was cut off by the length limit. Call the tool again with a smaller request.');
      continue;
    }

    const results = await Promise.all(uses.map(async (u) => {
      const r = await runTool(opts.auth, u);
      emit({ type: 'step_done', id: u.id, ok: r.ok, note: r.note });
      return r;
    }));
    // All results go back in one user message, so parallel lookups stay parallel next time.
    await save(conv.id, 'user', results.map((r) => r.result));
    if (round === MAX_ROUNDS - 1) {
      emit({ type: 'text', delta: '\n\nThat took more lookups than I allow for one question. Ask again more narrowly.' });
      await save(conv.id, 'assistant', [{ type: 'text', text: 'That took more lookups than I allow for one question. Ask again more narrowly.' }]);
    }
  }
  emit({ type: 'done', conversationId: conv.id });
}

// ---------------------------------------------------------------------------
// The chat as a person reads it
// ---------------------------------------------------------------------------

type Block = { type: string; text?: string; thinking?: string; name?: string; id?: string; tool_use_id?: string; is_error?: boolean };

export async function crmChatView(userId: string, conversationId: string) {
  const conv = await prisma.assistantConversation.findFirst({ where: { id: conversationId, userId, kind: 'crm' }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
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
    const steps = blocks.filter((b) => b.type === 'tool_use').map((b) => ({ label: crmToolByName(b.name!)?.label ?? b.name!, failed: failed.has(b.id!) }));
    const last = out[out.length - 1];
    if (last?.role === 'assistant') { last.text += text; last.steps.push(...steps); }
    else out.push({ id: m.id, role: 'assistant', text, steps, at: m.createdAt.toISOString() });
  }
  return { id: conv.id, title: conv.title, messages: out };
}
