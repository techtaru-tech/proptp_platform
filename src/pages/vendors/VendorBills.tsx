import { useState } from 'react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { formatCurrency, formatDate } from '../../utils/format';
import { listAllBills, reviewBill, type BillRow } from '../../services/vendorService';

const TABS = [{ key: 'submitted', label: 'To approve' }, { key: 'approved', label: 'To pay' }, { key: 'paid', label: 'Paid' }, { key: 'rejected', label: 'Rejected' }];
const TONE = { submitted: 'warning', approved: 'info', paid: 'success', rejected: 'danger' } as const;

export function VendorBills() {
  const { toast } = useToast();
  const [tab, setTab] = useState('submitted');
  const [reload, setReload] = useState(0);
  const [dialog, setDialog] = useState<{ bill: BillRow; mode: 'reject' | 'pay' } | null>(null);
  const [text, setText] = useState('');
  const { data, isLoading, error } = useAsync(() => listAllBills(tab), [tab, reload]);

  const act = async (bill: BillRow, decision: 'approve' | 'reject' | 'pay') => {
    try {
      await reviewBill(bill.id, decision, decision === 'reject' ? { reason: text } : decision === 'pay' ? { paymentRef: text } : {});
      toast({ title: decision === 'approve' ? 'Bill approved' : decision === 'pay' ? 'Marked as paid' : 'Bill rejected', variant: 'success' });
      setDialog(null); setText(''); setReload((k) => k + 1);
    } catch (err) { toast({ title: 'Could not update the bill', description: (err as Error).message, variant: 'error' }); }
  };

  return (
    <div>
      <PageHeader title="Vendor bills" description="Raised against work orders. Approve first; mark paid once the money has gone." breadcrumb={[{ label: 'Vendors & Material' }, { label: 'Bills' }]} />
      <div className="mb-4 flex gap-2" role="tablist">
        {TABS.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`rounded-lg border px-3 py-1.5 text-sm focus-ring ${tab === t.key ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line text-ink-muted'}`}>{t.label}</button>)}
      </div>
      {error ? <ErrorState title="Could not load bills" description={error.message} /> : isLoading || !data ? <CardSkeleton /> : data.length === 0 ? <Card><EmptyState title="No bills here" /></Card> : (
        <div className="flex flex-col gap-3">
          {data.map((b) => (
            <Card key={b.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">{b.vendorName} <span className="font-normal text-ink-muted">· bill {b.billNumber}</span></p>
                  <p className="text-xs text-ink-muted">{b.workOrderNumber} · {b.projectName} · {b.description} · dated {formatDate(b.billDate)}</p>
                </div>
                <div className="text-right"><p className="text-lg font-semibold tabular-nums">{formatCurrency(b.amount)}</p><Badge tone={TONE[b.status]}>{b.status}</Badge></div>
              </div>
              {b.rejectionReason && <p className="mt-2 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">Rejected: {b.rejectionReason}</p>}
              {b.paymentRef && <p className="mt-2 text-xs text-ink-muted">Payment reference: {b.paymentRef}</p>}
              {b.status === 'submitted' && <div className="mt-3 flex justify-end gap-2 border-t border-line pt-3"><Button variant="outline" onClick={() => { setDialog({ bill: b, mode: 'reject' }); setText(''); }}>Reject</Button><Button variant="primary" onClick={() => act(b, 'approve')}>Approve</Button></div>}
              {b.status === 'approved' && <div className="mt-3 flex justify-end border-t border-line pt-3"><Button variant="primary" onClick={() => { setDialog({ bill: b, mode: 'pay' }); setText(''); }}>Mark paid</Button></div>}
            </Card>
          ))}
        </div>
      )}
      <Modal isOpen={!!dialog} onClose={() => setDialog(null)} title={dialog?.mode === 'reject' ? 'Reject this bill' : 'Mark as paid'}
        footer={<><Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button><Button variant="primary" disabled={dialog?.mode === 'reject' && !text.trim()} onClick={() => dialog && act(dialog.bill, dialog.mode)}>{dialog?.mode === 'reject' ? 'Reject bill' : 'Mark paid'}</Button></>}>
        <Input label={dialog?.mode === 'reject' ? 'Reason' : 'Payment reference (optional)'} name="billDialogText" value={text} onChange={(e) => setText(e.target.value)} />
      </Modal>
    </div>
  );
}
