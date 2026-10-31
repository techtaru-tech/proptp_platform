import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Trash2, Upload } from 'lucide-react';
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
import { createCampaign, getCampaign, getDefaults, updateCampaign } from '../../../services/waCampaignService';
import type { ApprovedWhatsAppTemplate, WaCampaignInput, WaCampaignKind, WaDemoVideo } from '../../../types';

const COPY_LABELS: [string, string][] = [
  ['LANG_Q', 'Language question — English or Hinglish?'],
  ['M02', 'M02 — Note before the English demo videos'],
  ['M02_hi', 'M02 — Note before the Hinglish demo videos'],
  ['M04', 'M04 — Interest after the demo'],
  ['M04_hi', 'M04 — Interest after the demo (Hinglish)'],
  ['M05', 'M05 — Eligibility: samples a day'],
  ['M05_hi', 'M05 — Eligibility: samples a day (Hinglish)'],
  ['M06', 'M06 — Eligibility: specialist led or running 3+ years'],
  ['M06_hi', 'M06 — Eligibility: lab type (Hinglish)'],
  ['M07', 'M07 — Eligibility: B2C'],
  ['M07_hi', 'M07 — Eligibility: B2C (Hinglish)'],
  ['M08', 'M08 — Under review, with the booking button'],
  ['M08_hi', 'M08 — Under review, with the booking button (Hinglish)'],
  ['M09', 'M09 — Not currently eligible'],
  ['M09_hi', 'M09 — Not currently eligible (Hinglish)'],
  ['M10', 'M10 — Not now'],
  ['M10_hi', 'M10 — Not now (Hinglish)'],
  ['M11', 'M11 — Not interested'],
  ['M11_hi', 'M11 — Not interested (Hinglish)'],
  ['M13', 'M13 — Consultation not booked yet'],
  ['M13_hi', 'M13 — Consultation not booked yet (Hinglish)'],
  ['M14', 'M14 — Booking confirmed'],
  ['M14_hi', 'M14 — Booking confirmed (Hinglish)'],
  ['M15', 'M15 — Reminder, 1 hour before'],
  ['M15_hi', 'M15 — Reminder, 1 hour before (Hinglish)'],
  ['M16', 'M16 — Handed to the team'],
  ['M16_hi', 'M16 — Handed to the team (Hinglish)'],
  ['STOP_OK', 'Reply to STOP'],
];

