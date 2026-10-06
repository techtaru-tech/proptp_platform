import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/Textarea';
import { useToast } from '../../context/ToastContext';
import { formatCurrency, formatDateTime } from '../../utils/format';
import { APPROVER_LABEL, decideCancellation, markRefunded, type Cancellation } from '../../services/salesPolicyService';

/** The facts of a cancellation request: what was paid, what is kept, what goes back, and where it stands. */
export function CancellationFacts({ c }: { c: Cancellation }) {
  const tone = c.status === 'approved' ? 'success' : c.status === 'rejected' ? 'danger' : 'warning';
  return (
    <div className="text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{c.status === 'pending' ? 'Waiting for approval' : c.status === 'approved' ? 'Approved' : 'Rejected'}</Badge>
        {c.status === 'approved' && (c.refundedAt ? <Badge tone="success">Refund paid</Badge> : c.refundAmount > 0 ? <Badge tone="warning">Refund not yet paid</Badge> : null)}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
        <div><dt className="text-xs text-ink-faint">Paid by buyer</dt><dd className="font-medium tabular-nums">{formatCurrency(c.amountPaid)}</dd></div>
        <div><dt className="text-xs text-ink-faint">Kept ({c.deductionPercent}%)</dt><dd className="font-medium tabular-nums">{formatCurrency(c.deductionAmount)}</dd></div>
        <div><dt className="text-xs text-ink-faint">Refund</dt><dd className="font-semibold tabular-nums text-ink">{formatCurrency(c.refundAmount)}</dd></div>
        <div><dt className="text-xs text-ink-faint">Asked by</dt><dd>{c.requestedByName}<span className="block text-xs text-ink-faint">{formatDateTime(c.requestedAt)}</span></dd></div>
      </dl>
      <p className="mt-2 text-ink-muted">Reason: {c.reason}</p>
      {c.decidedByName && <p className="mt-1 text-xs text-ink-muted">{c.status === 'approved' ? 'Approved' : 'Rejected'} by {c.decidedByName}{c.decidedAt ? ` · ${formatDateTime(c.decidedAt)}` : ''}{c.decisionNote ? ` — ${c.decisionNote}` : ''}</p>}
      {c.refundedAt && <p className="mt-1 text-xs text-ink-muted">Refunded {formatDateTime(c.refundedAt)}{c.refundReference ? ` · ref ${c.refundReference}` : ''}</p>}
    </div>
  );
}

/** Approve, reject, or record the refund — only offered to someone the policy allows. */
export function CancellationButtons({ c, canDecide, approver, onDone }: { c: Cancellation; canDecide: boolean; approver: string; onDone: () => void }) {
  const { toast } = useToast();
  const [dlg, setDlg] = useState<'approve' | 'reject' | 'refund' | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!canDecide) {
    return c.status === 'pending' ? <p className="text-xs text-ink-muted">Only {APPROVER_LABEL[approver] ?? 'an approver'} can decide this.</p> : null;
  }
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast({ title: ok, variant: 'success' }); setDlg(null); setText(''); onDone(); }
    catch (e) { toast({ title: 'That did not work', description: (e as Error).message, variant: 'error' }); }
    finally { setBusy(false); }
  };
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {c.status === 'pending' && <>
          <Button variant="outline" size="sm" onClick={() => setDlg('reject')}>Reject</Button>
          <Button variant="primary" size="sm" onClick={() => setDlg('approve')}>Approve cancellation</Button></>}
        {c.status === 'approved' && !c.refundedAt && c.refundAmount > 0 && <Button variant="primary" size="sm" onClick={() => setDlg('refund')}>Record refund paid</Button>}
      </div>
      <Modal isOpen={dlg === 'approve'} onClose={() => setDlg(null)} title="Approve this cancellation?"
        footer={<><Button variant="outline" onClick={() => setDlg(null)}>Back</Button><Button variant="primary" isLoading={busy} onClick={() => run(() => decideCancellation(c.id, 'approve', text || undefined), 'Cancellation approved — the plot is available again')}>Approve</Button></>}>
        <p className="mb-3 text-sm text-ink-muted">The booking and its deposits are cancelled, plot {c.unit} goes back to available, and unpaid commission is withdrawn. The buyer is owed <strong className="text-ink">{formatCurrency(c.refundAmount)}</strong>.</p>
        <Input label="Note (optional)" name="approveNote" value={text} onChange={(e) => setText(e.target.value)} />
      </Modal>
      <Modal isOpen={dlg === 'reject'} onClose={() => setDlg(null)} title="Reject this cancellation"
        footer={<><Button variant="outline" onClick={() => setDlg(null)}>Back</Button><Button variant="primary" isLoading={busy} disabled={!text.trim()} onClick={() => run(() => decideCancellation(c.id, 'reject', text), 'Cancellation rejected')}>Reject</Button></>}>
        <Textarea label="Why" id="rejectCancelNote" value={text} onChange={setText} />
      </Modal>
      <Modal isOpen={dlg === 'refund'} onClose={() => setDlg(null)} title="Record the refund"
        footer={<><Button variant="outline" onClick={() => setDlg(null)}>Back</Button><Button variant="primary" isLoading={busy} onClick={() => run(() => markRefunded(c.id, text || undefined), 'Refund recorded')}>Mark refunded</Button></>}>
        <p className="mb-3 text-sm text-ink-muted">{formatCurrency(c.refundAmount)} has been returned to {c.buyerName}.</p>
        <Input label="Payment reference (optional)" name="refundRef" value={text} onChange={(e) => setText(e.target.value)} placeholder="UTR / cheque no." />
      </Modal>
    </>
  );
}
