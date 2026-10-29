import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Megaphone, Pause, Play, Plus, Trash2, UserX } from 'lucide-react';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Card, CardHeader } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { Input } from '../../../components/ui/Input';
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../../../components/tables/DataTable';
import { useAsync } from '../../../hooks/useAsync';
import { useToast } from '../../../context/ToastContext';
import { DRIP_STATUS_OPTIONS, DRIP_STATUS_TONE } from '../../../services/whatsappDripService';
import {
  addOptOut, deleteCampaign, listCampaigns, listOptOuts, removeOptOut, setCampaignStatus,
} from '../../../services/waCampaignService';
import { formatDate, formatDateTime } from '../../../utils/format';
import type { WaCampaign } from '../../../types';

export function WaCampaigns() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reload, setReload] = useState(0);
  const [toDelete, setToDelete] = useState<WaCampaign | null>(null);
  const { data: campaigns, isLoading } = useAsync(() => listCampaigns(), [reload]);
  const refresh = () => setReload((k) => k + 1);

  const toggle = async (c: WaCampaign) => {
    try {
      await setCampaignStatus(c.id, c.status === 'active' ? 'paused' : 'active');
      refresh();
    } catch (err) {
      toast({ title: 'Could not change status', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    }
  };

  const columns: DataTableColumn<WaCampaign>[] = [
    {
      key: 'name',
      header: 'Campaign',
      render: (c) => (
        <div>
          <p className="font-medium text-ink">{c.name}</p>
          <p className="text-xs text-ink-faint">{c.kind === 'flow' ? 'Demo journey' : 'One template to a list'}</p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (c) => <Badge tone={DRIP_STATUS_TONE[c.status]}>{DRIP_STATUS_OPTIONS.find((o) => o.value === c.status)?.label}</Badge> },
    { key: 'contacts', header: 'People', align: 'center', render: (c) => c.contactCount ?? 0 },
    { key: 'ends', header: 'Ends', render: (c) => (c.endsAt ? formatDate(c.endsAt) : <span className="text-warning-700">Not set</span>) },
    {
      key: 'issues',
      header: '',
      render: (c) => (c.lastError ? <Badge tone="danger">Stopped: needs attention</Badge> : c.warnings.length > 0 ? <Badge tone="warning">{c.warnings.length} to set up</Badge> : null),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (c) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" leftIcon={c.status === 'active' ? <Pause size={13} /> : <Play size={13} />} onClick={() => toggle(c)}>
            {c.status === 'active' ? 'Pause' : 'Start'}
          </Button>
          <Button variant="ghost" size="sm" className="text-danger-600" leftIcon={<Trash2 size={13} />} onClick={() => setToDelete(c)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="WhatsApp Campaigns"
        description="Import a list from Excel and send it an approved template — or run the full demo journey: video, language, interest, eligibility, and a booked consultation."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'WhatsApp Campaigns' }]}
        actions={<Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => navigate('/crm/wa-campaigns/new')}>New Campaign</Button>}
      />

      <Card padded={false} className="mb-5">
        <DataTable
          columns={columns}
          rows={campaigns ?? []}
          rowKey={(c) => c.id}
          isLoading={isLoading}
          onRowClick={(c) => navigate(`/crm/wa-campaigns/${c.id}`)}
          emptyTitle="No campaigns yet"
          emptyDescription="Create one, import your list, and start it when the template is approved."
        />
      </Card>

      <OptOutCard />

      <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-faint">
        <Megaphone size={12} />
        Messages go out between 9 am and 8 pm IST, never to anyone who has said STOP, and never faster than the daily limit you set.
      </p>

      <ConfirmationDialog
        isOpen={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          await deleteCampaign(toDelete.id);
          setToDelete(null);
          refresh();
        }}
        title="Delete this campaign?"
        description={toDelete ? `"${toDelete.name}", its list and every record of who was sent what are removed. The leads themselves stay.` : undefined}
        confirmLabel="Delete campaign"
        variant="danger"
      />
    </div>
  );
}

/** Everyone who has said STOP — one list for every campaign, drip and broadcast. */
function OptOutCard() {
  const { toast } = useToast();
  const [reload, setReload] = useState(0);
  const [phone, setPhone] = useState('');
  const { data: rows } = useAsync(() => listOptOuts(), [reload]);

  return (
    <Card>
      <CardHeader title={`Opted out (${rows?.length ?? 0})`} subtitle="Anyone who replies STOP is added here automatically and is never messaged again, by any campaign, drip or broadcast." />
      <div className="mb-3 flex max-w-md items-end gap-2">
        <Input label="Add a number by hand" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="9876543210" wrapperClassName="flex-1" />
        <Button
          variant="outline"
          leftIcon={<UserX size={14} />}
          disabled={!phone.trim()}
          onClick={async () => {
            try {
              await addOptOut(phone.trim(), 'Added by the team');
              setPhone('');
              setReload((k) => k + 1);
            } catch (err) {
              toast({ title: 'Could not add', description: err instanceof Error ? err.message : undefined, variant: 'error' });
            }
          }}
        >
          Add
        </Button>
      </div>
      {(rows ?? []).length === 0 ? (
        <p className="text-sm text-ink-faint">Nobody has opted out.</p>
      ) : (
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {(rows ?? []).map((r) => (
            <div key={r.phone} className="flex items-center justify-between gap-2 border-b border-line py-1.5 text-sm">
              <span><span className="font-medium text-ink">{r.phone}</span> <span className="text-ink-faint">· {r.reason || r.source} · {formatDateTime(r.createdAt)}</span></span>
              <Button variant="ghost" size="sm" onClick={async () => { await removeOptOut(r.phone); setReload((k) => k + 1); }}>
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-ink-faint">Only remove a number if the person has asked, in writing, to be messaged again.</p>
    </Card>
  );
}
