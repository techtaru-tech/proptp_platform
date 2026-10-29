import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Upload } from 'lucide-react';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Card, CardHeader } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Textarea } from '../../../components/ui/Textarea';
import { Select } from '../../../components/ui/Select';
import { CardSkeleton } from '../../../components/ui/LoadingSkeleton';
import { useToast } from '../../../context/ToastContext';
import { fileUrl, uploadFiles } from '../../../services/apiClient';
import { getBroadcastSource } from '../../../services/whatsappTemplateService';
import { createCampaign, getCampaign, getDefaultCopy, updateCampaign } from '../../../services/waCampaignService';
import type { ApprovedWhatsAppTemplate, WaCampaignInput, WaCampaignKind } from '../../../types';

const COPY_LABELS: [string, string][] = [
  ['M02', 'M02 — Which language for the demo?'],
  ['M03', 'M03 — English demo caption'],
  ['M04', 'M04 — Hindi demo caption'],
  ['M05', 'M05 — Interest after the demo (English)'],
  ['M05_hi', 'M05 — Interest after the demo (Hindi)'],
  ['M06', 'M06 — Eligibility question 1 (samples a day)'],
  ['M07', 'M07 — Eligibility question 2 (the lab)'],
  ['M08', 'M08 — Eligible / under review, with the booking button'],
  ['M09', 'M09 — Does not meet the criteria'],
  ['M10', 'M10 — Not now'],
  ['M11', 'M11 — Not interested'],
  ['M13', 'M13 — Booking still pending'],
  ['M14', 'M14 — Booking confirmed'],
  ['M15', 'M15 — Reminder, 1 hour before'],
  ['M16', 'M16 — Handed to the team'],
  ['STOP_OK', 'Reply to STOP'],
];

const blank = (kind: WaCampaignKind): WaCampaignInput => ({
  name: '', kind, status: 'draft', dailySendCap: 250, slotCap: 0,
  introLanguage: 'en', introParams: ['{first_name}', '{terms_url}'], nudgeLanguage: 'en', nudgeParams: ['{first_name}'],
  minSamples: 50, minLabAgeYears: 3, copy: {},
});

/** ISO ↔ the local value a datetime-local input wants. */
const toLocal = (iso?: string) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined);

