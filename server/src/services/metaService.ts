import crypto from 'crypto';
import axios from 'axios';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Verifies Meta's `X-Hub-Signature-256` header against the raw request body using the
 * app secret — this is the real Graph API webhook security check; a lead notification whose
 * signature doesn't match is never trusted (mirrors the real `invalid_signature` webhook_log state).
 */
export function verifySignature(rawBody: Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
  if (!signatureHeader) return false;
  const [algo, theirHash] = signatureHeader.split('=');
  if (algo !== 'sha256' || !theirHash) return false;
  const ourHash = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(theirHash), Buffer.from(ourHash));
  } catch {
    return false;
  }
}

export interface MetaFieldDatum {
  name: string;
  values: string[];
}

export interface MetaLeadData {
  id: string;
  created_time?: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  field_data: MetaFieldDatum[];
}

/** Fetches the full lead payload from Graph API — the webhook itself only ever carries the leadgen_id. */
export async function fetchLeadData(leadgenId: string, pageAccessToken: string): Promise<MetaLeadData> {
  const { data } = await axios.get(`${GRAPH_BASE}/${leadgenId}`, {
    params: {
      access_token: pageAccessToken,
      fields: 'id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data',
    },
  });
  return data;
}

/** Normalizes Meta's `field_data` question/answer array into the flat shape our Lead model expects. */
export function mapFieldDataToLead(fieldData: MetaFieldDatum[]) {
  const get = (...keys: string[]) => {
    for (const key of keys) {
      const match = fieldData.find((f) => f.name.toLowerCase().replace(/[^a-z]/g, '') === key);
      if (match?.values?.[0]) return match.values[0];
    }
    return undefined;
  };

  const fullName = get('fullname', 'name');
  let firstName = get('firstname');
  let lastName = get('lastname');
  if (!firstName && fullName) {
    const parts = fullName.trim().split(/\s+/);
    firstName = parts[0];
    lastName = parts.slice(1).join(' ') || undefined;
  }

  return {
    firstName: firstName || 'Unknown',
    lastName: lastName || '',
    email: get('email'),
    phone: get('phonenumber', 'phone'),
    city: get('city'),
    company: get('companyname', 'company'),
    jobTitle: get('jobtitle'),
  };
}

// ---------------------------------------------------------------------------
// OAuth — connecting a Facebook Page from the admin UI ("Connect with Facebook"),
// as an alternative to pasting a page access token in manually.
// ---------------------------------------------------------------------------

export function buildOAuthDialogUrl(appId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    scope: 'pages_show_list,pages_manage_metadata,pages_read_engagement,leads_retrieval',
  });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
}

export async function exchangeCodeForUserToken(code: string, appId: string, appSecret: string, redirectUri: string) {
  const { data } = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
    params: { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code },
  });
  return data.access_token as string;
}

export async function exchangeForLongLivedToken(shortToken: string, appId: string, appSecret: string) {
  const { data } = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortToken,
    },
  });
  return data.access_token as string;
}

export interface ManagedPage {
  id: string;
  name: string;
  access_token: string;
}

/** Page access tokens returned here (derived from a long-lived user token) do not expire on their own. */
export async function getManagedPages(userAccessToken: string): Promise<ManagedPage[]> {
  const { data } = await axios.get(`${GRAPH_BASE}/me/accounts`, {
    params: { access_token: userAccessToken },
  });
  return data.data ?? [];
}

/** Subscribes a Page to the app's `leadgen` webhook field — required before any leads will be delivered. */
export async function subscribePageToLeadgen(pageId: string, pageAccessToken: string): Promise<void> {
  await axios.post(`${GRAPH_BASE}/${pageId}/subscribed_apps`, null, {
    params: { subscribed_fields: 'leadgen', access_token: pageAccessToken },
  });
}

/**
 * The name of a lead form, cached for the life of the process.
 *
 * Worth a call of its own because Graph will not name the campaign or the ad unless the token
 * carries `ads_read`, and this account's does not. The form is the next best answer to "which
 * ad did this come from" — every ad on this account runs its own form — and `leads_retrieval`
 * is enough to read it.
 */
const formNames = new Map<string, string | null>();

export async function getFormName(formId: string, pageAccessToken: string): Promise<string | null> {
  if (!formId) return null;
  if (formNames.has(formId)) return formNames.get(formId) ?? null;

  try {
    const { data } = await axios.get(`${GRAPH_BASE}/${formId}`, {
      params: { access_token: pageAccessToken, fields: 'name' },
      timeout: 15_000,
    });
    const name = data?.name ? String(data.name) : null;
    formNames.set(formId, name);
    return name;
  } catch {
    // A form we cannot read is not worth failing an ingest over, and not worth asking twice.
    formNames.set(formId, null);
    return null;
  }
}

/** Verifies a page access token still works — used by the Integrations page's "Test" action. */
export async function testPageToken(pageId: string, pageAccessToken: string): Promise<{ success: boolean; message: string }> {
  try {
    const { data } = await axios.get(`${GRAPH_BASE}/${pageId}`, {
      params: { fields: 'id,name', access_token: pageAccessToken },
    });
    return { success: true, message: `Connected to Facebook Page "${data.name}".` };
  } catch (err) {
    const message = axios.isAxiosError(err) ? err.response?.data?.error?.message ?? err.message : 'Unknown error';
    return { success: false, message };
  }
}
