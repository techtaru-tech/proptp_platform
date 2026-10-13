/**
 * A small Slack Web API client. Only what the tools need, over plain fetch, so the server has
 * no Slack SDK to keep in step with.
 *
 * Two tokens exist because Slack draws a line between them: a bot token (xoxb-) does nearly
 * everything, but `search.messages` is only open to a user token (xoxp-).
 */

export class SlackError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

/** What a person needs to do about the error codes that come up in practice. */
const HINTS: Record<string, string> = {
  not_in_channel: 'The bot is not a member of that channel. Invite it (/invite @bot) or use slack_join_channel for a public channel.',
  channel_not_found: 'No such channel, or it is private and the bot has not been invited.',
  missing_scope: 'The Slack app is missing a permission (scope) for this. Add it under OAuth & Permissions and reinstall the app.',
  invalid_auth: 'Slack rejected the token. Check SLACK_BOT_TOKEN.',
  token_revoked: 'The token has been revoked. Reinstall the Slack app and use the new token.',
  account_inactive: 'The token belongs to a deactivated user or an uninstalled app.',
  ratelimited: 'Slack is rate limiting this app. Wait a moment and try again.',
  is_archived: 'That channel is archived.',
  message_not_found: 'No message with that timestamp in that channel.',
  already_reacted: 'The bot has already added that reaction.',
  users_not_found: 'No such user.',
  user_not_found: 'No such user.',
  no_text: 'The message text is empty.',
  not_allowed_token_type: 'This call needs a user token (SLACK_USER_TOKEN), not a bot token.',
};

export interface SlackConfig {
  botToken: string;
  userToken?: string;
  apiUrl: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): SlackConfig {
  const botToken = (env.SLACK_BOT_TOKEN ?? '').trim();
  if (!botToken) {
    throw new Error('SLACK_BOT_TOKEN is not set. Create a Slack app, install it to your workspace and pass its Bot User OAuth Token (xoxb-...). See README.md.');
  }
  return {
    botToken,
    userToken: (env.SLACK_USER_TOKEN ?? '').trim() || undefined,
    apiUrl: (env.SLACK_API_URL ?? 'https://slack.com/api').replace(/\/+$/, ''),
  };
}

export class Slack {
  constructor(private readonly config: SlackConfig) {}

  get hasUserToken(): boolean {
    return !!this.config.userToken;
  }

  async call<T = any>(method: string, params: Record<string, unknown> = {}, as: 'bot' | 'user' = 'bot'): Promise<T> {
    const token = as === 'user' ? this.config.userToken : this.config.botToken;
    if (!token) throw new SlackError('This needs SLACK_USER_TOKEN (a user token, xoxp-...), which is not set.', 'not_allowed_token_type');

    // Slack accepts form bodies everywhere and JSON only on some methods, so form it is.
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      body.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }

    const res = await fetch(`${this.config.apiUrl}/${method}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body,
    });

    if (res.status === 429) {
      const wait = res.headers.get('retry-after');
      throw new SlackError(`Slack is rate limiting this app${wait ? `; retry in ${wait}s` : ''}.`, 'ratelimited');
    }
    if (!res.ok) throw new SlackError(`Slack answered HTTP ${res.status}.`, `http_${res.status}`);

    const data = (await res.json()) as { ok: boolean; error?: string; needed?: string } & T;
    if (!data.ok) {
      const code = data.error ?? 'unknown_error';
      const hint = HINTS[code];
      const needed = data.needed ? ` Needed scope: ${data.needed}.` : '';
      throw new SlackError(`Slack error "${code}".${hint ? ` ${hint}` : ''}${needed}`, code);
    }
    return data;
  }
}
