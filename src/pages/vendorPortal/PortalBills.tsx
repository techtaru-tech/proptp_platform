import { useState } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { formatCurrency, formatDate } from '../../utils/format';
import { usePortal } from './PortalContext';

const TONE = { submitted: 'warning', approved: 'info', paid: 'success', rejected: 'danger' } as const;

export function PortalBills() {
  const { api: portal, readOnly } = usePortal();
  const { toast } = useToast();
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ workOrderId: '', billNumber: '', amount: '', billDate: new Date().toISOString().slice(0, 10) });
  const [saving, setSaving] = useState(false);
  const me = useAsync(() => portal.me(), [reload]);
  const { data } = useAsync(() => portal.bills(), [reload]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try { await portal.postBill({ ...f, amount: Number(f.amount) }); toast({ title: 'Bill submitted', variant: 'success' }); setAdding(false); setReload((k) => k + 1); }
    catch (err) { toast({ title: 'Could not submit the bill', description: (err as Error).message, variant: 'error' }); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <PageHeader title="Bills" description="Raised against your work orders. Approval and payment show here." breadcrumb={[{ label: 'Bills' }]}
        actions={readOnly ? undefined : <Button variant="primary" leftIcon={<Plus size={14} />} disabled={!me.data?.workOrders.length} onClick={() => { setF((x) => ({ ...x, workOrderId: me.data?.workOrders[0]?.id ?? '' })); setAdding(true); }}>Raise bill</Button>} />
      {!data ? <CardSkeleton /> : data.length === 0 ? <Card><EmptyState title="No bills yet" /></Card> : (
        <Card padded={false}><ul className="divide-y divide-line">{data.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
            <span><span className="font-medium">{b.billNumber}</span> <span className="text-ink-muted">· {b.workOrderNumber} · {formatDate(b.billDate)}</span>
              {b.rejectionReason && <span className="block text-xs text-danger-700">Rejected: {b.rejectionReason}</span>}{b.paymentRef && <span className="block text-xs text-ink-muted">Ref {b.paymentRef}</span>}</span>
            <span className="flex items-center gap-3"><span className="font-semibold tabular-nums">{formatCurrency(b.amount)}</span><Badge tone={TONE[b.status]}>{b.status}</Badge></span>
          </li>))}</ul></Card>
      )}
      <Modal isOpen={adding} onClose={() => setAdding(false)} title="Raise a bill"
        footer={<><Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" onClick={save} isLoading={saving} disabled={!f.billNumber.trim() || !(Number(f.amount) > 0)}>Submit</Button></>}>
        <div className="flex flex-col gap-4">
          <Select label="Work order" name="workOrderId" value={f.workOrderId} onChange={set('workOrderId')} options={(me.data?.workOrders ?? []).map((w) => ({ value: w.id, label: `${w.number} — ${w.description} (left ₹${w.amount - w.billed})` }))} />
          <Input label="Bill number" name="billNumber" required value={f.billNumber} onChange={set('billNumber')} />
          <Input label="Amount (₹)" name="billAmount" type="number" min={1} required value={f.amount} onChange={set('amount')} />
          <DatePicker label="Bill date" name="billDate" value={f.billDate} onChange={set('billDate')} />
        </div>
      </Modal>
    </div>
  );
}