export function WaCampaignBuilder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [form, setForm] = useState<WaCampaignInput>(blank('flow'));
  const [templates, setTemplates] = useState<ApprovedWhatsAppTemplate[]>([]);
  const [templateError, setTemplateError] = useState('');
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState('');

  useEffect(() => {
    void getBroadcastSource().then((s) => setTemplates(s.templates)).catch((e) => setTemplateError(e instanceof Error ? e.message : 'Could not read the approved templates.'));
    void getDefaultCopy().then(setDefaults).catch(() => undefined);
    if (id) {
      void getCampaign(id).then((c) => {
        if (c) {
          const { id: _id, hasCalendlyToken: _t, calendlyConnected: _c, calendlyWebhookUrl: _w, lastError: _e, warnings: _wr, createdAt: _ca, contactCount: _cc, ...rest } = c;
          setForm(rest);
        }
        setLoading(false);
      });
    }
  }, [id]);

  if (loading) return <CardSkeleton />;

  const set = <K extends keyof WaCampaignInput>(key: K, value: WaCampaignInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const flow = form.kind === 'flow';

  const templateField = (label: string, value: string | undefined, onChange: (v: string) => void, hint?: string) =>
    templates.length > 0 ? (
      <Select
        label={label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        options={[{ value: '', label: 'Choose an approved template…' }, ...(value && !templates.some((t) => t.name === value) ? [{ value, label: `${value} (not approved)` }] : []), ...templates.map((t) => ({ value: t.name, label: `${t.name} · ${t.language}` }))]}
      />
    ) : (
      <Input label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value)} hint={hint ?? 'Type the template’s exact name.'} />
    );

  const videoField = (label: string, field: 'introHeaderVideoUrl' | 'demoVideoEn' | 'demoVideoHi', hint: string) => (
    <div className="space-y-2">
      <Input label={label} value={form[field] ?? ''} onChange={(e) => set(field, e.target.value || undefined)} placeholder="https://…" hint={hint} />
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-subtle">
        <Upload size={14} />
        {uploading === field ? 'Uploading…' : 'Upload an MP4 (up to 15 MB)'}
        <input
          type="file"
          accept="video/mp4"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setUploading(field);
            try {
              const [url] = await uploadFiles([file]);
              const link = fileUrl(url) ?? url;
              set(field, /^https?:/i.test(link) ? link : `${window.location.origin}${link}`);
            } catch (err) {
              toast({ title: 'Upload failed', description: err instanceof Error ? err.message : undefined, variant: 'error' });
            } finally {
              setUploading('');
            }
          }}
        />
      </label>
    </div>
  );

  const save = async () => {
    setSaving(true);
    try {
      const saved = id ? await updateCampaign(id, form) : await createCampaign(form);
      toast({ title: 'Saved', variant: 'success' });
      navigate(`/crm/wa-campaigns/${saved.id}`, { replace: !id });
    } catch (err) {
      toast({ title: 'Could not save', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={id ? 'Campaign settings' : 'New campaign'}
        description="What is sent, when, to how many — and what happens when someone answers."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'WhatsApp Campaigns', to: '/crm/wa-campaigns' }, { label: id ? 'Settings' : 'New' }]}
      />
      {templateError && (
        <p className="mb-5 flex items-start gap-2 rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> Could not read your approved templates ({templateError}), so type their names instead.
        </p>
      )}

      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="Basics" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="SmartLab Diwali Initiative 2026" required />
            <Select
              label="Type"
              value={form.kind}
              disabled={!!id}
              onChange={(e) => set('kind', e.target.value as WaCampaignKind)}
              options={[
                { value: 'flow', label: 'Demo journey — video, language, interest, eligibility, booking' },
                { value: 'single', label: 'One template to a list — nothing after it' },
              ]}
            />
            <Input label="Starts (India time)" type="datetime-local" value={toLocal(form.startsAt)} onChange={(e) => set('startsAt', toIso(e.target.value))} hint="Optional. Nothing is sent before this." />
            <Input label="Ends (India time)" type="datetime-local" value={toLocal(form.endsAt)} onChange={(e) => set('endsAt', toIso(e.target.value))} hint="Required to start. Nothing is sent after this, so an offer never outlives its terms." />
            <Input label="Terms & conditions link" value={form.termsUrl ?? ''} onChange={(e) => set('termsUrl', e.target.value || undefined)} placeholder="https://…" hint="Used as {terms_url} in the message." />
            <Input label="Most first messages per day" type="number" min={1} value={String(form.dailySendCap)} onChange={(e) => set('dailySendCap', Math.max(1, Number(e.target.value) || 1))} hint="Meta limits how many people a number may start chats with each day — a new number begins at 250." />
          </div>
        </Card>

        <Card>
          <CardHeader title="First message" subtitle={flow ? 'An approved marketing template with a video header and three buttons: Show Demo, Not Now, Not Interested.' : 'The approved template everyone on the list is sent.'} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {templateField('Template', form.introTemplate, (v) => set('introTemplate', v || undefined))}
            <Input label="Language code" value={form.introLanguage} onChange={(e) => set('introLanguage', e.target.value)} hint="As on the template, e.g. en or hi." />
            <Textarea label="Template variables, in order (one per line)" rows={3} value={form.introParams.join('\n')} onChange={(v) => set('introParams', v.split('\n').map((x) => x.trim()).filter(Boolean))} hint="Tokens: {first_name}, {terms_url}. A person with no name is greeted as “there”." />
            <div>{videoField('Header video', 'introHeaderVideoUrl', 'Public https link. Needed when the template has a video header.')}</div>
          </div>
        </Card>

        {flow && (
          <>
            <Card>
              <CardHeader title="Demo videos" subtitle="What is sent when someone picks a language. Without one, the person goes to your team instead of getting nothing." />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {videoField('English demo', 'demoVideoEn', 'Public https link.')}
                {videoField('Hindi demo', 'demoVideoHi', 'Public https link.')}
              </div>
            </Card>

            <Card>
              <CardHeader title="Follow-ups and reminders" subtitle="Approved templates, used when the 24-hour chat window is closed. Nobody is nudged more than twice." />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {templateField('Follow-up when there is no reply', form.nudgeTemplate, (v) => set('nudgeTemplate', v || undefined))}
                <Input label="Follow-up language" value={form.nudgeLanguage} onChange={(e) => set('nudgeLanguage', e.target.value)} />
                {templateField('Booking confirmation (optional)', form.confirmTemplate, (v) => set('confirmTemplate', v || undefined))}
                {templateField('Reminder, 1 hour before (optional)', form.reminderTemplate, (v) => set('reminderTemplate', v || undefined))}
              </div>
              <p className="mt-2 text-xs text-ink-faint">Confirmation takes {'{date}, {time}, {tz}, {join_url}'}; the reminder takes {'{time}, {join_url}'}. When the person messaged in the last 24 hours these go as ordinary messages instead.</p>
            </Card>

            <Card>
              <CardHeader title="Eligibility and booking" subtitle="The labs’ answers are recorded, but only someone on your team can confirm them." />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Offer slots" type="number" min={0} value={String(form.slotCap)} onChange={(e) => set('slotCap', Math.max(0, Number(e.target.value) || 0))} hint="How many labs may be approved. 0 means no limit. Slots are taken when a lab is verified, never when a message is opened." />
                <Input label="Calendly link" value={form.calendlyUrl ?? ''} onChange={(e) => set('calendlyUrl', e.target.value || undefined)} placeholder="https://calendly.com/…" />
                <Input label="Samples a day needed" type="number" min={1} value={String(form.minSamples)} onChange={(e) => set('minSamples', Math.max(1, Number(e.target.value) || 1))} hint="Shown to the person reviewing; the owner must confirm the exact rule." />
                <Input label="Years running needed" type="number" min={0} value={String(form.minLabAgeYears)} onChange={(e) => set('minLabAgeYears', Math.max(0, Number(e.target.value) || 0))} />
              </div>
            </Card>

            <Card>
              <CardHeader title="Message wording" subtitle="Every message the journey sends. Leave one alone to use the standard wording; {name}, {date}, {time}, {tz} and {join_url} are filled in." />
              <div className="space-y-3">
                {COPY_LABELS.map(([key, label]) => (
                  <details key={key} className="rounded-lg border border-line px-3 py-2">
                    <summary className="cursor-pointer text-sm font-medium text-ink">{label}{form.copy[key] ? ' · edited' : ''}</summary>
                    <div className="pt-2">
                      <Textarea label="" rows={4} value={form.copy[key] ?? defaults[key] ?? ''} onChange={(v) => set('copy', { ...form.copy, [key]: v })} />
                      {form.copy[key] && (
                        <button type="button" className="mt-1 text-xs text-ink-faint underline" onClick={() => { const { [key]: _drop, ...rest } = form.copy; set('copy', rest); }}>
                          Use the standard wording
                        </button>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </Card>
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate(id ? `/crm/wa-campaigns/${id}` : '/crm/wa-campaigns')}>Cancel</Button>
          <Button variant="primary" isLoading={saving} disabled={!form.name.trim()} onClick={save}>{id ? 'Save changes' : 'Create campaign'}</Button>
        </div>
      </div>
    </div>
  );
}
