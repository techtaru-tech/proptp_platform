import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, BookOpen, Bot, Lock, Mic, Pencil, Plus, RefreshCw, Send, Trash2, UserRound } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { Select } from '../../components/ui/Select';
import { Toggle } from '../../components/ui/Toggle';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { SearchInput } from '../../components/ui/SearchInput';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useToast } from '../../context/ToastContext';
import {
  addKnowledge, deleteKnowledge, getAiSettings, listAiReplies, listKnowledge, saveAiSettings, tryAssistant, updateKnowledge,
} from '../../services/whatsappAiService';
import { formatDate, formatDateTime } from '../../utils/format';
import { cn } from '../../utils/cn';
import type {
  WhatsAppAiReplyRow, WhatsAppAiSettings, WhatsAppAiTestResult, WhatsAppKnowledgeEntry,
} from '../../types';

/** Switch the AI assistant on, teach it, try it, and see what it has been answering. */
export function WhatsAppAi() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<WhatsAppAiSettings | null>(null);
  const [knowledge, setKnowledge] = useState<WhatsAppKnowledgeEntry[]>([]);
  const [replies, setReplies] = useState<WhatsAppAiReplyRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [s, k, r] = await Promise.all([getAiSettings(), listKnowledge(), listAiReplies().catch(() => [])]);
    setSettings(s);
    setKnowledge(k);
    setReplies(r);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load().catch((err) => {
      toast({ title: 'Could not load', description: err instanceof Error ? err.message : undefined, variant: 'error' });
      setLoading(false);
    });
  }, [load, toast]);

  if (loading || !settings) return <CardSkeleton />;

  return (
    <div>
      <PageHeader
        title="WhatsApp AI Assistant"
        description="Answers any message — typed or a voice note — using your knowledge base and the customer's own record. Keyword auto-replies still go first."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'WhatsApp AI' }]}
      />
      {/* Settings and what it knows on the left; trying it and what it said on the right. */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_28rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <SettingsCard settings={settings} onSaved={setSettings} knowledgeInUse={knowledge.filter((k) => k.active).length} />
          <KnowledgeCard entries={knowledge} onChanged={load} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <TryItCard />
          <RepliesCard replies={replies} onRefresh={load} />
        </div>
      </div>
    </div>
  );
}

/** One block of the settings card: what it is on the left, its fields on the right. */
function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-3 border-t border-line px-4 py-4 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-6">
      <div>
        <h4 className="text-xs font-semibold text-ink">{title}</h4>
        {description && <p className="mt-0.5 text-xs text-ink-subtle">{description}</p>}
      </div>
      <div className="min-w-0 space-y-3">{children}</div>
    </section>
  );
}

