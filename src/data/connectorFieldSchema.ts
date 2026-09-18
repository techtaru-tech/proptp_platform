import type { LeadSource } from '../types';

export interface ConnectorField {
  name: string;
  label: string;
  required: boolean;
  /** Matches the real system's `/(secret|password|token)/i` field-name check — rendered as a masked, revealable password input. */
  masked: boolean;
}

/**
 * Verbatim port of each connector's `getConnectionFormSchema()` in the real Laravel CRM
 * (`app/Services/LeadSources/*Connector.php`). Every field is rendered as a plain text
 * input there too (the generic Filament mapper does not turn `array`/`boolean`/`integer`
 * declarations into different component types) — only the secret/password/token masking
 * is real, everything else is a TextInput regardless of its declared type.
 */
export const CONNECTOR_FIELDS: Partial<Record<LeadSource, ConnectorField[]>> = {
  meta: [
    { name: 'app_id', label: 'App ID', required: true, masked: false },
    { name: 'app_secret', label: 'App Secret', required: true, masked: true },
    { name: 'page_access_token', label: 'Page Access Token (auto-filled via OAuth)', required: false, masked: true },
    { name: 'page_id', label: 'Page ID', required: false, masked: false },
  ],
  instagram: [
    { name: 'app_id', label: 'App ID', required: true, masked: false },
    { name: 'app_secret', label: 'App Secret', required: true, masked: true },
    { name: 'page_access_token', label: 'Page Access Token', required: true, masked: true },
    { name: 'qualification_keywords', label: 'Qualification Keywords (comma-separated)', required: false, masked: false },
  ],
  tiktok: [
    { name: 'client_key', label: 'Client Key (App ID)', required: true, masked: false },
    { name: 'client_secret', label: 'Client Secret', required: true, masked: true },
    { name: 'access_token', label: 'Access Token (auto-filled via OAuth)', required: false, masked: true },
  ],
  linkedin: [
    { name: 'client_id', label: 'Client ID', required: true, masked: false },
    { name: 'client_secret', label: 'Client Secret', required: true, masked: true },
    { name: 'access_token', label: 'Access Token', required: true, masked: true },
    { name: 'organization_id', label: 'Organization ID', required: false, masked: false },
  ],
  google_ads: [
    { name: 'developer_token', label: 'Developer Token', required: true, masked: true },
    { name: 'client_id', label: 'Client ID', required: true, masked: false },
    { name: 'client_secret', label: 'Client Secret', required: true, masked: true },
    { name: 'refresh_token', label: 'Refresh Token', required: true, masked: true },
    { name: 'customer_id', label: 'Customer ID', required: true, masked: false },
    { name: 'webhook_secret', label: 'Webhook Secret', required: false, masked: true },
  ],
  microsoft_ads: [
    { name: 'client_id', label: 'Client ID', required: true, masked: false },
    { name: 'client_secret', label: 'Client Secret', required: true, masked: true },
    { name: 'refresh_token', label: 'Refresh Token', required: true, masked: true },
    { name: 'developer_token', label: 'Developer Token', required: true, masked: true },
    { name: 'account_id', label: 'Account ID', required: true, masked: false },
    { name: 'webhook_secret', label: 'Webhook Secret', required: false, masked: true },
  ],
  youtube: [
    { name: 'developer_token', label: 'Developer Token', required: true, masked: true },
    { name: 'client_id', label: 'Client ID', required: true, masked: false },
    { name: 'client_secret', label: 'Client Secret', required: true, masked: true },
    { name: 'refresh_token', label: 'Refresh Token', required: true, masked: true },
    { name: 'customer_id', label: 'Customer ID', required: true, masked: false },
    { name: 'channel_id', label: 'Channel ID', required: false, masked: false },
    { name: 'webhook_secret', label: 'Webhook Secret', required: false, masked: true },
  ],
  pinterest: [
    { name: 'app_id', label: 'App ID', required: true, masked: false },
    { name: 'app_secret', label: 'App Secret', required: true, masked: true },
    { name: 'access_token', label: 'Access Token', required: true, masked: true },
    { name: 'ad_account_id', label: 'Ad Account ID', required: false, masked: false },
  ],
  snapchat: [
    { name: 'client_id', label: 'Client ID', required: true, masked: false },
    { name: 'client_secret', label: 'Client Secret', required: true, masked: true },
    { name: 'app_secret', label: 'App Secret', required: true, masked: true },
    { name: 'access_token', label: 'Access Token', required: true, masked: true },
  ],
  twitter: [
    { name: 'consumer_key', label: 'Consumer Key', required: true, masked: false },
    { name: 'consumer_secret', label: 'Consumer Secret', required: true, masked: true },
    { name: 'access_token', label: 'Access Token', required: true, masked: true },
    { name: 'access_secret', label: 'Access Secret', required: true, masked: true },
  ],
  typeform: [
    { name: 'access_token', label: 'Access Token', required: true, masked: true },
    { name: 'webhook_secret', label: 'Webhook Secret', required: false, masked: true },
    { name: 'field_mapping', label: 'Field Mapping (field_ref => lead_field)', required: false, masked: false },
  ],
  jotform: [
    { name: 'api_key', label: 'API Key', required: true, masked: true },
    { name: 'form_id', label: 'Form ID', required: false, masked: false },
    { name: 'field_mapping', label: 'Field Mapping (field_name => lead_field)', required: false, masked: false },
  ],
  calendly: [
    { name: 'personal_access_token', label: 'Personal Access Token', required: true, masked: true },
    { name: 'webhook_signing_key', label: 'Webhook Signing Key', required: false, masked: true },
    { name: 'organization_uri', label: 'Organization URI', required: false, masked: false },
  ],
  whatsapp: [
    { name: 'app_id', label: 'App ID', required: true, masked: false },
    { name: 'app_secret', label: 'App Secret', required: true, masked: true },
    { name: 'phone_number_id', label: 'Phone Number ID', required: true, masked: false },
    { name: 'access_token', label: 'Access Token', required: true, masked: true },
    { name: 'qualification_keywords', label: 'Qualification Keywords (comma-separated)', required: false, masked: false },
  ],
  viber: [
    { name: 'auth_token', label: 'Auth Token', required: true, masked: true },
    { name: 'bot_name', label: 'Bot Name', required: false, masked: false },
    { name: 'qualification_keywords', label: 'Qualification Keywords (comma-separated)', required: false, masked: false },
  ],
  telegram: [
    { name: 'bot_token', label: 'Bot Token', required: true, masked: true },
    { name: 'webhook_secret', label: 'Webhook Secret', required: false, masked: true },
    { name: 'qualification_keywords', label: 'Qualification Keywords (comma-separated)', required: false, masked: false },
  ],
  email: [
    { name: 'host', label: 'IMAP Host', required: true, masked: false },
    { name: 'port', label: 'IMAP Port (993 for SSL)', required: true, masked: false },
    { name: 'username', label: 'Username', required: true, masked: false },
    { name: 'password', label: 'Password', required: true, masked: true },
    { name: 'ssl', label: 'Use SSL', required: false, masked: false },
  ],
  web_form: [],
  manual: [],
};

/** Sources whose connector declares no credential fields — the real form shows a plain notice instead. */
export function requiresNoCredentials(source: LeadSource): boolean {
  return (CONNECTOR_FIELDS[source] ?? []).length === 0;
}
