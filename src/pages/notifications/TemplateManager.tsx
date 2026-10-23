import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { Select } from '../../components/ui/Select';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { useToast } from '../../context/ToastContext';
import { listManagedTemplates, removeTemplate, submitTemplate } from '../../services/whatsappTemplateService';
import type { ManagedWhatsAppTemplate } from '../../types';

const STATUS_TONE: Record<string, BadgeTone> = { APPROVED: 'success', PENDING: 'warning', REJECTED: 'danger' };

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'en_US', label: 'English (US)' },
];

/**
 * Write a template, send it to Meta for review and watch its status — all without leaving the
 * panel. Only APPROVED ones show up in the broadcast form below; the rest are listed here so
 * nobody has to wonder where a submission went.
 */
export function TemplateManager({ onChanged }: { onChanged: () => Promise<void> }) {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<ManagedWhatsAppTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<ManagedWhatsAppTemplate | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setTemplates(await listManagedTemplates());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read templates from Meta.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmDelete = async () => {
    if (!toDelete) return;
    const name = toDelete.name;
    setToDelete(null);
    try {
      await removeTemplate(name);
      toast({ title: `Deleted ${name}`, variant: 'success' });
      await Promise.all([load(), onChanged()]);
    } catch (err) {
      toast({ title: 'Could not delete', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    }
  };

  return (
    <Card className="mb-5">
      <CardHeader
        title="Templates"
        subtitle="Create a template, send it to WhatsApp for approval, and see where it stands"
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" leftIcon={<RefreshCw size={14} />} isLoading={refreshing} onClick={() => void load()}>
              Refresh status
            </Button>
            <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setCreating((v) => !v)}>
              New template
            </Button>
          </div>
        }
      />

      {creating && (
        <NewTemplateForm
          onCreated={async () => {
            setCreating(false);
            await Promise.all([load(), onChanged()]);
          }}
        />
      )}

      {error ? (
        <p className="text-sm text-danger-600">{error}</p>
      ) : templates === null ? (
        <p className="text-sm text-ink-faint">Reading templates from Meta…</p>
      ) : templates.length === 0 ? (
        <p className="text-sm text-ink-faint">No templates yet. Create the first one.</p>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={`${t.name}-${t.language}`} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-ink">{t.name}</span>
                  <Badge tone={STATUS_TONE[t.status] ?? 'neutral'}>{t.status.charAt(0) + t.status.slice(1).toLowerCase()}</Badge>
                  <span className="text-xs text-ink-faint">{t.category} · {t.language}</span>
                </span>
                <Button variant="ghost" size="sm" leftIcon={<Trash2 size={14} />} onClick={() => setToDelete(t)}>
                  Delete
                </Button>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink-muted">{t.body}</p>
              {t.rejectedReason && <p className="mt-1 text-xs text-danger-600">Rejected: {t.rejectedReason}</p>}
            </div>
          ))}
        </div>
      )}

      <ConfirmationDialog
        isOpen={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        title={`Delete "${toDelete?.name}"?`}
        description="It is removed from WhatsApp for every language. A deleted name cannot be reused for about a month."
        confirmLabel="Delete template"
      />
    </Card>
  );
}

function NewTemplateForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<'MARKETING' | 'UTILITY'>('MARKETING');
  const [language, setLanguage] = useState('en');
  const [header, setHeader] = useState('');
  const [body, setBody] = useState('');
  const [footer, setFooter] = useState('');
  const [samples, setSamples] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const variableCount = new Set(body.match(/\{\{\s*\d+\s*\}\}/g) ?? []).size;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await submitTemplate({
        name, category, language, header: header || undefined, body, footer: footer || undefined,
        samples: samples.slice(0, variableCount),
      });
      toast({
        title: 'Sent to WhatsApp for review',
        description: `${result.name} is ${result.status.toLowerCase()}. Press Refresh status to see when it is approved.`,
        variant: 'success',
      });
      await onCreated();
    } catch (err) {
      toast({ title: 'Could not submit', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mb-4 space-y-4 rounded-lg border border-line bg-surface-subtle p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="site_visit_reminder"
          hint="Lowercase letters, numbers and underscores."
          required
        />
        <Select
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value as 'MARKETING' | 'UTILITY')}
          options={[
            { value: 'MARKETING', label: 'Marketing — offers, promotions' },
            { value: 'UTILITY', label: 'Utility — updates about something they did' },
          ]}
        />
        <Select label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} options={LANGUAGES} />
      </div>

      <Input label="Header (optional)" value={header} onChange={(e) => setHeader(e.target.value)} maxLength={60} />
      <Textarea
        label="Message"
        rows={5}
        value={body}
        onChange={setBody}
        placeholder={'Hi {{1}}, your site visit at {{2}} is confirmed for tomorrow.'}
        hint="Use {{1}}, {{2}} … where a value changes per person. Up to 1024 characters."
      />

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

      <Input label="Footer (optional)" value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={60} />

      <div className="flex justify-end">
        <Button type="submit" variant="primary" isLoading={saving} disabled={!name.trim() || !body.trim()}>
          Submit for approval
        </Button>
      </div>
    </form>
  );
}
