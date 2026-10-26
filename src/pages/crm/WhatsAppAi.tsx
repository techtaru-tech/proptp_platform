import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bot, Mic, Pencil, Plus, Send, Trash2, UserRound } from 'lucide-react';
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
import { formatDateTime } from '../../utils/format';
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
      <div className="flex flex-col gap-5">
        <SettingsCard settings={settings} onSaved={setSettings} />
        <TryItCard />
        <KnowledgeCard entries={knowledge} onChanged={load} />
        <RepliesCard replies={replies} onRefresh={load} />
      </div>
    </div>
  );

}

function SettingsCard({ settings, onSaved }: { settings: WhatsAppAiSettings; onSaved: (s: WhatsAppAiSettings) => void }) {
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

  return (
    <Card>
      <CardHeader
        title="Settings"
        subtitle="Nothing is answered by the AI until you switch it on."
        action={<Badge tone={settings.enabled ? 'success' : 'neutral'}>{settings.enabled ? 'On' : 'Off'}</Badge>}
      />
      <div className="space-y-4">
        {!settings.hasAnthropicKey && (
          <p className="flex items-start gap-2 rounded-lg border border-warning-100 bg-warning-50 px-3 py-2 text-sm text-warning-700">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            Add your Anthropic API key below first — the assistant cannot answer without it.
          </p>
        )}

        <Toggle
          label="Answer messages with the AI assistant"
          description="Anything a keyword auto-reply does not cover — questions, long messages and voice notes — is answered by the AI and sent straight away."
          checked={settings.enabled}
          disabled={!canEnable && !settings.enabled}
          onChange={(enabled) => save({ enabled }, enabled ? 'AI assistant is on' : 'AI assistant is off')}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          <Input label="Most AI replies per chat per hour" type="number" min={1} value={maxPerHour} onChange={(e) => setMaxPerHour(e.target.value)} hint="A cap on cost and on anyone trying to run it up." />
        </div>

        <Textarea
          label="About your business and how to talk"
          rows={5}
          value={instructions}
          onChange={setInstructions}
          hint="Who you are and the tone to use. Facts such as services and prices belong in the knowledge base below."
        />

        <div className="rounded-lg border border-line p-3.5">
          <Toggle
            label="Understand voice notes"
            description="A voice note is turned into text by a speech-to-text service, then answered like any message. Needs its own key."
            checked={settings.voiceEnabled}
            onChange={(voiceEnabled) => save({ voiceEnabled }, voiceEnabled ? 'Voice notes on' : 'Voice notes off')}
          />
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        </div>

        <div className="flex justify-end">
          <Button
            variant="primary"
            isLoading={saving}
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
        <Textarea label="Customer message" rows={2} value={message} onChange={setMessage} placeholder="Mere clinic ke liye app banwana hai, patients appointment khud book kar sakein. Kitna lagega?" />
        <Input label="Pretend it is from this number (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="9876543210" hint="If a lead has this number, the assistant also sees that lead's record." />
        <Button variant="primary" leftIcon={<Send size={14} />} isLoading={busy} disabled={!message.trim()} onClick={run}>
          Get the answer
        </Button>

        {result && (
          <div className="space-y-2 rounded-lg border border-line bg-surface-subtle p-3">
            <p className="whitespace-pre-wrap text-sm text-ink">{result.reply || '(No reply — it would only alert the team.)'}</p>
            {result.handoff && (
              <p className="flex items-center gap-1.5 text-xs text-warning-700">
                <UserRound size={13} /> Would alert the team: {result.handoffReason ?? 'needs a person'}
              </p>
            )}
            <p className="text-xs text-ink-faint">
              {result.usage.input} in · {result.usage.output} out · {result.usage.cacheRead} cached tokens
            </p>
            <details className="text-xs text-ink-faint">
              <summary className="cursor-pointer">The record it was shown</summary>
              <pre className="mt-1 whitespace-pre-wrap">{result.record}</pre>
            </details>
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
    <Card>
      <CardHeader
        title={`Knowledge base (${entries.length})`}
        subtitle="Everything the assistant is allowed to state as fact: services, offers, policies, answers to common questions. If it is not here, the assistant hands over to a person instead of guessing."
        action={<Button variant="primary" size="sm" leftIcon={<Plus size={13} />} onClick={() => setEditing({ title: '', content: '', active: true })}>Add entry</Button>}
      />
      <div className="mb-3 max-w-sm">
        <SearchInput value={search} onChange={setSearch} placeholder="Search the knowledge base…" />
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-ink-faint">{entries.length === 0 ? 'Nothing here yet. Add what a customer might ask about.' : 'No entries match.'}</p>
      ) : (
        <div className="space-y-2">
          {shown.map((e) => (
            <div key={e.id} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-medium text-ink">
                  {e.title}
                  {!e.active && <Badge tone="neutral">Hidden from AI</Badge>}
                </p>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" leftIcon={<Pencil size={13} />} onClick={() => setEditing({ id: e.id, title: e.title, content: e.content, active: e.active })}>Edit</Button>
                  <Button variant="ghost" size="sm" className="text-danger-600" leftIcon={<Trash2 size={13} />} onClick={() => setToDelete(e)}>Delete</Button>
                </div>
              </div>
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-ink-muted">{e.content}</p>
            </div>
          ))}
        </div>
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
  return (
    <Card>
      <CardHeader
        title="Recent AI answers"
        subtitle="What it was asked, what it said, and what each answer cost. The full thread is in CRM → Conversations."
        action={<Button variant="outline" size="sm" onClick={() => void onRefresh()}>Refresh</Button>}
      />
      {replies.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-ink-faint"><Bot size={14} /> Nothing has been answered by the AI yet.</p>
      ) : (
        <div className="space-y-2">
          {replies.map((r) => (
            <div key={r.id} className="rounded-lg border border-line p-3 text-sm">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{r.contact}</span>
                  {r.voice && <Badge tone="info"><Mic size={11} className="mr-1 inline" />Voice</Badge>}
                  {r.handoff && <Badge tone="warning">Alerted the team</Badge>}
                  {r.status === 'error' && <Badge tone="danger">Failed</Badge>}
                </span>
                <span className="text-xs text-ink-faint">{formatDateTime(r.createdAt)}</span>
              </div>
              <p className="text-ink-muted"><strong className="text-ink">Asked:</strong> {r.inbound || '—'}</p>
              {r.status === 'error' ? (
                <p className="text-danger-600">{r.error}</p>
              ) : (
                <p className="whitespace-pre-wrap text-ink-muted"><strong className="text-ink">Answered:</strong> {r.reply || '(no message sent)'}</p>
              )}
              <p className="mt-1 text-xs text-ink-faint">{r.model} · {r.inputTokens} in · {r.outputTokens} out · {r.cacheReadTokens} cached</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
