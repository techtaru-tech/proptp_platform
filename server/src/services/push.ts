import fs from 'fs';
import path from 'path';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';

/**
 * Firebase Cloud Messaging, HTTP v1.
 *
 * Written against the REST API rather than pulling in firebase-admin: all it needs is a
 * signed JWT, a token exchange and one POST, and the SDK would add tens of megabytes of
 * dependencies to a box that already has to be careful about memory during a build.
 *
 * The service account is never committed. It is read from a file outside git, or from an
 * environment variable for hosts that only offer those.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const REQUEST_TIMEOUT_MS = 15_000;

/** Sent one at a time; a handful in flight is plenty and keeps FCM from rate-limiting us. */
const CONCURRENCY = 8;

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let cachedAccount: ServiceAccount | null | undefined;
let cachedToken: { value: string; expiresAt: number } | null = null;

/** Where the credentials live, in the order a deployment is likely to provide them. */
function readServiceAccount(): ServiceAccount | null {
  if (cachedAccount !== undefined) return cachedAccount;

  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  const file = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    || path.join(process.cwd(), 'firebase-service-account.json');

  try {
    const raw = inline && inline.trim().startsWith('{')
      ? inline
      : fs.existsSync(file)
        ? fs.readFileSync(file, 'utf8')
        : null;

    if (!raw) {
      cachedAccount = null;
      return null;
    }

    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      console.error('[push] the service account is missing project_id, client_email or private_key');
      cachedAccount = null;
      return null;
    }

    // A key pasted into an env var arrives with its newlines escaped.
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    cachedAccount = parsed;
    return parsed;
  } catch (err) {
    console.error('[push] could not read the Firebase service account:', err);
    cachedAccount = null;
    return null;
  }
}

export function isPushConfigured(): boolean {
  return readServiceAccount() !== null;
}

/** The project push goes to, for the settings screen to show which Firebase this is. */
export function pushProjectId(): string | null {
  return readServiceAccount()?.project_id ?? null;
}

/**
 * Google's access token, cached. It lasts an hour; it is renewed a minute early so a send
 * that starts just before the boundary cannot finish just after it.
 */
async function accessToken(account: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    { iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 },
    account.private_key,
    { algorithm: 'RS256' }
  );

  const { data } = await axios.post(
    TOKEN_URL,
    new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: REQUEST_TIMEOUT_MS }
  );

  cachedToken = {
    value: String(data.access_token),
    expiresAt: Date.now() + (Number(data.expires_in ?? 3600) - 60) * 1000,
  };
  return cachedToken.value;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Extra values the app reads to decide where to navigate. Must all be strings for FCM. */
  data?: Record<string, string>;
}

export interface PushOutcome {
  token: string;
  ok: boolean;
  /** Set when Firebase says this token will never work again, so it can be forgotten. */
  unregistered?: boolean;
  error?: string;
}

async function sendOne(
  account: ServiceAccount,
  bearer: string,
  token: string,
  message: PushMessage
): Promise<PushOutcome> {
  try {
    await axios.post(
      `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
      {
        message: {
          token,
          notification: { title: message.title, body: message.body },
          data: message.data,
          android: { priority: 'HIGH', notification: { sound: 'default' } },
          apns: { payload: { aps: { sound: 'default' } } },
        },
      },
      { headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT_MS }
    );
    return { token, ok: true };
  } catch (err) {
    const data = axios.isAxiosError(err) ? err.response?.data : undefined;
    const status = String(data?.error?.details?.[0]?.errorCode ?? data?.error?.status ?? '');
    const detail = String(data?.error?.message ?? (err instanceof Error ? err.message : err));

    // The app was uninstalled, or the token was replaced. Keeping it would mean failing on
    // every broadcast from now on.
    const unregistered = status === 'UNREGISTERED' || status === 'NOT_FOUND' || /not.*registered/i.test(detail);
    return { token, ok: false, unregistered, error: detail };
  }
}

/**
 * Pushes one message to many device tokens. Never throws: a broadcast is worth recording even
 * when Firebase is unreachable, and the caller decides what a failure means.
 *
 * Tokens Firebase rejects as dead are cleared from the users holding them, so the next
 * broadcast is not slowed down by addresses that can never receive anything.
 */
export async function sendPush(tokens: string[], message: PushMessage): Promise<PushOutcome[]> {
  const account = readServiceAccount();
  const unique = Array.from(new Set(tokens.filter(Boolean)));
  if (unique.length === 0) return [];

  if (!account) {
    return unique.map((token) => ({ token, ok: false, error: 'Push is not configured on this server.' }));
  }

  let bearer: string;
  try {
    bearer = await accessToken(account);
  } catch (err) {
    const detail = axios.isAxiosError(err)
      ? String(err.response?.data?.error_description ?? err.message)
      : err instanceof Error ? err.message : String(err);
    console.error('[push] could not authenticate with Firebase:', detail);
    return unique.map((token) => ({ token, ok: false, error: `Firebase rejected the service account: ${detail}` }));
  }

  const outcomes: PushOutcome[] = [];
  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const batch = unique.slice(i, i + CONCURRENCY);
    outcomes.push(...(await Promise.all(batch.map((token) => sendOne(account, bearer, token, message)))));
  }

  const dead = outcomes.filter((o) => o.unregistered).map((o) => o.token);
  if (dead.length > 0) {
    await prisma.user
      .updateMany({ where: { fcmToken: { in: dead } }, data: { fcmToken: null } })
      .catch((err) => console.error('[push] could not clear dead device tokens:', err));
  }

  return outcomes;
}
