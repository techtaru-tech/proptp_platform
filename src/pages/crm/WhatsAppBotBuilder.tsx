import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, CornerDownRight, ExternalLink, Plus, Trash2, Upload } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { Select } from '../../components/ui/Select';
import { Toggle } from '../../components/ui/Toggle';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useToast } from '../../context/ToastContext';
import { fileUrl, uploadFiles } from '../../services/apiClient';
import { createBot, getBot, updateBot } from '../../services/whatsappBotService';
import { DRIP_STATUS_OPTIONS } from '../../services/whatsappDripService';
import type { WhatsAppBotButton, WhatsAppBotInput, WhatsAppBotNode } from '../../types';

const MAX_TITLE = 20;
const NEW_MESSAGE = '__new__';

type OptionMode = 'none' | 'reply' | 'url';

const modeOf = (node: WhatsAppBotNode): OptionMode => (node.buttons.some((b) => b.type === 'url') ? 'url' : node.buttons.length > 0 ? 'reply' : 'none');

const nextKey = (nodes: WhatsAppBotNode[]) => `m${Math.max(0, ...nodes.map((n) => Number(n.key.replace(/\D/g, '')) || 0)) + 1}`;

function blankNode(key: string, label = ''): WhatsAppBotNode {
  return { key, label, body: '', buttons: [], handoff: false };
}

