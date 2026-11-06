import { useState } from 'react';
import { KeyRound, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { api } from '../../services/apiClient';

interface AiStatus { configured: boolean; source: 'environment' | 'settings' | null; hint: string | null; model: string }

const getAi = () => api.get<AiStatus>('/platform-settings/ai');
const saveAi = (apiKey: string) => api.put<AiStatus>('/platform-settings/ai', { apiKey });
const removeAi = () => api.delete<AiStatus>('/platform-settings/ai');

/** Settings > AI Assistant: the Anthropic API key the CRM analyst and the panel assistant use. */
export function AiAssistantSettings() {
  const { toast } = useToast();
  const [reload, setReload] = useState(0);
  const status = useAsync(() => getAi(), [reload]);
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const s = status.data;

  const save = async () => {
    setSaving(true);
    try {
      await saveAi(key.trim());
      setKey('');
      setReload((r) => r + 1);
      toast({ title: 'Key saved and checked', description: 'The CRM analyst is ready on CRM Overview.', variant: 'success' });
    } catch (e) {
      toast({ title: 'The key was not saved', description: (e as Error).message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    try { await removeAi(); setReload((r) => r + 1); toast({ title: 'Key removed', variant: 'success' }); }
    catch (e) { toast({ title: 'Could not remove it', description: (e as Error).message, variant: 'error' }); }
    finally { setConfirmRemove(false); }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="AI Assistant" description="The Anthropic API key behind the CRM analyst on CRM Overview and the panel assistant." />

      <Card>
        <CardHeader
          title="Status"
          action={s ? <Badge tone={s.configured ? 'success' : 'warning'} dot>{s.configured ? 'Switched on' : 'No key yet'}</Badge> : undefined}
        />
        {!s ? <p className="text-xs text-ink-subtle">Loading…</p> : (
          <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 [&>div]:bg-surface [&>div]:px-3 [&>div]:py-2.5">
            <div><dt className="text-xs text-ink-subtle">Key in use</dt><dd className="mt-0.5 font-mono text-[13px] text-ink">{s.hint ?? '—'}</dd></div>
            <div><dt className="text-xs text-ink-subtle">Comes from</dt><dd className="mt-0.5 text-[13px] text-ink">{s.source === 'environment' ? 'Server environment (ANTHROPIC_API_KEY)' : s.source === 'settings' ? 'Saved here' : '—'}</dd></div>
            <div><dt className="text-xs text-ink-subtle">Model</dt><dd className="mt-0.5 font-mono text-[13px] text-ink">{s.model}</dd></div>
          </dl>
        )}
        {s?.source === 'environment' && (
          <p className="mt-3 text-xs text-ink-subtle">The server's ANTHROPIC_API_KEY is set, so it is used even if you save a key here. Remove it from server/.env to use the key saved here instead.</p>
        )}
      </Card>

      <Card>
        <CardHeader title={s?.source === 'settings' ? 'Replace the key' : 'Add a key'} subtitle="Create one at console.anthropic.com → API keys. It is checked with Anthropic before it is saved." />
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Input
            secret wrapperClassName="flex-1" label="Anthropic API key" type="password" value={key}
            onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" leftIcon={<KeyRound size={14} />}
          />
          <Button type="submit" isLoading={saving} disabled={!key.trim().startsWith('sk-ant-')}>Check and save</Button>
        </form>
        <ul className="mt-4 space-y-2 text-xs text-ink-subtle">
          <li className="flex gap-2"><ShieldCheck size={14} className="shrink-0 text-brand-600" />Stored encrypted on the server. It is never sent back to the browser — only its last four characters are shown.</li>
          <li className="flex gap-2"><Sparkles size={14} className="shrink-0 text-brand-600" />The analyst only reads CRM data the person asking is allowed to see, and cannot change anything.</li>
        </ul>
        {s?.source === 'settings' && (
          <div className="mt-4 border-t border-line pt-3">
            <Button variant="ghost" size="sm" leftIcon={<Trash2 size={13} />} onClick={() => setConfirmRemove(true)}>Remove saved key</Button>
          </div>
        )}
      </Card>

      <ConfirmationDialog
        isOpen={confirmRemove} onClose={() => setConfirmRemove(false)} onConfirm={remove} variant="danger"
        title="Remove the saved key?" description="The CRM analyst and the assistant stop answering until a key is added again." confirmLabel="Remove key"
      />
    </div>
  );
}
