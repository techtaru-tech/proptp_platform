#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Slack, SlackError, configFromEnv } from './slack.js';

/**
 * Slack for Claude, over MCP (stdio).
 *
 * stdout belongs to the protocol, so everything meant for a person goes to stderr.
 *
 * Set SLACK_MCP_READ_ONLY=true and the tools that change anything are not offered at all —
 * the safest way to let an assistant look around a workspace.
 */

const slack = (() => {
  try {
    return new Slack(configFromEnv());
  } catch (err) {
    console.error(`slack-mcp: ${(err as Error).message}`);
    process.exit(1);
  }
})();

const READ_ONLY = /^(1|true|yes)$/i.test(process.env.SLACK_MCP_READ_ONLY ?? '');
const server = new McpServer({ name: 'slack', version: '1.0.0' });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const failure = (err: unknown) => ({
  isError: true,
  content: [{ type: 'text' as const, text: err instanceof SlackError ? err.message : `Unexpected error: ${(err as Error)?.message ?? String(err)}` }],
});

/** Wraps a handler so a Slack error becomes a tool error the model can read and act on. */
function safe<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      return text(await fn(args));
    } catch (err) {
      return failure(err);
    }
  };
}

const iso = (ts?: string) => (ts ? new Date(Number(ts) * 1000).toISOString() : undefined);

const userNames = new Map<string, string>();
async function userName(id?: string): Promise<string | undefined> {
  if (!id) return undefined;
  const cached = userNames.get(id);
  if (cached) return cached;
  try {
    const { user } = await slack.call<{ user: { name: string; real_name?: string; profile?: { display_name?: string } } }>('users.info', { user: id });
    const name = user.profile?.display_name || user.real_name || user.name;
    userNames.set(id, name);
    return name;
  } catch {
    return id; // a deleted user or a missing scope should not break reading a channel
  }
}

/** Turns <@U123> mentions into @name so a message reads as a person wrote it. */
async function readable(raw: string): Promise<string> {
  const ids = [...new Set([...raw.matchAll(/<@([UW][A-Z0-9]+)>/g)].map((m) => m[1]))];
  let out = raw;
  for (const id of ids) out = out.replaceAll(`<@${id}>`, `@${(await userName(id)) ?? id}`);
  return out;
}

