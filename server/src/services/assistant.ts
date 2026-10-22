import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { toolByName, toolSpecs, ToolError } from './assistantTools';

/**
 * The panel's chat assistant: Claude, given the tools in assistantTools.ts, working as whoever is
 * signed in. Reads run straight away. Anything that changes data stops and waits for the person to
 * approve it on screen, so nothing is ever done on the model's say-so alone.
 */

export const ASSISTANT_MODEL = process.env.ASSISTANT_MODEL || 'claude-opus-5-5';
const MAX_ROUNDS = 10;

export type Llm = (req: { system: string; messages: Anthropic.MessageParam[]; tools: Anthropic.Tool[] }) => Promise<Anthropic.Message>;

let client: Anthropic | null = null;
export const isConfigured = () => !!process.env.ANTHROPIC_API_KEY;

const defaultLlm: Llm = async ({ system, messages, tools }) => {
  client ??= new Anthropic();
  return client.messages.create({
    model: ASSISTANT_MODEL,
    max_tokens: 16000,
    system,
    messages,
    tools,
    // Thinking is always on for this model; effort is the lever, and a CRM lookup needs little.
    output_config: { effort: 'medium' },
  });
};
let llm: Llm = defaultLlm;
/** For tests: answer from a script instead of the network. */
export const setLlm = (fn: Llm | null) => { llm = fn ?? defaultLlm; };

export class AssistantError extends Error {
  constructor(message: string, readonly status = 500) { super(message); }
}

async function systemPrompt(auth: string) {
  const today = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  let money = 'Amounts are in rupees; write them as ₹ with Indian grouping (₹1,50,000), or Cr / L for large ones.';
  try {
    const d = await (await fetch(`http://127.0.0.1:${process.env.PORT || 4300}/api/auth/display`, { headers: { authorization: auth } })).json() as { pointsEnabled?: boolean; pointsPerRupee?: number };
    if (d.pointsEnabled) money = `This panel shows money as points, never rupees. Every amount the tools return is in rupees: multiply it by ${d.pointsPerRupee} and write it as points ("pts"), never with ₹.`;
  } catch { /* keep the rupee default */ }
  return [
    'You are the assistant inside the admin panel of TechTaru Digital, a real-estate developer (plots, bookings, legal files, construction, channel partners). You work for the person who is signed in and can do only what they are allowed to.',
    `Today is ${today} (India time).`,
    'Use the tools to look things up. Never guess or invent a lead, amount, date or name: if a tool did not return it, say you do not know. Search before you assume an id; use find_users to turn a name into a user id.',
    'You cannot change anything yourself. The tools that change data (assign a lead, schedule a visit, add a follow-up or note) pause and show the person an approval card; only after they approve does anything happen. Propose the change once, clearly, then wait. If it was declined, say so and ask what they would like instead.',
    'For anything that is not possible with your tools (payments, cancellations, deleting, anything about money moving), say plainly that you cannot do it from here and where in the panel they can.',
    money,
    'Reply in the language the person writes in (Hindi, English or Hinglish) and keep it short and practical. Lead with the answer. Use a short list or a small table when there are several rows; give counts, and name the next step when there is an obvious one.',
  ].join('\n\n');
}

type Block = Anthropic.ContentBlockParam;
const pendingToWrites = (blocks: Anthropic.ToolUseBlock[]) => blocks.filter((b) => toolByName(b.name)?.write);

async function save(conversationId: string, role: 'user' | 'assistant', content: unknown) {
  await prisma.assistantMessage.create({ data: { conversationId, role, content: content as never } });
  await prisma.assistantConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
}

async function history(conversationId: string): Promise<Anthropic.MessageParam[]> {
  const rows = await prisma.assistantMessage.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
  return rows.map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content as never }));
}

async function runTool(auth: string, b: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> {
  const tool = toolByName(b.name);
  if (!tool) return { type: 'tool_result', tool_use_id: b.id, is_error: true, content: `There is no tool called ${b.name}.` };
  try {
    return { type: 'tool_result', tool_use_id: b.id, content: await tool.run(auth, b.input) };
  } catch (e) {
    return { type: 'tool_result', tool_use_id: b.id, is_error: true, content: e instanceof ToolError ? e.message : `That did not work: ${(e as Error).message}` };
  }
}

/** Calls the model, runs read tools, and stops at the first change that needs approval or at the answer. */
async function loop(conversationId: string, auth: string) {
  const system = await systemPrompt(auth);
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let resp: Anthropic.Message;
    try {
      resp = await llm({ system, messages: await history(conversationId), tools: toolSpecs() });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new AssistantError('The assistant’s API key was refused. Check ANTHROPIC_API_KEY.', 503);
      if (e instanceof Anthropic.RateLimitError) throw new AssistantError('The assistant is busy right now. Try again in a minute.', 429);
      if (e instanceof Anthropic.BadRequestError) throw new AssistantError(`The assistant could not process that: ${e.message}`, 502);
      if (e instanceof Anthropic.APIError) throw new AssistantError(`The assistant service had a problem (${e.status}).`, 502);
      throw e;
    }
    await save(conversationId, 'assistant', resp.content);
    if (resp.stop_reason === 'refusal') return;
    if (resp.stop_reason !== 'tool_use') return;

    const uses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const writes = pendingToWrites(uses);
    const reads = await Promise.all(uses.filter((b) => !toolByName(b.name)?.write).map((b) => runTool(auth, b)));
    if (writes.length) {
      const described = await Promise.all(writes.map(async (w) => ({ id: w.id, name: w.name, input: w.input, summary: await (toolByName(w.name)!.describe?.(auth, w.input) ?? Promise.resolve(w.name)).catch(() => w.name) })));
      await prisma.assistantConversation.update({ where: { id: conversationId }, data: { pending: { writes: described, reads } as never } });
      return;
    }
    await save(conversationId, 'user', reads);
  }
  await save(conversationId, 'assistant', [{ type: 'text', text: 'I went around too many times without finishing. Please ask again, more narrowly.' }]);
}

