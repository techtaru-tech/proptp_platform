import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Image as ImageIcon, Plus, Trash2, Upload, Video } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { Select } from '../../components/ui/Select';
import { useToast } from '../../context/ToastContext';
import { uploadFiles } from '../../services/apiClient';
import { submitTemplate } from '../../services/whatsappTemplateService';
import type { WhatsAppHeaderInput, WhatsAppTemplateButton } from '../../types';

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'en_US', label: 'English (US)' },
  { value: 'mr', label: 'Marathi' },
  { value: 'gu', label: 'Gujarati' },
];

type HeaderKind = 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
const HEADER_KINDS: { value: HeaderKind; label: string }[] = [
  { value: 'NONE', label: 'No header' },
  { value: 'TEXT', label: 'Text' },
  { value: 'IMAGE', label: 'Image' },
  { value: 'VIDEO', label: 'Video' },
  { value: 'DOCUMENT', label: 'Document (PDF)' },
];

/** What each file header accepts, per WhatsApp's own limits (the upload endpoint caps files at 15 MB). */
const FILE_RULES: Record<'IMAGE' | 'VIDEO' | 'DOCUMENT', { accept: string; maxMb: number; note: string }> = {
  IMAGE: { accept: 'image/jpeg,image/png', maxMb: 5, note: 'JPG or PNG, up to 5 MB.' },
  VIDEO: { accept: 'video/mp4', maxMb: 15, note: 'MP4, up to 15 MB.' },
  DOCUMENT: { accept: 'application/pdf', maxMb: 15, note: 'PDF, up to 15 MB.' },
};

/** The emoji people paste in as `:name:` from chat apps, turned into the real thing — WhatsApp wants the character. */
const EMOJI_CODES: Record<string, string> = {
  wave: '👋', diya_lamp: '🪔', white_check_mark: '✅', gift: '🎁', cloud: '☁️', globe_with_meridians: '🌐', art: '🎨',
  point_down: '👇', point_right: '👉', tada: '🎉', fire: '🔥', star: '⭐', sparkles: '✨', rocket: '🚀', phone: '📞',
  pray: '🙏', smile: '😊', house: '🏠', moneybag: '💰', calendar: '📅', round_pushpin: '📍', bulb: '💡',
};
const QUICK_EMOJI = ['👋', '🪔', '✅', '🎁', '👇', '🎉', '🔥', '✨', '📞', '📍'];

function withEmoji(text: string): string {
  return text.replace(/:([a-z0-9_+-]+):/g, (whole, name: string) => EMOJI_CODES[name] ?? whole);
}

function newButton(type: WhatsAppTemplateButton['type']): WhatsAppTemplateButton {
  if (type === 'URL') return { type, text: '', url: '' };
  if (type === 'PHONE_NUMBER') return { type, text: '', phone: '' };
  return { type: 'QUICK_REPLY', text: '' };
}