/** Designs the flow: each message, the options under it, and where each option leads. */
export function WhatsAppBotBuilder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [form, setForm] = useState<WhatsAppBotInput>({
    name: '', status: 'draft', triggerType: 'any', keywords: [], cooldownHours: 12, startKey: 'm1',
    nodes: [{ ...blankNode('m1', 'Welcome'), body: 'Hi {name}, thank you for contacting us! How can we help you today?' }],
  });
  const [keywordText, setKeywordText] = useState('');
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void getBot(id).then((bot) => {
      if (bot) {
        setForm({ name: bot.name, status: bot.status, triggerType: bot.triggerType, keywords: bot.keywords, cooldownHours: bot.cooldownHours, startKey: bot.startKey, nodes: bot.nodes ?? [] });
        setKeywordText(bot.keywords.join(', '));
      }
      setLoading(false);
    });
  }, [id]);

  if (loading) return <CardSkeleton />;

  const nodes = form.nodes;
  const patchNode = (key: string, patch: Partial<WhatsAppBotNode>) =>
    setForm((f) => ({ ...f, nodes: f.nodes.map((n) => (n.key === key ? { ...n, ...patch } : n)) }));
  const label = (n: WhatsAppBotNode, i: number) => n.label.trim() || `Message ${i + 1}`;

  const setMode = (node: WhatsAppBotNode, mode: OptionMode) =>
    patchNode(node.key, {
      buttons: mode === 'none' ? [] : mode === 'url' ? [{ title: '', type: 'url', url: '' }] : [{ title: '', type: 'reply' }],
      ...(mode === 'none' ? { headerImageUrl: undefined } : {}),
    });

  const patchButton = (node: WhatsAppBotNode, index: number, patch: Partial<WhatsAppBotButton>) =>
    patchNode(node.key, { buttons: node.buttons.map((b, i) => (i === index ? { ...b, ...patch } : b)) });

  /** "＋ New message" creates the target on the spot, so a flow can be built without leaving the option. */
  const pointTo = (node: WhatsAppBotNode, index: number, target: string) => {
    if (target !== NEW_MESSAGE) return patchButton(node, index, { nextKey: target || undefined });
    const key = nextKey(nodes);
    const button = node.buttons[index];
    setForm((f) => ({
      ...f,
      nodes: [
        ...f.nodes.map((n) => (n.key === node.key ? { ...n, buttons: n.buttons.map((b, i) => (i === index ? { ...b, nextKey: key } : b)) } : n)),
        blankNode(key, button?.title || ''),
      ],
    }));
  };

  const removeNode = (key: string) =>
    setForm((f) => ({
      ...f,
      nodes: f.nodes.filter((n) => n.key !== key).map((n) => ({ ...n, buttons: n.buttons.map((b) => (b.nextKey === key ? { ...b, nextKey: undefined } : b)) })),
    }));

  const move = (index: number, by: -1 | 1) =>
    setForm((f) => {
      const list = [...f.nodes];
      const to = index + by;
      if (to < 0 || to >= list.length) return f;
      [list[index], list[to]] = [list[to], list[index]];
      // The first message is the one sent first.
      return { ...f, nodes: list, startKey: list[0].key };
    });

  const uploadImage = async (node: WhatsAppBotNode, file: File | undefined) => {
    if (!file) return;
    setUploading(node.key);
    try {
      const [url] = await uploadFiles([file]);
      const link = fileUrl(url) ?? url;
      patchNode(node.key, { headerImageUrl: /^https?:/i.test(link) ? link : `${window.location.origin}${link}` });
    } catch (err) {
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    if (!form.name.trim()) return toast({ title: 'Give the auto-reply a name', variant: 'error' });
    const keywords = keywordText.split(/[,\n]/).map((k) => k.trim()).filter(Boolean);
    if (form.triggerType === 'keywords' && keywords.length === 0) return toast({ title: 'Add at least one keyword', variant: 'error' });
    setSaving(true);
    try {
      const payload = { ...form, keywords, startKey: nodes[0].key };
      const result = id ? await updateBot(id, payload) : await createBot(payload);
      toast({ title: id ? 'Auto-reply saved' : 'Auto-reply created', description: form.status === 'active' ? 'It is live.' : 'Set it to Active when you are ready.', variant: 'success' });
      if (!id) navigate(`/crm/whatsapp-bots/${result.id}`, { replace: true });
    } catch (err) {
      toast({ title: 'Could not save', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // The flow as a tree from the first message, so it reads as "tap this → that happens".
  const renderTree = (key: string, depth: number, seen: string[]): React.ReactNode => {
    const node = nodes.find((n) => n.key === key);
    if (!node) return null;
    const index = nodes.indexOf(node);
    const loop = seen.includes(key);
    return (
      <div key={`${key}-${depth}`} style={{ marginLeft: depth ? 16 : 0 }} className={depth ? 'border-l border-line pl-3' : ''}>
        <p className="flex items-start gap-1.5 text-sm">
          {depth > 0 && <CornerDownRight size={13} className="mt-1 shrink-0 text-ink-faint" />}
          <span>
            <span className="font-medium text-ink">{label(node, index)}</span>
            {loop && <span className="ml-1.5 text-xs text-ink-faint">(goes back to this message)</span>}
            {!loop && <span className="block text-xs text-ink-faint">{node.body.slice(0, 60) || 'No text yet'}{node.body.length > 60 ? '…' : ''}</span>}
          </span>
        </p>
        {!loop && node.buttons.map((b, i) => (
          <div key={i} className="mt-1.5">
            {b.type === 'url' ? (
              <p className="ml-4 flex items-center gap-1.5 text-xs text-info-600"><ExternalLink size={12} /> [{b.title || 'Link'}] opens {b.url || 'a link'}</p>
            ) : (
              <>
                <p className="ml-4 text-xs text-ink-muted">Tap <strong>[{b.title || 'option'}]</strong>{b.nextKey ? '' : ' → nothing happens yet'}</p>
                {b.nextKey && renderTree(b.nextKey, depth + 1, [...seen, key])}
              </>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title={id ? 'Edit auto-reply' : 'New auto-reply'}
        description="Write the welcome message, add options under it, and decide what each option does."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'WhatsApp Auto-Reply', to: '/crm/whatsapp-bots' }, { label: id ? 'Edit' : 'New' }]}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="When to answer" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Welcome & booking" required />
              <Select label="Status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as WhatsAppBotInput['status'] }))} options={DRIP_STATUS_OPTIONS} />
              <Select
                label="Answers"
                value={form.triggerType}
                onChange={(e) => setForm((f) => ({ ...f, triggerType: e.target.value as 'any' | 'keywords' }))}
                options={[
                  { value: 'any', label: 'Every first message' },
                  { value: 'keywords', label: 'Only messages containing a keyword' },
                ]}
              />
              <Input label="Quiet for (hours)" type="number" min={0} value={String(form.cooldownHours)} onChange={(e) => setForm((f) => ({ ...f, cooldownHours: Math.max(0, Number(e.target.value) || 0) }))} hint="After answering, stay silent on that chat for this long, so a reply like “Ok” does not restart the welcome." />
              {form.triggerType === 'keywords' && (
                <Input label="Keywords" value={keywordText} onChange={(e) => setKeywordText(e.target.value)} placeholder="price, book, demo" hint="Separate with commas. Whole words or phrases — “app” does not match “WhatsApp”." wrapperClassName="sm:col-span-2" />
              )}
            </div>
          </Card>

          {nodes.map((node, index) => {
            const mode = modeOf(node);
            return (
              <Card key={node.key}>
                <CardHeader
                  title={index === 0 ? `${label(node, index)} — sent first` : label(node, index)}
                  subtitle={index === 0 ? 'The first thing a person receives.' : 'Sent when someone taps an option that leads here.'}
                  action={
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /></Button>
                      <Button variant="ghost" size="icon" aria-label="Move down" disabled={index === nodes.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></Button>
                      <Button variant="ghost" size="icon" aria-label="Remove message" className="text-danger-600" disabled={nodes.length === 1} onClick={() => removeNode(node.key)}><Trash2 size={14} /></Button>
                    </div>
                  }
                />
                <div className="space-y-4">
                  <Input label="Name (only you see this)" value={node.label} onChange={(e) => patchNode(node.key, { label: e.target.value })} placeholder={index === 0 ? 'Welcome' : 'Download the app'} />
                  <Textarea label="Message" rows={4} value={node.body} onChange={(v) => patchNode(node.key, { body: v })} hint={`{name} becomes the person's first name. ${node.body.length}/1024`} />

                  <Select
                    label="Under the message"
                    value={mode}
                    onChange={(e) => setMode(node, e.target.value as OptionMode)}
                    options={[
                      { value: 'none', label: 'Nothing — just the text' },
                      { value: 'reply', label: 'Options to tap (up to 3 as buttons, up to 10 as a list)' },
                      { value: 'url', label: 'One link button (opens a page or app store)' },
                    ]}
                  />

                  {mode === 'reply' && (
                    <div className="space-y-2">
                      {node.buttons.map((b, i) => (
                        <div key={i} className="grid grid-cols-1 items-end gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_1fr_auto]">
                          <Input label={`Option ${i + 1}`} value={b.title} maxLength={MAX_TITLE} onChange={(e) => patchButton(node, i, { title: e.target.value })} placeholder="Book a Test" hint={`${b.title.length}/${MAX_TITLE}`} />
                          <Select
                            label="Then send"
                            value={b.nextKey ?? ''}
                            onChange={(e) => pointTo(node, i, e.target.value)}
                            options={[
                              { value: '', label: '— nothing —' },
                              ...nodes.filter((n) => n.key !== node.key).map((n) => ({ value: n.key, label: label(n, nodes.indexOf(n)) })),
                              { value: NEW_MESSAGE, label: '＋ A new message' },
                            ]}
                          />
                          <Button variant="ghost" size="icon" aria-label="Remove option" className="text-danger-600" onClick={() => patchNode(node.key, { buttons: node.buttons.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
                        </div>
                      ))}
                      <Button variant="outline" size="sm" leftIcon={<Plus size={13} />} disabled={node.buttons.length >= 10} onClick={() => patchNode(node.key, { buttons: [...node.buttons, { title: '', type: 'reply' }] })}>
                        Add option
                      </Button>
                    </div>
                  )}

                  {mode === 'url' && node.buttons[0] && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Input label="Button label" value={node.buttons[0].title} maxLength={MAX_TITLE} onChange={(e) => patchButton(node, 0, { title: e.target.value })} placeholder="Download App" hint={`${node.buttons[0].title.length}/${MAX_TITLE}`} />
                      <Input label="Opens" value={node.buttons[0].url ?? ''} onChange={(e) => patchButton(node, 0, { url: e.target.value })} placeholder="https://play.google.com/store/apps/details?id=…" />
                    </div>
                  )}

                  {mode !== 'none' && (
                    <div className="space-y-2">
                      <Input label="Image above the message (optional)" value={node.headerImageUrl ?? ''} onChange={(e) => patchNode(node.key, { headerImageUrl: e.target.value })} placeholder="https://…  or upload" hint="Public https link to a JPG or PNG." />
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-subtle">
                        <Upload size={14} />
                        {uploading === node.key ? 'Uploading…' : 'Upload image'}
                        <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => void uploadImage(node, e.target.files?.[0])} />
                      </label>
                    </div>
                  )}

                  <Toggle label="Tell the team this person needs help" description="Adds a note on their lead when they reach this message, so someone follows up." checked={node.handoff} onChange={(v) => patchNode(node.key, { handoff: v })} />
                </div>
              </Card>
            );
          })}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" leftIcon={<Plus size={14} />} onClick={() => setForm((f) => ({ ...f, nodes: [...f.nodes, blankNode(nextKey(f.nodes))] }))}>
              Add message
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate('/crm/whatsapp-bots')}>Back</Button>
              <Button variant="primary" isLoading={saving} onClick={save}>{id ? 'Save auto-reply' : 'Create auto-reply'}</Button>
            </div>
          </div>
        </div>

        <div className="xl:sticky xl:top-20 xl:self-start">
          <Card>
            <CardHeader title="The flow" subtitle="What happens, step by step" />
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Someone messages you</p>
              {nodes[0] && renderTree(nodes[0].key, 0, [])}
            </div>
            <p className="mt-4 text-xs text-ink-faint">
              WhatsApp allows either reply options or one link button in a message — not both. To offer both, put the link in its own message and point an option at it.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
