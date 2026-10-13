import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Runs the real server over stdio against a stand-in Slack, so what is checked is what Claude
 * would experience: the tool list, what each tool returns, and what an error looks like.
 */

let fails = 0;
const ok = (cond: boolean, msg: string, extra?: unknown) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) { fails++; if (extra !== undefined) console.log('      ', JSON.stringify(extra).slice(0, 400)); }
};

// ---- a stand-in Slack ------------------------------------------------------
const calls: { method: string; auth: string; params: Record<string, string> }[] = [];
let rateLimit = false;
const CHANNELS = [
  { id: 'C0SALES01', name: 'sales', is_private: false, is_member: true, num_members: 12, topic: { value: 'Leads and follow-ups' }, purpose: { value: '' } },
  { id: 'C0RANDOM1', name: 'random', is_private: false, is_member: false, num_members: 30, topic: { value: '' }, purpose: { value: '' } },
  { id: 'G0PRIVATE', name: 'founders', is_private: true, is_member: true, num_members: 3, topic: { value: '' }, purpose: { value: '' } },
];
const USERS: Record<string, any> = {
  U0PAWAN001: { id: 'U0PAWAN001', name: 'pawan', real_name: 'Pawan Kumawat', tz: 'Asia/Kolkata', profile: { title: 'Owner', display_name: 'Pawan', email: 'p@x.in' } },
  U0SWATI001: { id: 'U0SWATI001', name: 'swati', real_name: 'Swati Mehta', profile: { title: 'Sales', display_name: '' } },
  U0GONE0001: { id: 'U0GONE0001', name: 'gone', real_name: 'Gone', deleted: true, profile: {} },
};

const slack = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const method = (req.url ?? '').replace(/^\/api\//, '');
    const params = Object.fromEntries(new URLSearchParams(raw));
    calls.push({ method, auth: String(req.headers.authorization ?? ''), params });
    res.setHeader('content-type', 'application/json');
    const reply = (obj: unknown, status = 200) => { res.statusCode = status; res.end(JSON.stringify(obj)); };
    if (rateLimit) { res.setHeader('retry-after', '7'); return reply({ ok: false, error: 'ratelimited' }, 429); }
    if (!/^Bearer xox[bp]-/.test(String(req.headers.authorization))) return reply({ ok: false, error: 'invalid_auth' });
    switch (method) {
      case 'conversations.list': return reply({ ok: true, channels: CHANNELS.filter((c) => !(params.types === 'public_channel' && c.is_private)), response_metadata: { next_cursor: '' } });
      case 'conversations.history':
        if (params.channel === 'C0RANDOM1') return reply({ ok: false, error: 'not_in_channel' });
        return reply({ ok: true, has_more: false, messages: [
          { ts: '1760000300.000100', user: 'U0SWATI001', text: 'Hi <@U0PAWAN001>, Chiranjivi lead called back', reply_count: 2, thread_ts: '1760000300.000100', reactions: [{ name: 'eyes', count: 1 }] },
          { ts: '1760000100.000200', user: 'U0PAWAN001', text: 'Morning team' },
        ] });
      case 'conversations.replies': return reply({ ok: true, has_more: false, messages: [{ ts: params.ts, user: 'U0SWATI001', text: 'thread root', thread_ts: params.ts }, { ts: '1760000400.000100', user: 'U0PAWAN001', text: 'On it', thread_ts: params.ts }] });
      case 'conversations.join': return reply({ ok: true, channel: { id: params.channel, name: 'random' } });
      case 'chat.postMessage': return reply({ ok: true, channel: params.channel, ts: '1760000999.000100' });
      case 'reactions.add': return reply({ ok: true });
      case 'users.list': return reply({ ok: true, members: Object.values(USERS), response_metadata: { next_cursor: '' } });
      case 'users.info': return USERS[params.user] ? reply({ ok: true, user: USERS[params.user] }) : reply({ ok: false, error: 'user_not_found' });
      case 'search.messages':
        if (!params.query) return reply({ ok: false, error: 'invalid_arguments' });
        return reply({ ok: true, messages: { total: 1, matches: [{ channel: { id: 'C0SALES01', name: 'sales' }, username: 'swati', ts: '1760000300.000100', text: 'Chiranjivi lead called back', permalink: 'https://x.slack.com/archives/C0SALES01/p1' }] } });
      default: return reply({ ok: false, error: 'unknown_method' });
    }
  });
});