/** Write a template with every option WhatsApp offers and send it for approval. */
export function WhatsAppTemplateCreate() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const bodyRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<'MARKETING' | 'UTILITY'>('MARKETING');
  const [language, setLanguage] = useState('en');
  const [headerKind, setHeaderKind] = useState<HeaderKind>('NONE');
  const [headerText, setHeaderText] = useState('');
  const [sampleUrl, setSampleUrl] = useState('');
  const [samplePreview, setSamplePreview] = useState('');
  const [uploading, setUploading] = useState(false);
  const [body, setBody] = useState('');
  const [footer, setFooter] = useState('');
  const [samples, setSamples] = useState<string[]>([]);
  const [buttons, setButtons] = useState<WhatsAppTemplateButton[]>([]);
  const [saving, setSaving] = useState(false);

  const variableCount = new Set(body.match(/\{\{\s*\d+\s*\}\}/g) ?? []).size;
  const fileKind = headerKind === 'IMAGE' || headerKind === 'VIDEO' || headerKind === 'DOCUMENT' ? headerKind : null;

  // A sample belongs to one kind of header; switching kind drops the old one.
  useEffect(() => {
    setSampleUrl('');
    setSamplePreview('');
  }, [headerKind]);

  const pickFile = async (file: File | undefined) => {
    if (!file || !fileKind) return;
    const rule = FILE_RULES[fileKind];
    if (!rule.accept.split(',').includes(file.type)) return toast({ title: 'Wrong file type', description: rule.note, variant: 'error' });
    if (file.size > rule.maxMb * 1024 * 1024) return toast({ title: 'File is too large', description: rule.note, variant: 'error' });
    setUploading(true);
    try {
      const [url] = await uploadFiles([file]);
      setSampleUrl(url);
      setSamplePreview(URL.createObjectURL(file));
    } catch (err) {
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setUploading(false);
    }
  };

  const patchButton = (index: number, patch: Partial<WhatsAppTemplateButton>) =>
    setButtons((prev) => prev.map((b, i) => (i === index ? ({ ...b, ...patch } as WhatsAppTemplateButton) : b)));

  const urlCount = buttons.filter((b) => b.type === 'URL').length;
  const phoneCount = buttons.filter((b) => b.type === 'PHONE_NUMBER').length;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (fileKind && !sampleUrl) return toast({ title: `Upload an example ${fileKind.toLowerCase()}`, description: 'WhatsApp reviewers need to see what the header looks like.', variant: 'error' });
    const header: WhatsAppHeaderInput =
      headerKind === 'NONE' ? { format: 'NONE' } : headerKind === 'TEXT' ? { format: 'TEXT', text: headerText } : { format: headerKind, sampleUrl };
    setSaving(true);
    try {
      const result = await submitTemplate({
        name, category, language, header, body, footer: footer || undefined, buttons,
        samples: samples.slice(0, variableCount),
      });
      toast({ title: 'Sent to WhatsApp for review', description: `${result.name} is ${result.status.toLowerCase()}. Check its status on the Templates page.`, variant: 'success' });
      navigate('/notifications/whatsapp/templates');
    } catch (err) {
      toast({ title: 'Could not submit', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const previewBody = samples.reduce(
    (text, value, i) => text.replace(new RegExp(`\\{\\{\\s*${i + 1}\\s*\\}\\}`, 'g'), value || `{{${i + 1}}}`),
    body
  );

  return (
    <div>
      <PageHeader
        title="Create WhatsApp template"
        description="Write the message, add media and buttons, and send it to WhatsApp for approval."
        breadcrumb={[{ label: 'Notifications', to: '/notifications' }, { label: 'WhatsApp Templates', to: '/notifications/whatsapp/templates' }, { label: 'Create' }]}
      />

      <form onSubmit={submit} className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Basics" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="diwali_lab_offer"
                hint="Lowercase letters, numbers, underscores."
                required
              />
              <Select
                label="Category"
                value={category}
                onChange={(e) => setCategory(e.target.value as 'MARKETING' | 'UTILITY')}
                options={[
                  { value: 'MARKETING', label: 'Marketing — offers, promotions' },
                  { value: 'UTILITY', label: 'Utility — about something they did' },
                ]}
              />
              <Select label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} options={LANGUAGES} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Header" subtitle="Optional. A file header is chosen again every time you send, so one template can carry a different image or video each time." />
            <div className="space-y-4">
              <Select label="Header type" value={headerKind} onChange={(e) => setHeaderKind(e.target.value as HeaderKind)} options={HEADER_KINDS} />

              {headerKind === 'TEXT' && (
                <Input label="Header text" value={headerText} onChange={(e) => setHeaderText(e.target.value)} maxLength={60} hint={`${headerText.length}/60`} />
              )}

              {fileKind && (
                <div>
                  <p className="mb-1.5 text-sm font-medium text-ink">Example {fileKind.toLowerCase()}</p>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-line-strong px-4 py-4 hover:bg-surface-subtle">
                    <Upload size={18} className="text-ink-faint" />
                    <span className="text-sm text-ink-muted">
                      {uploading ? 'Uploading…' : sampleUrl ? 'Replace the example' : `Choose a ${fileKind.toLowerCase()}`} — {FILE_RULES[fileKind].note}
                    </span>
                    <input type="file" accept={FILE_RULES[fileKind].accept} className="hidden" onChange={(e) => void pickFile(e.target.files?.[0])} />
                  </label>
                  <p className="mt-1.5 text-xs text-ink-faint">
                    Only WhatsApp's reviewers see this example. When you send, you give the actual {fileKind.toLowerCase()} for that message.
                  </p>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Message" subtitle="What the person reads." />
            <div className="space-y-4" ref={bodyRef}>
              <Textarea
                label="Body"
                rows={10}
                value={body}
                onChange={(v) => setBody(withEmoji(v))}
                placeholder={'Hi {{1}}, 👋\n…'}
                hint={`Use {{1}}, {{2}} … where a value changes per person. :wave: style codes turn into emoji. ${body.length}/1024 characters.`}
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-ink-faint">Add:</span>
                {QUICK_EMOJI.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="rounded-md border border-line px-1.5 py-0.5 text-base hover:bg-surface-subtle"
                    onClick={() => setBody((prev) => prev + emoji)}
                  >
                    {emoji}
                  </button>
                ))}
                <button
                  type="button"
                  className="rounded-md border border-line px-2 py-0.5 text-xs text-ink-muted hover:bg-surface-subtle"
                  onClick={() => setBody((prev) => `${prev}{{${variableCount + 1}}}`)}
                >
                  + Variable
                </button>
              </div>

              {variableCount > 0 && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {Array.from({ length: variableCount }).map((_, i) => (
                    <Input
                      key={i}
                      label={`Example for {{${i + 1}}}`}
                      value={samples[i] ?? ''}
                      onChange={(e) => setSamples((prev) => Array.from({ length: variableCount }, (_, j) => (j === i ? e.target.value : prev[j] ?? '')))}
                      hint={i === 0 ? 'WhatsApp reviewers need a sample of what goes in each variable.' : undefined}
                      required
                    />
                  ))}
                </div>
              )}

              <Input label="Footer (optional)" value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={60} hint={`${footer.length}/60`} />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Buttons"
              subtitle="Optional. Up to 10 in all — at most 2 links and 1 call button."
              action={
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" leftIcon={<Plus size={13} />} disabled={buttons.length >= 10} onClick={() => setButtons((p) => [...p, newButton('QUICK_REPLY')])}>
                    Quick reply
                  </Button>
                  <Button type="button" variant="outline" size="sm" leftIcon={<Plus size={13} />} disabled={buttons.length >= 10 || urlCount >= 2} onClick={() => setButtons((p) => [...p, newButton('URL')])}>
                    Link
                  </Button>
                  <Button type="button" variant="outline" size="sm" leftIcon={<Plus size={13} />} disabled={buttons.length >= 10 || phoneCount >= 1} onClick={() => setButtons((p) => [...p, newButton('PHONE_NUMBER')])}>
                    Call
                  </Button>
                </div>
              }
            />
            {buttons.length === 0 ? (
              <p className="text-sm text-ink-faint">No buttons. A quick reply lets people answer with one tap; a link or call button sends them out of WhatsApp.</p>
            ) : (
              <div className="space-y-3">
                {buttons.map((b, i) => (
                  <div key={i} className="rounded-lg border border-line p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                        {b.type === 'QUICK_REPLY' ? 'Quick reply' : b.type === 'URL' ? 'Link' : 'Call'}
                      </span>
                      <Button type="button" variant="ghost" size="sm" className="text-danger-600" leftIcon={<Trash2 size={13} />} onClick={() => setButtons((p) => p.filter((_, j) => j !== i))}>
                        Remove
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Input label="Label" value={b.text} onChange={(e) => patchButton(i, { text: e.target.value })} maxLength={25} hint={`${b.text.length}/25`} required />
                      {b.type === 'URL' && (
                        <Input
                          label="Link"
                          value={b.url}
                          onChange={(e) => patchButton(i, { url: e.target.value })}
                          placeholder="https://proptocrm.com/demo"
                          hint="Add {{1}} at the very end to make part of the link change per person."
                          required
                        />
                      )}
                      {b.type === 'URL' && /\{\{1\}\}$/.test(b.url) && (
                        <Input label="Example full link" value={b.example ?? ''} onChange={(e) => patchButton(i, { example: e.target.value })} placeholder="https://proptocrm.com/demo/jaipur" required />
                      )}
                      {b.type === 'PHONE_NUMBER' && (
                        <Input label="Phone number" value={b.phone} onChange={(e) => patchButton(i, { phone: e.target.value })} placeholder="+919829822983" hint="With country code." required />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => navigate('/notifications/whatsapp/templates')}>Cancel</Button>
            <Button type="submit" variant="primary" isLoading={saving || uploading} disabled={!name.trim() || !body.trim()}>
              Submit for approval
            </Button>
          </div>
        </div>

        <div className="xl:sticky xl:top-20 xl:self-start">
          <Card>
            <CardHeader title="Preview" subtitle="Roughly how it looks on the phone" />
            <div className="rounded-xl bg-[#e7ddd3] p-3">
              <div className="max-w-full overflow-hidden rounded-lg bg-surface shadow-sm">
                {fileKind && (
                  <div className="flex h-36 items-center justify-center bg-surface-subtle text-ink-faint">
                    {samplePreview && fileKind === 'IMAGE' ? (
                      <img src={samplePreview} alt="" className="h-full w-full object-cover" />
                    ) : samplePreview && fileKind === 'VIDEO' ? (
                      <video src={samplePreview} className="h-full w-full object-cover" muted />
                    ) : fileKind === 'IMAGE' ? (
                      <ImageIcon size={28} />
                    ) : fileKind === 'VIDEO' ? (
                      <Video size={28} />
                    ) : (
                      <FileText size={28} />
                    )}
                  </div>
                )}
                <div className="space-y-1.5 p-3">
                  {headerKind === 'TEXT' && headerText && <p className="text-sm font-semibold text-ink">{headerText}</p>}
                  <p className="whitespace-pre-wrap text-[13px] leading-snug text-ink">{previewBody || 'Your message appears here.'}</p>
                  {footer && <p className="text-xs text-ink-faint">{footer}</p>}
                </div>
                {buttons.filter((b) => b.text).map((b, i) => (
                  <div key={i} className="border-t border-line py-2 text-center text-sm font-medium text-info-600">
                    {b.text}
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-3 text-xs text-ink-faint">
              Marketing templates are usually reviewed within minutes but can take up to a day. Avoid all-caps, repeated emoji and
              a variable at the very start or end of the message — they are the common reasons for rejection.
            </p>
          </Card>
        </div>
      </form>
    </div>
  );
}