const blank = (kind: WaCampaignKind): WaCampaignInput => ({
  name: '', kind, status: 'draft', dailySendCap: 250, slotCap: 0,
  introLanguage: 'en', introParams: ['{first_name}', '{terms_url}'], nudgeLanguage: 'en', nudgeParams: ['{first_name}'],
  minSamples: 50, minLabAgeYears: 3, copy: {}, demoVideos: [],
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
  const [demoDefaults, setDemoDefaults] = useState<{ language: 'en' | 'hi'; title: string; caption: string }[]>([]);
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState('');

  useEffect(() => {
    void getBroadcastSource().then((s) => setTemplates(s.templates)).catch((e) => setTemplateError(e instanceof Error ? e.message : 'Could not read the approved templates.'));
    void getDefaults().then((d) => {
      setDefaults(d.copy);
      setDemoDefaults(d.demoVideos);
      // A new campaign starts with the three demo slots, ready for their files.
      if (!id) setForm((f) => (f.demoVideos.length ? f : { ...f, demoVideos: d.demoVideos.map((v) => ({ ...v, url: '' })) }));
    }).catch(() => undefined);
    if (id) {
      void getCampaign(id).then((c) => {
        if (c) {
          const { id: _id, hasCalendlyToken: _t, calendlyConnected: _c, calendlyWebhookUrl: _w, lastError: _e, warnings: _wr, createdAt: _ca, contactCount: _cc, ...rest } = c;
          setForm({ ...rest, demoVideos: rest.demoVideos ?? [] });
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

  const upload = async (key: string, file: File | undefined, done: (url: string) => void) => {
    if (!file) return;
    setUploading(key);
    try {
      const [url] = await uploadFiles([file]);
      const link = fileUrl(url) ?? url;
      done(/^https?:/i.test(link) ? link : `${window.location.origin}${link}`);
    } catch (err) {
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setUploading('');
    }
  };

  const uploadButton = (key: string, done: (url: string) => void) => (
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-subtle">
      <Upload size={14} />
      {uploading === key ? 'Uploading…' : 'Upload an MP4 (up to 15 MB)'}
      <input type="file" accept="video/mp4" className="hidden" onChange={(e) => void upload(key, e.target.files?.[0], done)} />
    </label>
  );

  const videoField = (label: string, field: 'introHeaderVideoUrl' | 'demoVideoEn' | 'demoVideoHi', hint: string) => (
    <div className="space-y-2">
      <Input label={label} value={form[field] ?? ''} onChange={(e) => set(field, e.target.value || undefined)} placeholder="https://…" hint={hint} />
      {uploadButton(field, (url) => set(field, url))}
    </div>
  );

  const patchDemo = (i: number, patch: Partial<WaDemoVideo>) => set('demoVideos', form.demoVideos.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  // Older entries were saved without a language; they are English.
  const langOf = (d: WaDemoVideo) => (d.language === 'hi' ? 'hi' : 'en');
  /** Swaps a video with its neighbour in the same language — the order they are sent in. */
  const moveDemo = (i: number, by: -1 | 1) => {
    const list = [...form.demoVideos];
    const same = list.map((_, j) => j).filter((j) => langOf(list[j]) === langOf(list[i]));
    const at = same.indexOf(i);
    const to = same[at + by];
    if (to === undefined) return;
    [list[i], list[to]] = [list[to], list[i]];
    set('demoVideos', list);
  };

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
            <Input label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Techtaru Diwali 50% Initiative 2026" required />
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
          <CardHeader title="First message" subtitle={flow ? 'An approved marketing template with a video header and three buttons: Watch Demo, Check Eligibility, Not Interested. Watch Demo then asks English or Hinglish.' : 'The approved template everyone on the list is sent.'} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {templateField('Template', form.introTemplate, (v) => set('introTemplate', v || undefined))}
            <Input label="Language code" value={form.introLanguage} onChange={(e) => set('introLanguage', e.target.value)} hint="As on the template, e.g. en or hi." />
            <Textarea label="Template variables, in order (one per line)" rows={3} value={form.introParams.join('\n')} onChange={(v) => set('introParams', v.split('\n').map((x) => x.trim()).filter(Boolean))} hint="Tokens: {first_name}, {terms_url}. A person with no name is greeted as “Doctor”." />
            <div>{videoField('Header video', 'introHeaderVideoUrl', 'Public https link. Needed when the template has a video header.')}</div>
          </div>
        </Card>

        {flow && (
          <>
            {(['en', 'hi'] as const).map((lang) => {
              const name = lang === 'hi' ? 'Hinglish' : 'English';
              const rows = form.demoVideos.map((d, i) => ({ d, i })).filter(({ d }) => langOf(d) === lang);
              return (
                <Card key={lang}>
                  <CardHeader
                    title={`${name} demo videos`}
                    subtitle={`Sent one after another when someone taps Watch Demo and picks ${name}, after a short note (M02${lang === 'hi' ? ', Hinglish' : ''}). Each goes with its description.${lang === 'hi' ? ' With none here, Hinglish gets the English videos.' : ''}`}
                    action={
                      <Button variant="outline" size="sm" leftIcon={<Plus size={13} />} disabled={rows.length >= 5} onClick={() => set('demoVideos', [...form.demoVideos, { language: lang, title: '', caption: '', url: '' }])}>
                        Add video
                      </Button>
                    }
                  />
                  {rows.length === 0 ? (
                    <div className="space-y-2 text-sm text-ink-faint">
                      <p>No {name} demo videos yet.</p>
                      {demoDefaults.some((v) => v.language === lang) && (
                        <Button variant="outline" size="sm" onClick={() => set('demoVideos', [...form.demoVideos, ...demoDefaults.filter((v) => v.language === lang).map((v) => ({ ...v, url: '' }))])}>
                          Add the User App, Phlebo App and Backend and CRM slots
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {rows.map(({ d, i }, n) => (
                        <div key={i} className="rounded-lg border border-line p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{name} video {n + 1}</span>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" aria-label="Move up" disabled={n === 0} onClick={() => moveDemo(i, -1)}><ArrowUp size={14} /></Button>
                              <Button variant="ghost" size="icon" aria-label="Move down" disabled={n === rows.length - 1} onClick={() => moveDemo(i, 1)}><ArrowDown size={14} /></Button>
                              <Button variant="ghost" size="icon" aria-label="Remove" className="text-danger-600" onClick={() => set('demoVideos', form.demoVideos.filter((_, j) => j !== i))}><Trash2 size={14} /></Button>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Input label="Name (for you)" value={d.title} onChange={(e) => patchDemo(i, { title: e.target.value })} placeholder="Techtaru User App" />
                            <div className="space-y-2">
                              <Input label="Video" value={d.url} onChange={(e) => patchDemo(i, { url: e.target.value })} placeholder="https://…" hint={d.url ? undefined : 'Not set — this one is skipped until it has a video.'} />
                              {uploadButton(`demo-${i}`, (url) => patchDemo(i, { url }))}
                            </div>
                            <div className="sm:col-span-2">
                              <Textarea label="Description sent with it" rows={3} value={d.caption} onChange={(val) => patchDemo(i, { caption: val })} hint={`${d.caption.length}/1000. {name} becomes the person's first name.`} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}

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