function SettingsCard({
  settings, onSaved, knowledgeInUse,
}: { settings: WhatsAppAiSettings; onSaved: (s: WhatsAppAiSettings) => void; knowledgeInUse: number }) {
  const { toast } = useToast();
  const [instructions, setInstructions] = useState(settings.instructions);
  const [model, setModel] = useState(settings.model);
  const [maxPerHour, setMaxPerHour] = useState(String(settings.maxRepliesPerHour));
  const [provider, setProvider] = useState(settings.transcriptionProvider);
  const [anthropicKey, setAnthropicKey] = useState('');
  const [transcriptionKey, setTranscriptionKey] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (patch: Parameters<typeof saveAiSettings>[0], message = 'Saved') => {
    setSaving(true);
    try {
      onSaved(await saveAiSettings(patch));
      setAnthropicKey('');
      setTranscriptionKey('');
      toast({ title: message, variant: 'success' });
    } catch (err) {
      toast({ title: 'Could not save', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const canEnable = settings.hasAnthropicKey;
  const savedModel = settings.models.find((m) => m.value === settings.model)?.label.split(' — ')[0] ?? settings.model;

  return (
    <Card padded={false} className="overflow-hidden">
      {/* Status first: whether it is answering customers right now. */}
      <div className="px-4 py-3.5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                settings.enabled ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-line bg-surface-subtle text-ink-faint'
              )}
              aria-hidden="true"
            >
              <Bot size={16} />
            </span>
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                {settings.enabled ? 'The AI assistant is answering' : 'The AI assistant is off'}
                <Badge tone={settings.enabled ? 'success' : 'neutral'} dot>
                  {settings.enabled ? 'On' : 'Off'}
                </Badge>
              </h3>
              <p className="mt-0.5 text-xs text-ink-subtle">
                {settings.enabled
                  ? 'Anything a keyword auto-reply does not cover — questions, long messages and voice notes — is answered by the AI and sent straight away.'
                  : 'Nothing is answered by the AI until you switch it on.'}
              </p>
            </div>
          </div>
          <Toggle
            label="Answer messages with the AI assistant"
            showLabel={false}
            checked={settings.enabled}
            disabled={!canEnable && !settings.enabled}
            onChange={(enabled) => save({ enabled }, enabled ? 'AI assistant is on' : 'AI assistant is off')}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 pl-11">
          <Badge tone={settings.hasAnthropicKey ? 'success' : 'warning'} dot>
            {settings.hasAnthropicKey ? 'API key stored' : 'No API key'}
          </Badge>
          <Badge tone="neutral">{savedModel}</Badge>
          <Badge tone="neutral">Up to {settings.maxRepliesPerHour} replies / chat / hour</Badge>
          <Badge tone={settings.voiceEnabled ? 'info' : 'neutral'}>{settings.voiceEnabled ? 'Voice notes on' : 'Voice notes off'}</Badge>
          <Badge tone={knowledgeInUse > 0 ? 'neutral' : 'warning'}>
            {knowledgeInUse} knowledge {knowledgeInUse === 1 ? 'entry' : 'entries'} in use
          </Badge>
        </div>

        {!settings.hasAnthropicKey && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning-100 bg-warning-50 px-3 py-2 text-xs text-warning-700">
            <AlertTriangle size={14} className="mt-px shrink-0" />
            Add your Anthropic API key below first — the assistant cannot answer without it.
          </p>
        )}
      </div>

      <Section title="Connection" description="The key the assistant answers with, and the model it uses.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Anthropic API key"
            type="password"
            secret
            value={anthropicKey}
            onChange={(e) => setAnthropicKey(e.target.value)}
            placeholder={settings.hasAnthropicKey ? '•••••••• stored — type to replace' : 'sk-ant-…'}
            hint="Stored encrypted. Never shown again."
          />
          <Select label="Model" value={model} onChange={(e) => setModel(e.target.value)} options={settings.models} />
        </div>
      </Section>

      <Section title="Limits" description="A cap on cost and on anyone trying to run it up.">
        <Input
          label="Most AI replies per chat per hour"
          type="number"
          min={1}
          value={maxPerHour}
          onChange={(e) => setMaxPerHour(e.target.value)}
          wrapperClassName="sm:max-w-[14rem]"
        />
      </Section>

      <Section title="Business and tone" description="Who you are and the tone to use.">
        <Textarea
          label="About your business and how to talk"
          rows={7}
          value={instructions}
          onChange={setInstructions}
          hint="Facts such as services and prices belong in the knowledge base below."
        />
      </Section>

      <Section title="Voice notes" description="Optional. Uses its own speech-to-text key.">
        <Toggle
          label="Understand voice notes"
          description="A voice note is turned into text by a speech-to-text service, then answered like any message. Needs its own key."
          checked={settings.voiceEnabled}
          onChange={(voiceEnabled) => save({ voiceEnabled }, voiceEnabled ? 'Voice notes on' : 'Voice notes off')}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Speech-to-text service"
            value={provider}
            onChange={(e) => setProvider(e.target.value as 'groq' | 'openai')}
            options={[
              { value: 'groq', label: 'Groq (Whisper) — very cheap, has a free tier' },
              { value: 'openai', label: 'OpenAI (Whisper) — about ₹0.5 per minute' },
            ]}
          />
          <Input
            label="Speech-to-text key"
            type="password"
            secret
            value={transcriptionKey}
            onChange={(e) => setTranscriptionKey(e.target.value)}
            placeholder={settings.hasTranscriptionKey ? '•••••••• stored — type to replace' : provider === 'groq' ? 'gsk_…' : 'sk-…'}
            hint={provider === 'groq' ? 'Get one at console.groq.com.' : 'Get one at platform.openai.com.'}
          />
        </div>
      </Section>

      <div className="flex flex-col gap-2 border-t border-line bg-surface-subtle px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-1.5 text-2xs text-ink-subtle">
          <Lock size={11} className="shrink-0" />
          Keys are stored encrypted and never shown again. Leave a key field blank to keep the stored one.
        </p>
        <Button
          variant="primary"
          isLoading={saving}
          className="shrink-0"
          onClick={() =>
            save({
              instructions, model, maxRepliesPerHour: Number(maxPerHour) || 20, transcriptionProvider: provider,
              ...(anthropicKey.trim() ? { anthropicKey: anthropicKey.trim() } : {}),
              ...(transcriptionKey.trim() ? { transcriptionKey: transcriptionKey.trim() } : {}),
            })
          }
        >
          Save settings
        </Button>
      </div>
    </Card>
  );
}

function TryItCard() {
  const { toast } = useToast();
  const [message, setMessage] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WhatsAppAiTestResult | null>(null);

  const run = async () => {
    if (!message.trim()) return;
    setBusy(true);
    try {
      setResult(await tryAssistant(message.trim(), phone.trim() || undefined));
    } catch (err) {
      setResult(null);
      toast({ title: 'Could not get an answer', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Try it" subtitle="See how the assistant would answer a message. Nothing is sent to anyone." />
      <div className="space-y-3">
        <Textarea label="Customer message" rows={3} value={message} onChange={setMessage} placeholder="Mere clinic ke liye app banwana hai, patients appointment khud book kar sakein. Kitna lagega?" />
        <Input label="Pretend it is from this number (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="9876543210" hint="If a lead has this number, the assistant also sees that lead's record." />
        <Button variant="primary" className="w-full" leftIcon={<Send size={14} />} isLoading={busy} disabled={!message.trim()} onClick={run}>
          Get the answer
        </Button>

        {result && (
          <div className="overflow-hidden rounded-lg border border-line">
            <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-subtle px-3 py-1.5">
              <span className="text-2xs font-semibold uppercase tracking-wider text-ink-subtle">Would reply</span>
              <span className="text-2xs tabular-nums text-ink-faint">
                {result.usage.input} in · {result.usage.output} out · {result.usage.cacheRead} cached
              </span>
            </div>
            <div className="space-y-2 px-3 py-2.5">
              <p className="whitespace-pre-wrap text-[13px] text-ink">{result.reply || '(No reply — it would only alert the team.)'}</p>
              {result.handoff && (
                <p className="flex items-center gap-1.5 text-xs text-warning-700">
                  <UserRound size={13} /> Would alert the team: {result.handoffReason ?? 'needs a person'}
                </p>
              )}
              <details className="text-xs text-ink-subtle">
                <summary className="cursor-pointer select-none hover:text-ink">The record it was shown</summary>
                <pre className="mt-1.5 max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-surface-subtle p-2 font-mono text-2xs text-ink-muted">{result.record}</pre>
              </details>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function KnowledgeCard({ entries, onChanged }: { entries: WhatsAppKnowledgeEntry[]; onChanged: () => Promise<void> }) {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ id?: string; title: string; content: string; active: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<WhatsAppKnowledgeEntry | null>(null);

  const term = search.trim().toLowerCase();
  const shown = entries.filter((e) => !term || e.title.toLowerCase().includes(term) || e.content.toLowerCase().includes(term));
  const hidden = entries.filter((e) => !e.active).length;

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const body = { title: editing.title, content: editing.content, active: editing.active };
      if (editing.id) await updateKnowledge(editing.id, body);
      else await addKnowledge(body);
      setEditing(null);
      toast({ title: 'Saved', variant: 'success' });
      await onChanged();
    } catch (err) {
      toast({ title: 'Could not save', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card padded={false}>
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            Knowledge base
            <span className="rounded-sm bg-surface-muted px-1.5 text-2xs font-semibold tabular-nums text-ink-muted">{entries.length}</span>
            {hidden > 0 && <span className="text-2xs font-normal text-ink-faint">{hidden} hidden from AI</span>}
          </h3>
          <p className="mt-0.5 text-xs text-ink-subtle">
            Everything the assistant is allowed to state as fact: services, offers, policies, answers to common questions. If it is not here, the assistant hands over to a person instead of guessing.
          </p>
        </div>
        <Button variant="primary" size="sm" className="shrink-0" leftIcon={<Plus size={13} />} onClick={() => setEditing({ title: '', content: '', active: true })}>
          Add entry
        </Button>
      </div>
      {entries.length > 0 && (
        <div className="px-4 pt-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search the knowledge base…" className="sm:max-w-xs" />
        </div>
      )}
      {shown.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <BookOpen size={16} className="mx-auto text-ink-faint" aria-hidden="true" />
          <p className="mt-2 text-xs text-ink-subtle">
            {entries.length === 0 ? 'Nothing here yet. Add what a customer might ask about.' : 'No entries match.'}
          </p>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {shown.map((e) => (
            <li key={e.id} className="group px-4 py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink">
                    {e.title}
                    {!e.active && <Badge tone="neutral">Hidden from AI</Badge>}
                  </p>
                  <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-ink-muted">{e.content}</p>
                  <p className="mt-1 text-2xs tabular-nums text-ink-faint">Updated {formatDate(e.updatedAt)}</p>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <Button variant="ghost" size="sm" leftIcon={<Pencil size={13} />} onClick={() => setEditing({ id: e.id, title: e.title, content: e.content, active: e.active })}>Edit</Button>
                  <Button variant="ghost" size="sm" className="text-danger-600 hover:text-danger-700" leftIcon={<Trash2 size={13} />} onClick={() => setToDelete(e)}>Delete</Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal isOpen={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit entry' : 'Add entry'} size="lg">
        {editing && (
          <div className="space-y-4">
            <Input label="Title" value={editing.title} onChange={(ev) => setEditing({ ...editing, title: ev.target.value })} placeholder="Mobile app development" />
            <Textarea label="What the assistant may say" rows={9} value={editing.content} onChange={(content) => setEditing({ ...editing, content })} hint={`${editing.content.length}/8000 characters. Write it as plain facts.`} />
            <Toggle label="Use this entry" description="Off keeps it saved but hides it from the assistant." checked={editing.active} onChange={(active) => setEditing({ ...editing, active })} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" isLoading={saving} disabled={!editing.title.trim() || !editing.content.trim()} onClick={save}>Save</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmationDialog
        isOpen={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          await deleteKnowledge(toDelete.id);
          setToDelete(null);
          await onChanged();
        }}
        title={`Delete "${toDelete?.title}"?`}
        description="The assistant will no longer know this."
        confirmLabel="Delete"
        variant="danger"
      />
    </Card>
  );
}

function RepliesCard({ replies, onRefresh }: { replies: WhatsAppAiReplyRow[]; onRefresh: () => Promise<void> }) {
  const [refreshing, setRefreshing] = useState(false);
  return (
    <Card padded={false}>
      <div className="flex items-start justify-between gap-3 px-4 py-3.5">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            Recent AI answers
            {replies.length > 0 && (
              <span className="rounded-sm bg-surface-muted px-1.5 text-2xs font-semibold tabular-nums text-ink-muted">{replies.length}</span>
            )}
          </h3>
          <p className="mt-0.5 text-xs text-ink-subtle">What it was asked, what it said, and what each answer cost. The full thread is in CRM → Conversations.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          leftIcon={<RefreshCw size={12} />}
          isLoading={refreshing}
          onClick={async () => {
            setRefreshing(true);
            try {
              await onRefresh();
            } finally {
              setRefreshing(false);
            }
          }}
        >
          Refresh
        </Button>
      </div>
      {replies.length === 0 ? (
        <div className="border-t border-line px-4 py-8 text-center">
          <Bot size={16} className="mx-auto text-ink-faint" aria-hidden="true" />
          <p className="mt-2 text-xs text-ink-subtle">Nothing has been answered by the AI yet.</p>
        </div>
      ) : (
        <ul className="max-h-[40rem] divide-y divide-line overflow-y-auto border-t border-line">
          {replies.map((r) => (
            <li key={r.id} className="px-4 py-2.5 text-xs">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium text-ink">{r.contact}</span>
                  {r.voice && (
                    <Badge tone="info">
                      <Mic size={11} />
                      Voice
                    </Badge>
                  )}
                  {r.handoff && <Badge tone="warning">Alerted the team</Badge>}
                  {r.status === 'error' && <Badge tone="danger">Failed</Badge>}
                </span>
                <span className="text-2xs tabular-nums text-ink-faint">{formatDateTime(r.createdAt)}</span>
              </div>
              <p className="text-ink-muted">
                <span className="font-medium text-ink-subtle">Asked · </span>
                {r.inbound || '—'}
              </p>
              {r.status === 'error' ? (
                <p className="mt-0.5 text-danger-600">{r.error}</p>
              ) : (
                <p className="mt-0.5 whitespace-pre-wrap text-ink">
                  <span className="font-medium text-ink-subtle">Answered · </span>
                  {r.reply || '(no message sent)'}
                </p>
              )}
              <p className="mt-1 text-2xs tabular-nums text-ink-faint">
                {r.model} · {r.inputTokens} in · {r.outputTokens} out · {r.cacheReadTokens} cached
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
