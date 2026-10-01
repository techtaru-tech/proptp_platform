import { useState } from 'react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { getTemplates, label, saveTemplate, type Template } from '../../services/legalService';

export function Templates() {
  const { data } = useAsync(() => getTemplates(), []);
  return (
    <div>
      <PageHeader title="Document templates" description="The wording of the allotment letter, agreement, receipt and demand note. Placeholders are filled from each booking." breadcrumb={[{ label: 'Legal & Registry' }, { label: 'Templates' }]} />
      <p className="mb-4 rounded-lg bg-warning-50 px-4 py-3 text-sm text-warning-700">The starting wording is a plain template, not legal advice. Have your counsel review and replace it before documents go to buyers.</p>
      {!data ? <CardSkeleton /> : (
        <div className="flex flex-col gap-5">{data.templates.map((t) => <Editor key={t.kind} template={t} placeholders={data.placeholders} />)}</div>)}
    </div>
  );
}

function Editor({ template, placeholders }: { template: Template; placeholders: string[] }) {
  const { toast } = useToast();
  const [title, setTitle] = useState(template.title);
  const [body, setBody] = useState(template.body);
  const [saving, setSaving] = useState(false);
  const dirty = title !== template.title || body !== template.body;
  const save = async () => {
    setSaving(true);
    try { await saveTemplate(template.kind, { title, body }); toast({ title: `${label(template.kind)} template saved`, variant: 'success' }); template.title = title; template.body = body; }
    catch (e) { toast({ title: 'Could not save', description: (e as Error).message, variant: 'error' }); }
    finally { setSaving(false); }
  };
  return (
    <Card>
      <h3 className="mb-3 font-semibold text-ink">{label(template.kind)}</h3>
      <div className="flex flex-col gap-3">
        <Input label="Heading" name={`t-title-${template.kind}`} value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea label="Wording" id={`t-body-${template.kind}`} rows={10} value={body} onChange={setBody} />
        <p className="text-xs text-ink-muted">Available: {placeholders.map((p) => <code key={p} className="mr-1 rounded bg-surface-muted px-1">{`{{${p}}}`}</code>)}</p>
        <div className="flex justify-end"><Button variant="primary" onClick={save} isLoading={saving} disabled={!dirty}>Save template</Button></div>
      </div>
    </Card>
  );
}