// ---- helpers ---------------------------------------------------------------
async function connect(env: Record<string, string>) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/index.ts'],
    env: { PATH: process.env.PATH ?? '', ...env },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(transport);
  return { client, transport };
}
const run = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const r: any = await client.callTool({ name, arguments: args });
  const t = r.content?.[0]?.text ?? '';
  let json: any; try { json = JSON.parse(t); } catch { json = undefined; }
  return { isError: !!r.isError, text: t as string, json };
};
const last = (method: string) => [...calls].reverse().find((c) => c.method === method);

async function main() {
  await new Promise<void>((r) => slack.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(slack.address() as any).port}/api`;

  console.log('\n== start-up');
  const noToken = spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts'], { env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8' });
  ok(noToken.status === 1 && /SLACK_BOT_TOKEN is not set/.test(noToken.stderr) && noToken.stdout === '', 'no token: exits with a clear message and writes nothing to stdout', { status: noToken.status, err: noToken.stderr });

  const { client } = await connect({ SLACK_BOT_TOKEN: 'xoxb-test-bot', SLACK_API_URL: base });

  console.log('\n== tools');
  const tools = (await client.listTools()).tools;
  const names = tools.map((t) => t.name).sort();
  ok(names.length === 9, 'nine tools are offered', names);
  ok(tools.filter((t) => t.annotations?.readOnlyHint).length === 6, 'the six that only read are marked read-only', tools.map((t) => [t.name, t.annotations?.readOnlyHint]));
  ok(tools.every((t) => t.inputSchema?.type === 'object' && t.description), 'each has a description and a schema');

  console.log('\n== reading');
  let r = await run(client, 'slack_list_channels', { types: 'all' });
  ok(!r.isError && r.json.channels.length === 3 && r.json.channels[0].id === 'C0SALES01' && r.json.channels[1].member === false && r.json.channels[2].private === true, 'channels listed with id, member and private flags', r.text.slice(0, 200));
  r = await run(client, 'slack_get_channel_history', { channel: '#sales', limit: 5 });
  ok(!r.isError && r.json.channel === 'C0SALES01', 'a channel name is resolved to its id', r.text.slice(0, 200));
  ok(last('conversations.history')?.params.channel === 'C0SALES01' && last('conversations.history')?.params.limit === '5', 'and the id and limit reach Slack');
  ok(r.json.messages[0].user === 'Swati' || r.json.messages[0].user === 'Swati Mehta', 'author shown by name, not ID', r.json.messages[0]);
  ok(r.json.messages[0].text.includes('@Pawan') && !r.json.messages[0].text.includes('<@'), 'a mention reads as @Pawan', r.json.messages[0].text);
  ok(r.json.messages[0].reply_count === 2 && r.json.messages[0].reactions?.[0] === 'eyes x1' && r.json.messages[0].time === '2025-10-09T08:58:20.000Z', 'reply count, reactions and an ISO time are there', r.json.messages[0]);
  r = await run(client, 'slack_get_thread', { channel: 'C0SALES01', thread_ts: '1760000300.000100' });
  ok(!r.isError && r.json.messages.length === 2 && r.json.messages[1].text === 'On it', 'a thread reads in full');
  r = await run(client, 'slack_list_users', {});
  ok(!r.isError && r.json.users.length === 2 && !r.json.users.some((u: any) => u.username === 'gone'), 'people listed, deactivated ones left out', r.json?.users);
  r = await run(client, 'slack_get_user', { user: 'U0PAWAN001' });
  ok(r.json?.name === 'Pawan Kumawat' && r.json.timezone === 'Asia/Kolkata', 'one person looked up');

  console.log('\n== writing');
  r = await run(client, 'slack_post_message', { channel: 'sales', text: 'Booking confirmed for plot 41', thread_ts: '1760000300.000100' });
  ok(!r.isError && r.json.posted && r.json.ts === '1760000999.000100', 'message posted', r.text);
  const post = last('chat.postMessage')!;
  ok(post.params.channel === 'C0SALES01' && post.params.text === 'Booking confirmed for plot 41' && post.params.thread_ts === '1760000300.000100', 'to the right channel, as a thread reply');
  ok(post.auth === 'Bearer xoxb-test-bot', 'with the bot token');
  r = await run(client, 'slack_add_reaction', { channel: 'sales', timestamp: '1760000300.000100', name: ':white_check_mark:' });
  ok(!r.isError && last('reactions.add')?.params.name === 'white_check_mark', 'a reaction is added, colons stripped');
  r = await run(client, 'slack_join_channel', { channel: 'C0RANDOM1' });
  ok(!r.isError && r.json.joined === true, 'joined a public channel');

  console.log('\n== errors the model can act on');
  r = await run(client, 'slack_get_channel_history', { channel: 'C0RANDOM1' });
  ok(r.isError && /not a member/i.test(r.text) && /slack_join_channel|invite/i.test(r.text), 'not_in_channel explains what to do', r.text);
  r = await run(client, 'slack_get_channel_history', { channel: '#nope' });
  ok(r.isError && /No channel called "nope"/.test(r.text), 'an unknown channel name says so', r.text);
  r = await run(client, 'slack_search_messages', { query: 'Chiranjivi' });
  ok(r.isError && /SLACK_USER_TOKEN/.test(r.text), 'search without a user token says what is missing', r.text);
  r = await run(client, 'slack_get_user', { user: 'U0NOBODY0' });
  ok(r.isError && /No such user/.test(r.text), 'unknown user is a readable error', r.text);
  rateLimit = true;
  r = await run(client, 'slack_list_channels', {});
  ok(r.isError && /rate limiting/.test(r.text) && /7s/.test(r.text), 'rate limit says how long to wait', r.text);
  rateLimit = false;
  await client.close();

  console.log('\n== user token (search) and read-only mode');
  const search = await connect({ SLACK_BOT_TOKEN: 'xoxb-test-bot', SLACK_USER_TOKEN: 'xoxp-test-user', SLACK_API_URL: base });
  r = await run(search.client, 'slack_search_messages', { query: 'in:#sales Chiranjivi', count: 5 });
  ok(!r.isError && r.json.total === 1 && r.json.matches[0].channel === '#sales', 'search works with a user token', r.text.slice(0, 200));
  ok(last('search.messages')?.auth === 'Bearer xoxp-test-user', 'and it is the user token that is sent, not the bot token');
  await search.client.close();

  const ro = await connect({ SLACK_BOT_TOKEN: 'xoxb-test-bot', SLACK_API_URL: base, SLACK_MCP_READ_ONLY: 'true' });
  const roNames = (await ro.client.listTools()).tools.map((t) => t.name);
  ok(roNames.length === 6 && !roNames.some((n) => /post|reaction|join/.test(n)), 'read-only mode offers only the six reading tools', roNames);
  const before = calls.length;
  const attempt: any = await ro.client.callTool({ name: 'slack_post_message', arguments: { channel: 'sales', text: 'x' } }).catch((e) => ({ isError: true, content: [{ text: String(e.message) }] }));
  ok(attempt.isError && calls.length === before, 'and a post attempted anyway never reaches Slack');
  await ro.client.close();

  slack.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