export async function sendMessage(userId: string, auth: string, conversationId: string | null, text: string) {
  if (!isConfigured() && llm === defaultLlm) throw new AssistantError('The assistant is not set up yet. Add ANTHROPIC_API_KEY to the server settings.', 503);
  const clean = text.trim();
  if (!clean) throw new AssistantError('Write a message first.', 400);
  let conv = conversationId ? await prisma.assistantConversation.findFirst({ where: { id: conversationId, userId } }) : null;
  if (conversationId && !conv) throw new AssistantError('That chat was not found.', 404);
  if (conv?.pending) throw new AssistantError('Approve or reject the change the assistant proposed before sending more.', 409);
  conv ??= await prisma.assistantConversation.create({ data: { userId, title: clean.slice(0, 60) } });
  await save(conv.id, 'user', [{ type: 'text', text: clean }]);
  await loop(conv.id, auth);
  return conv.id;
}

/** The person's answer to a proposed change: do it, or don't, and let the assistant carry on. */
export async function decide(userId: string, auth: string, conversationId: string, approve: boolean) {
  const conv = await prisma.assistantConversation.findFirst({ where: { id: conversationId, userId } });
  if (!conv) throw new AssistantError('That chat was not found.', 404);
  const pending = conv.pending as { writes: { id: string; name: string; input: unknown }[]; reads: Anthropic.ToolResultBlockParam[] } | null;
  if (!pending) throw new AssistantError('Nothing is waiting for approval.', 409);
  // Claim it before acting, so a double click cannot run the change twice.
  const claimed = await prisma.assistantConversation.updateMany({ where: { id: conv.id, updatedAt: conv.updatedAt }, data: { pending: Prisma.DbNull } });
  if (claimed.count === 0) throw new AssistantError('Nothing is waiting for approval.', 409);
  const results: Anthropic.ToolResultBlockParam[] = [...pending.reads];
  for (const w of pending.writes) {
    if (!approve) { results.push({ type: 'tool_result', tool_use_id: w.id, is_error: true, content: 'The person declined this change. Nothing was done.' }); continue; }
    results.push(await runTool(auth, { type: 'tool_use', id: w.id, name: w.name, input: w.input } as Anthropic.ToolUseBlock));
  }
  await save(conv.id, 'user', results);
  await loop(conv.id, auth);
}

// ---------------------------------------------------------------------------
// What the screen shows
// ---------------------------------------------------------------------------

export type ViewMessage =
  | { id: string; role: 'user'; text: string; at: string }
  | { id: string; role: 'assistant'; text: string; tools: { label: string; failed?: boolean }[]; at: string };

/** The chat as a person reads it: their words, the answers, and a chip per thing looked up. Raw tool traffic stays hidden. */
export async function view(userId: string, conversationId: string) {
  const conv = await prisma.assistantConversation.findFirst({ where: { id: conversationId, userId }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
  if (!conv) return null;
  const failed = new Set<string>();
  for (const m of conv.messages) if (m.role === 'user' && Array.isArray(m.content)) for (const b of m.content as unknown as Block[]) if (b.type === 'tool_result' && b.is_error) failed.add(b.tool_use_id);
  const out: ViewMessage[] = [];
  for (const m of conv.messages) {
    const blocks = (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content) as unknown as Block[];
    if (m.role === 'user') {
      const text = blocks.filter((b): b is Anthropic.TextBlockParam => b.type === 'text').map((b) => b.text).join('\n');
      if (text) out.push({ id: m.id, role: 'user', text, at: m.createdAt.toISOString() });
    } else {
      const text = blocks.filter((b): b is Anthropic.TextBlockParam => b.type === 'text').map((b) => b.text).join('\n').trim();
      const tools = blocks.filter((b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use').map((b) => ({ label: toolByName(b.name)?.label ?? b.name, failed: failed.has(b.id) }));
      if (text || tools.length) out.push({ id: m.id, role: 'assistant', text, tools, at: m.createdAt.toISOString() });
    }
  }
  const pending = conv.pending as { writes: { id: string; name: string; summary: string }[] } | null;
  return { id: conv.id, title: conv.title, messages: out, pending: pending ? pending.writes.map((w) => ({ id: w.id, name: w.name, summary: w.summary })) : null };
}
