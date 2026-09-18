/** Real `App\Enums\LeadSource` labels/colors — used for badges and the source Select.
 * Static app configuration (not user data), so it lives here rather than in a database table. */
export const LEAD_SOURCE_META: Record<string, { label: string; color: string }> = {
  meta: { label: 'Meta', color: '#1877f2' },
  instagram: { label: 'Instagram', color: '#e1306c' },
  tiktok: { label: 'TikTok', color: '#000000' },
  linkedin: { label: 'LinkedIn', color: '#0a66c2' },
  whatsapp: { label: 'WhatsApp', color: '#25d366' },
  viber: { label: 'Viber', color: '#7360f2' },
  telegram: { label: 'Telegram', color: '#26a5e4' },
  twitter: { label: 'Twitter / X', color: '#000000' },
  snapchat: { label: 'Snapchat', color: '#fffc00' },
  pinterest: { label: 'Pinterest', color: '#e60023' },
  google_ads: { label: 'Google Ads', color: '#4285f4' },
  youtube: { label: 'YouTube', color: '#ff0000' },
  microsoft_ads: { label: 'Microsoft Ads', color: '#00a4ef' },
  email: { label: 'Email', color: '#64748b' },
  typeform: { label: 'Typeform', color: '#262627' },
  jotform: { label: 'JotForm', color: '#ff6100' },
  calendly: { label: 'Calendly', color: '#006bff' },
  web_form: { label: 'Website Form', color: '#0f1d35' },
  manual: { label: 'Manual', color: '#667085' },
  other: { label: 'Other', color: '#98a2b3' },
};
