import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../prisma';
import { decrypt, encrypt } from './crypto';

/**
 * Where the assistants get their Anthropic API key: ANTHROPIC_API_KEY in the server environment,
 * or the key an administrator pasted into Settings > AI Assistant (stored encrypted). The
 * environment wins when both are set, so a deploy can always override what is in the database.
 */

export type KeySource = 'environment' | 'settings' | null;

let cache: { key: string | null; source: KeySource; at: number } | null = null;
const TTL_MS = 30_000;

export async function resolveKey(): Promise<{ key: string | null; source: KeySource }> {
  if (process.env.ANTHROPIC_API_KEY) return { key: process.env.ANTHROPIC_API_KEY, source: 'environment' };
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const row = await prisma.organizationSettings.findUnique({ where: { id: 'singleton' }, select: { anthropicApiKey: true } });
  let key: string | null = null;
  if (row?.anthropicApiKey) {
    try { key = decrypt(row.anthropicApiKey) || null; } catch { key = null; }
  }
  cache = { key, source: key ? 'settings' : null, at: Date.now() };
  return cache;
}

export async function saveKey(key: string | null): Promise<void> {
  await prisma.organizationSettings.upsert({
    where: { id: 'singleton' },
    update: { anthropicApiKey: key ? encrypt(key) : null },
    create: { id: 'singleton', anthropicApiKey: key ? encrypt(key) : null },
  });
  cache = null;
  clients.clear();
}

const clients = new Map<string, Anthropic>();

/** A client for the current key, or null when no key is configured. One client per key. */
export async function anthropicClient(): Promise<Anthropic | null> {
  const { key } = await resolveKey();
  if (!key) return null;
  let c = clients.get(key);
  if (!c) { c = new Anthropic({ apiKey: key }); clients.set(key, c); }
  return c;
}

/** "…a1B2" — enough to tell which key is in use, never the key itself. */
export const keyHint = (key: string | null) => (key ? `…${key.slice(-4)}` : null);
