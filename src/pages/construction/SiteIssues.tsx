import { useState } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { Textarea } from '../../components/ui/Textarea';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { fileUrl, uploadFiles } from '../../services/apiClient';
import { formatDate } from '../../utils/format';
import {
  createSiteIssue, listConstructionPeople, listConstructionProjects, listSiteIssues, updateSiteIssue, type SiteIssueRow,
} from '../../services/constructionService';

const TABS = [{ key: 'open', label: 'Open' }, { key: 'closed', label: 'Closed' }];
const STATUS_LABEL = { open: 'Open', in_progress: 'In progress', closed: 'Closed' } as const;

export function SiteIssues() {
  const { toast } = useToast();
  const [tab, setTab] = useState('open');
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const { data, isLoading, error } = useAsync(() => listSiteIssues(tab), [tab, reload]);

  const act = async (issue: SiteIssueRow, status: 'in_progress' | 'closed') => {
    try {
      await updateSiteIssue(issue.id, { status });
      toast({ title: status === 'closed' ? 'Issue closed' : 'Marked in progress', variant: 'success' });
      setReload((k) => k + 1);
    } catch (err) {
      toast({ title: 'Could not update the issue', description: (err as Error).message, variant: 'error' });
    }
  };

  return (
    <div>
      <PageHeader title="Site issues" description="Snags and problems raised on site, each with an owner and a due date, until closed."
        breadcrumb={[{ label: 'Construction', to: '/construction' }, { label: 'Site issues' }]}
        actions={<Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setCreating(true)}>Raise issue</Button>} />
      <div className="mb-4 flex gap-2" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`rounded-lg border px-3 py-1.5 text-sm focus-ring ${tab === t.key ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line text-ink-muted'}`}>{t.label}</button>
        ))}
      </div>
      {error ? <ErrorState title="Could not load issues" description={error.message} /> : isLoading || !data ? <CardSkeleton /> : data.length === 0 ? (
        <Card><EmptyState icon={AlertTriangle} title={tab === 'open' ? 'No open issues' : 'Nothing closed yet'} /></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((i) => (
            <Card key={i.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{i.title}</p>
                  <p className="text-xs text-ink-muted">{i.projectName}{i.activityName ? ` · ${i.activityName}` : ''} · raised by {i.raisedByName}</p>
                  {i.description && <p className="mt-2 text-sm text-ink">{i.description}</p>}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge tone={i.status === 'closed' ? 'success' : i.status === 'in_progress' ? 'info' : 'warning'}>{STATUS_LABEL[i.status]}</Badge>
                  <span className="text-xs text-ink-muted">Owner: {i.ownerName ?? 'nobody yet'}</span>
                  {i.dueDate && <span className={`text-xs ${i.overdue ? 'font-medium text-danger-700' : 'text-ink-muted'}`}>{i.overdue ? 'Overdue · ' : 'Due '}{formatDate(i.dueDate)}</span>}
                </div>
              </div>
              {i.photos.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {i.photos.map((p) => <a key={p} href={fileUrl(p)} target="_blank" rel="noreferrer"><img src={fileUrl(p)} alt={`Photo for ${i.title}`} className="h-20 w-28 rounded-lg border border-line object-cover" /></a>)}
                </div>
              )}
              {i.status !== 'closed' && (
                <div className="mt-3 flex justify-end gap-2 border-t border-line pt-3">
                  {i.status === 'open' && <Button variant="outline" size="sm" onClick={() => act(i, 'in_progress')}>Start work</Button>}
                  <Button variant="primary" size="sm" onClick={() => act(i, 'closed')}>Close</Button>
                </div>
              )}
              {i.status === 'closed' && i.closedAt && <p className="mt-2 text-xs text-ink-muted">Closed {formatDate(i.closedAt)}</p>}
            </Card>
          ))}
        </div>
      )}
      {creating && <IssueModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); setReload((k) => k + 1); }} />}
    </div>
  );
}

function IssueModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const { data: projects } = useAsync(() => listConstructionProjects(), []);
  const { data: people } = useAsync(() => listConstructionPeople(), []);
  const [f, setF] = useState({ projectId: '', title: '', description: '', ownerId: '', dueDate: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      const photos = files.length ? await uploadFiles(files) : [];
      await createSiteIssue({ ...f, ownerId: f.ownerId || undefined, dueDate: f.dueDate || undefined, photos } as never);
      onSaved();
    } catch (err) {
      toast({ title: 'Could not raise the issue', description: (err as Error).message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Raise a site issue"
      footer={<><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={save} isLoading={saving} disabled={!f.projectId || !f.title.trim()}>Raise issue</Button></>}>
      <div className="flex flex-col gap-4">
        <Select label="Project" name="issueProject" required value={f.projectId} onChange={set('projectId')} options={[{ value: '', label: 'Choose a project' }, ...(projects ?? []).map((p) => ({ value: p.id, label: p.projectName }))]} />
        <Input label="What is wrong" name="issueTitle" required value={f.title} onChange={set('title')} />
        <Textarea label="Details" id="issueDescription" value={f.description} onChange={(v) => setF((x) => ({ ...x, description: v }))} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Owner" name="issueOwner" value={f.ownerId} onChange={set('ownerId')} options={[{ value: '', label: 'Nobody yet' }, ...(people ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
          <DatePicker label="Due date" name="issueDue" value={f.dueDate} onChange={set('dueDate')} />
        </div>
        <div>
          <label htmlFor="issuePhotos" className="text-sm font-medium text-ink">Photos</label>
          <input id="issuePhotos" name="issuePhotos" type="file" accept="image/*" multiple className="mt-1.5 block w-full text-sm" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        </div>
      </div>
    </Modal>
  );
}
