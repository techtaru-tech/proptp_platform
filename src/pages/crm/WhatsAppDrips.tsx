import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Pause, Pencil, Play, Plus, Trash2, Users } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { SearchInput } from '../../components/ui/SearchInput';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { deleteDrip, DRIP_STATUS_OPTIONS, DRIP_STATUS_TONE, listDrips, runDueDripSteps, setDripStatus } from '../../services/whatsappDripService';
import { formatDate } from '../../utils/format';
import type { WhatsAppDrip } from '../../types';

export function WhatsAppDrips() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<WhatsAppDrip | null>(null);
  const [running, setRunning] = useState(false);

  const { data: drips, isLoading } = useAsync(() => listDrips(), [reloadKey]);
  const reload = () => setReloadKey((k) => k + 1);

  const term = search.trim().toLowerCase();
  const rows = (drips ?? []).filter((d) => !term || d.name.toLowerCase().includes(term) || (d.description ?? '').toLowerCase().includes(term));

  const toggle = async (drip: WhatsAppDrip) => {
    const next = drip.status === 'active' ? 'paused' : 'active';
    try {
      await setDripStatus(drip.id, next);
      toast({ title: next === 'active' ? 'Campaign is live' : 'Campaign paused', description: next === 'active' ? 'Enrolled leads get their steps on schedule.' : 'Nothing more is sent until you resume it.', variant: 'success' });
      reload();
    } catch (err) {
      toast({ title: 'Could not change status', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    }
  };

  const columns: DataTableColumn<WhatsAppDrip>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (d) => (
        <div>
          <p className="font-medium text-ink">{d.name}</p>
          {d.description && <p className="max-w-md truncate text-xs text-ink-faint">{d.description}</p>}
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (d) => <Badge tone={DRIP_STATUS_TONE[d.status]}>{DRIP_STATUS_OPTIONS.find((o) => o.value === d.status)?.label}</Badge> },
    { key: 'steps', header: 'Steps', align: 'center', render: (d) => d.stepCount },
    { key: 'active', header: 'Active', align: 'center', render: (d) => d.activeEnrollments },
    { key: 'completed', header: 'Completed', align: 'center', render: (d) => d.completedEnrollments },
    { key: 'stopped', header: 'Stopped', align: 'center', render: (d) => d.stoppedEnrollments },
    { key: 'createdAt', header: 'Created', render: (d) => formatDate(d.createdAt) },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (d) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" leftIcon={d.status === 'active' ? <Pause size={13} /> : <Play size={13} />} onClick={() => toggle(d)}>
            {d.status === 'active' ? 'Pause' : 'Start'}
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<Users size={13} />} onClick={() => navigate(`/crm/whatsapp-drips/${d.id}`)}>
            Leads
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<Pencil size={13} />} onClick={() => navigate(`/crm/whatsapp-drips/${d.id}/edit`)}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" className="text-danger-600" leftIcon={<Trash2 size={13} />} onClick={() => setDeleteTarget(d)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="WhatsApp Drip Campaigns"
        description="A timed series of approved WhatsApp templates. Leads are enrolled once, steps go out on schedule, and a campaign stops for a lead who replies or is won."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'WhatsApp Drips' }]}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              leftIcon={<Play size={14} />}
              isLoading={running}
              onClick={async () => {
                setRunning(true);
                try {
                  await runDueDripSteps();
                  toast({ title: 'Due steps processed', variant: 'success' });
                  reload();
                } finally {
                  setRunning(false);
                }
              }}
            >
              Run Due Steps
            </Button>
            <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => navigate('/crm/whatsapp-drips/new')}>
              New Drip Campaign
            </Button>
          </div>
        }
      />

      <Card padded={false}>
        <div className="flex justify-end border-b border-line p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search campaigns..." className="sm:w-72" />
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(d) => d.id}
          isLoading={isLoading}
          onRowClick={(d) => navigate(`/crm/whatsapp-drips/${d.id}`)}
          emptyTitle="No drip campaigns"
          emptyDescription="Create a campaign from your approved templates, then enrol leads into it."
        />
      </Card>

      <ConfirmationDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteDrip(deleteTarget.id);
          toast({ title: 'Campaign deleted', variant: 'success' });
          setDeleteTarget(null);
          reload();
        }}
        title="Delete this campaign?"
        description={deleteTarget ? `"${deleteTarget.name}", its ${deleteTarget.stepCount} step(s) and every enrollment are removed. Messages already sent stay in each lead's WhatsApp thread.` : undefined}
        confirmLabel="Delete campaign"
        variant="danger"
      />

      <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-faint">
        <MessageCircle size={12} />
        Due steps are picked up automatically once a minute. Every step is a template approved on your WhatsApp number — create them under Notifications → WhatsApp Templates.
      </p>
    </div>
  );
}
