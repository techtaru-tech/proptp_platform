import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Info, Mail, Pencil, Play, Plus, Trash2, Users } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { SearchInput } from '../../components/ui/SearchInput';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  deleteEmailSequence, getEmailCapabilities, listEmailSequences, runDueSequenceSteps,
  SEQUENCE_STATUS_OPTIONS, SEQUENCE_STATUS_TONE,
} from '../../services/emailSequenceService';
import { formatDate } from '../../utils/format';
import type { EmailSequence } from '../../types';

export function EmailSequences() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<EmailSequence | null>(null);
  const [running, setRunning] = useState(false);

  const { data: sequences, isLoading } = useAsync(() => listEmailSequences(), [reloadKey]);
  const { data: capabilities } = useAsync(() => getEmailCapabilities(), []);

  const term = search.trim().toLowerCase();
  const rows = (sequences ?? []).filter(
    (s) => !term || s.name.toLowerCase().includes(term) || (s.description ?? '').toLowerCase().includes(term)
  );

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteEmailSequence(deleteTarget.id);
    toast({ title: 'Sequence deleted', description: 'Its steps and enrollments were removed too.', variant: 'success' });
    setDeleteTarget(null);
    setReloadKey((k) => k + 1);
  };

  const handleRunDue = async () => {
    setRunning(true);
    try {
      await runDueSequenceSteps();
      toast({ title: 'Due steps processed', description: 'Anything scheduled for now or earlier has been sent.', variant: 'success' });
      setReloadKey((k) => k + 1);
    } finally {
      setRunning(false);
    }
  };

  const columns: DataTableColumn<EmailSequence>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (s) => (
        <div>
          <p className="font-medium text-ink">{s.name}</p>
          {s.description && <p className="max-w-md truncate text-xs text-ink-faint">{s.description}</p>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (s) => (
        <Badge tone={SEQUENCE_STATUS_TONE[s.status]}>
          {SEQUENCE_STATUS_OPTIONS.find((o) => o.value === s.status)?.label ?? s.status}
        </Badge>
      ),
    },
    { key: 'steps', header: 'Steps', align: 'center', render: (s) => s.stepCount },
    { key: 'active', header: 'Active Enrollments', align: 'center', render: (s) => s.activeEnrollments },
    { key: 'completed', header: 'Completed', align: 'center', render: (s) => s.completedEnrollments },
    { key: 'createdAt', header: 'Created', render: (s) => formatDate(s.createdAt) },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (s) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" leftIcon={<Users size={13} />} onClick={() => navigate(`/crm/email-sequences/${s.id}`)}>
            Leads
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<Pencil size={13} />} onClick={() => navigate(`/crm/email-sequences/${s.id}/edit`)}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" className="text-danger-600" leftIcon={<Trash2 size={13} />} onClick={() => setDeleteTarget(s)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Email Sequences"
        description="A timed series of emails a lead is enrolled into. Steps go out top-to-bottom, and the sequence stops itself when the lead replies or is won."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Email Sequences' }]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" leftIcon={<Play size={14} />} isLoading={running} onClick={handleRunDue}>
              Run Due Steps
            </Button>
            <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => navigate('/crm/email-sequences/new')}>
              New Email Sequence
            </Button>
          </div>
        }
      />

      {capabilities && !capabilities.emailProviderConfigured && (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          <Info size={16} className="mt-0.5 shrink-0" />
          <p>
            <strong>No email provider is configured.</strong> Sequences run for real — leads enrol, delays are honoured,
            steps advance on schedule and the stop rules fire — but nothing leaves the building. Each step is recorded on
            the lead's timeline with its full rendered subject and body so nothing is lost.
          </p>
        </div>
      )}

      <Card padded={false}>
        <div className="flex justify-end border-b border-line p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search sequences..." className="sm:w-72" />
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(s) => s.id}
          isLoading={isLoading}
          onRowClick={(s) => navigate(`/crm/email-sequences/${s.id}`)}
          emptyTitle="No Email Sequences"
          emptyDescription="Create a sequence, then enrol leads into it from the leads list or with an automation action."
        />
      </Card>

      <ConfirmationDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete this sequence?"
        description={
          deleteTarget
            ? `"${deleteTarget.name}", its ${deleteTarget.stepCount} step(s) and every enrollment will be permanently removed. Leads themselves are not affected, and emails already recorded on their timelines stay.`
            : undefined
        }
        confirmLabel="Delete sequence"
        variant="danger"
      />

      <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-faint">
        <Mail size={12} />
        Due steps are picked up automatically once a minute. "Run Due Steps" just does it now instead of waiting.
      </p>
    </div>
  );
}