const channelIds = new Map<string, string>();
/** A channel ID, or a name with or without the #, to an ID. */
async function channelId(input: string): Promise<string> {
  const value = input.trim();
  if (/^[CGD][A-Z0-9]{6,}$/.test(value)) return value;
  const name = value.replace(/^#/, '').toLowerCase();
  const known = channelIds.get(name);
  if (known) return known;

  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const res = await slack.call<{ channels: { id: string; name: string }[]; response_metadata?: { next_cursor?: string } }>('conversations.list', {
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
      cursor,
    });
    for (const c of res.channels) channelIds.set(c.name.toLowerCase(), c.id);
    if (channelIds.has(name)) return channelIds.get(name)!;
    cursor = res.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  throw new SlackError(`No channel called "${name}" that the bot can see. Private channels only show up once the bot has been invited.`, 'channel_not_found');
}

async function shapeMessage(m: any) {
  return {
    ts: m.ts,
    time: iso(m.ts),
    user: (await userName(m.user)) ?? m.username ?? (m.bot_id ? 'bot' : undefined),
    text: await readable(m.text ?? ''),
    thread_ts: m.thread_ts && m.thread_ts !== m.ts ? m.thread_ts : undefined,
    reply_count: m.reply_count || undefined,
    reactions: m.reactions?.map((r: any) => `${r.name} x${r.count}`),
    files: m.files?.map((f: any) => f.name),
  };
}

const readOnly = { readOnlyHint: true, openWorldHint: true } as const;
const writes = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

server.registerTool(
  'slack_list_channels',
  {
    title: 'List channels',
    description: 'Lists the Slack channels the bot can see, with their IDs, whether the bot is a member, and the topic. Use the ID (or the name) with the other tools.',
    inputSchema: {
      types: z.enum(['public', 'private', 'all']).default('public').describe('Which channels to list'),
      limit: z.number().int().min(1).max(200).default(100),
      cursor: z.string().optional().describe('next_cursor from a previous call, for the next page'),
      exclude_archived: z.boolean().default(true),
    },
    annotations: { title: 'List channels', ...readOnly },
  },
  safe(async ({ types, limit, cursor, exclude_archived }) => {
    const res = await slack.call<any>('conversations.list', {
      types: types === 'public' ? 'public_channel' : types === 'private' ? 'private_channel' : 'public_channel,private_channel',
      limit,
      cursor,
      exclude_archived,
    });
    return {
      channels: res.channels.map((c: any) => ({
        id: c.id,
        name: c.name,
        private: !!c.is_private,
        member: !!c.is_member,
        members: c.num_members,
        topic: c.topic?.value || undefined,
        purpose: c.purpose?.value || undefined,
      })),
      next_cursor: res.response_metadata?.next_cursor || undefined,
    };
  })
);

server.registerTool(
  'slack_get_channel_history',
  {
    title: 'Read channel messages',
    description: 'Reads recent messages from a channel, newest first. The bot must be a member. Messages that started a thread show reply_count; read the replies with slack_get_thread.',
    inputSchema: {
      channel: z.string().describe('Channel ID (C0123...) or name (#general)'),
      limit: z.number().int().min(1).max(100).default(20),
      oldest: z.string().optional().describe('Only messages after this ts (Unix seconds, e.g. 1760000000.000000)'),
      latest: z.string().optional().describe('Only messages before this ts'),
      cursor: z.string().optional(),
    },
    annotations: { title: 'Read channel messages', ...readOnly },
  },
  safe(async ({ channel, limit, oldest, latest, cursor }) => {
    const id = await channelId(channel);
    const res = await slack.call<any>('conversations.history', { channel: id, limit, oldest, latest, cursor });
    return {
      channel: id,
      messages: await Promise.all(res.messages.map(shapeMessage)),
      has_more: !!res.has_more,
      next_cursor: res.response_metadata?.next_cursor || undefined,
    };
  })
);

server.registerTool(
  'slack_get_thread',
  {
    title: 'Read a thread',
    description: 'Reads a message and all the replies under it.',
    inputSchema: {
      channel: z.string().describe('Channel ID or name'),
      thread_ts: z.string().describe('The ts of the first message of the thread'),
      limit: z.number().int().min(1).max(200).default(50),
    },
    annotations: { title: 'Read a thread', ...readOnly },
  },
  safe(async ({ channel, thread_ts, limit }) => {
    const id = await channelId(channel);
    const res = await slack.call<any>('conversations.replies', { channel: id, ts: thread_ts, limit });
    return { channel: id, messages: await Promise.all(res.messages.map(shapeMessage)), has_more: !!res.has_more };
  })
);

server.registerTool(
  'slack_list_users',
  {
    title: 'List people',
    description: 'Lists the people in the workspace: ID, username, real name, title and whether they are a bot. Deactivated accounts are left out.',
    inputSchema: {
      limit: z.number().int().min(1).max(200).default(100),
      cursor: z.string().optional(),
    },
    annotations: { title: 'List people', ...readOnly },
  },
  safe(async ({ limit, cursor }) => {
    const res = await slack.call<any>('users.list', { limit, cursor });
    return {
      users: res.members
        .filter((u: any) => !u.deleted)
        .map((u: any) => ({ id: u.id, username: u.name, name: u.real_name || u.profile?.display_name, title: u.profile?.title || undefined, bot: !!u.is_bot })),
      next_cursor: res.response_metadata?.next_cursor || undefined,
    };
  })
);

server.registerTool(
  'slack_get_user',
  {
    title: 'Look up a person',
    description: 'Details for one person by user ID (U0123...): name, title, timezone and email where the app may see it.',
    inputSchema: { user: z.string().describe('User ID') },
    annotations: { title: 'Look up a person', ...readOnly },
  },
  safe(async ({ user }) => {
    const { user: u } = await slack.call<any>('users.info', { user });
    return { id: u.id, username: u.name, name: u.real_name, title: u.profile?.title || undefined, email: u.profile?.email, timezone: u.tz, bot: !!u.is_bot, deactivated: !!u.deleted };
  })
);

server.registerTool(
  'slack_search_messages',
  {
    title: 'Search messages',
    description: 'Searches messages across the workspace. Slack only allows this with a user token, so it needs SLACK_USER_TOKEN (xoxp-, scope search:read). Supports Slack search operators such as in:#channel, from:@person, before:2026-10-01.',
    inputSchema: {
      query: z.string().describe('Search text, with optional Slack operators'),
      count: z.number().int().min(1).max(50).default(10),
      page: z.number().int().min(1).default(1),
    },
    annotations: { title: 'Search messages', ...readOnly },
  },
  safe(async ({ query, count, page }) => {
    const res = await slack.call<any>('search.messages', { query, count, page, sort: 'timestamp', sort_dir: 'desc' }, 'user');
    return {
      total: res.messages?.total,
      matches: (res.messages?.matches ?? []).map((m: any) => ({
        channel: m.channel?.name ? `#${m.channel.name}` : m.channel?.id,
        channel_id: m.channel?.id,
        user: m.username,
        ts: m.ts,
        time: iso(m.ts),
        text: m.text,
        permalink: m.permalink,
      })),
    };
  })
);

// ---------------------------------------------------------------------------
// Writing — not offered at all in read-only mode.
// ---------------------------------------------------------------------------

if (!READ_ONLY) {
  server.registerTool(
    'slack_post_message',
    {
      title: 'Post a message',
      description: 'Posts a message to a channel, or as a reply in a thread when thread_ts is given. This is visible to everyone in the channel: write it as you would for people, and do not post secrets.',
      inputSchema: {
        channel: z.string().describe('Channel ID or name'),
        text: z.string().min(1).max(40000).describe('Message text; Slack mrkdwn is supported (*bold*, _italic_, <https://x|link>, <@U123>)'),
        thread_ts: z.string().optional().describe('Reply inside this thread instead of the channel'),
      },
      annotations: { title: 'Post a message', ...writes },
    },
    safe(async ({ channel, text: body, thread_ts }) => {
      const id = await channelId(channel);
      const res = await slack.call<any>('chat.postMessage', { channel: id, text: body, thread_ts });
      return { posted: true, channel: res.channel, ts: res.ts, thread_ts: thread_ts ?? undefined };
    })
  );

  server.registerTool(
    'slack_add_reaction',
    {
      title: 'Add a reaction',
      description: 'Adds an emoji reaction to a message.',
      inputSchema: {
        channel: z.string().describe('Channel ID or name'),
        timestamp: z.string().describe('The ts of the message to react to'),
        name: z.string().describe('Emoji name without colons, e.g. white_check_mark'),
      },
      annotations: { title: 'Add a reaction', ...writes },
    },
    safe(async ({ channel, timestamp, name }) => {
      const id = await channelId(channel);
      await slack.call('reactions.add', { channel: id, timestamp, name: name.replace(/:/g, '') });
      return { reacted: true, channel: id, timestamp, name };
    })
  );

  server.registerTool(
    'slack_join_channel',
    {
      title: 'Join a public channel',
      description: 'Makes the bot join a public channel so it can read it and post in it. Private channels need an invitation from a member instead.',
      inputSchema: { channel: z.string().describe('Channel ID or name') },
      annotations: { title: 'Join a public channel', ...writes },
    },
    safe(async ({ channel }) => {
      const id = await channelId(channel);
      const res = await slack.call<any>('conversations.join', { channel: id });
      return { joined: true, channel: res.channel?.id ?? id, name: res.channel?.name };
    })
  );
}

// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`slack-mcp: ready${READ_ONLY ? ' (read-only)' : ''}${slack.hasUserToken ? ', search enabled' : ', search disabled (no SLACK_USER_TOKEN)'}.`);
