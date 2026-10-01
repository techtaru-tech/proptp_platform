import { useState } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { formatDate } from '../../utils/format';
import { usePortal } from './PortalContext';
import { MaterialEntryModal } from '../vendors/MaterialEntryModal';

export function PortalMaterial() {
  const { api: portal, readOnly } = usePortal();
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const me = useAsync(() => portal.me(), []);
  const { data } = useAsync(() => portal.materials(), [reload]);
  const sites = Array.from(new Map((me.data?.workOrders ?? []).map((w) => [w.projectId, { id: w.projectId, projectName: w.projectName }])).values());
  return (
    <div>
      <PageHeader title="Material delivered" description="Record each delivery with photos of the material, the challan and the vehicle." breadcrumb={[{ label: 'Material' }]}
        actions={readOnly ? undefined : <Button variant="primary" leftIcon={<Plus size={14} />} disabled={sites.length === 0} onClick={() => setAdding(true)}>Record delivery</Button>} />
      {!data ? <CardSkeleton /> : data.length === 0 ? <Card><EmptyState title="No deliveries recorded" /></Card> : (
        <Card padded={false}><ul className="divide-y divide-line">{data.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
            <span><span className="font-medium">{e.quantity} {e.unit} {e.material}</span> <span className="text-ink-muted">· {e.projectName} · challan {e.challanNo} · {formatDate(e.receivedOn)}</span>
              {e.rejectionReason && <span className="block text-xs text-danger-700">Rejected: {e.rejectionReason}</span>}</span>
            <Badge tone={e.status === 'verified' ? 'success' : e.status === 'rejected' ? 'danger' : 'warning'}>{e.status === 'pending' ? 'awaiting check' : e.status}</Badge>
          </li>))}</ul></Card>
      )}
      {adding && <MaterialEntryModal projects={sites} submit={portal.postMaterial} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setReload((k) => k + 1); }} />}
    </div>
  );
}
