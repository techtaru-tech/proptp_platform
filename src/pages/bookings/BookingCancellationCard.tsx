import { useState } from 'react';
import { Ban } from 'lucide-react';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/Textarea';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { formatCurrency } from '../../utils/format';
import { getCancellationForBooking, requestCancellation } from '../../services/salesPolicyService';
import { CancellationButtons, CancellationFacts } from './CancellationActions';

/** On a booking: ask to cancel it, and follow the request to approval and refund. */
export function BookingCancellationCard({ bookingId, isDeposit, onChanged }: { bookingId: string; isDeposit: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const [reload, setReload] = useState(0);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { data } = useAsync(() => (isDeposit ? Promise.resolve(undefined) : getCancellationForBooking(bookingId)), [bookingId, reload]);
  if (!data) return null;
  const refresh = () => { setReload((k) => k + 1); onChanged(); };
  const send = async () => {
    setBusy(true);
    try { await requestCancellation(bookingId, reason); toast({ title: 'Cancellation requested', description: 'It waits for approval.', variant: 'success' }); setAsking(false); setReason(''); refresh(); }
    catch (e) { toast({ title: 'Could not request the cancellation', description: (e as Error).message, variant: 'error' }); }
    finally { setBusy(false); }
  };
  const req = data.request;
  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Cancellation" subtitle="Cancelling frees the plot and needs approval; the refund is worked out from the sales policy." action={<Ban size={16} className="text-ink-faint" />} />
      {req ? (
        <div className="flex flex-col gap-3">
          <CancellationFacts c={req} />
          <CancellationButtons c={req} canDecide={data.canDecide} approver={data.approver} onDone={refresh} />
          {req.status === 'rejected' && !data.cancelled && <div><Button variant="outline" size="sm" onClick={() => setAsking(true)}>Request again</Button></div>}
        </div>
      ) : data.cancelled ? (
        <p className="text-sm text-ink-muted">This booking is cancelled.</p>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAsking(true)}>Request cancellation</Button>
      )}
      <Modal isOpen={asking} onClose={() => setAsking(false)} title="Request cancellation"
        footer={<><Button variant="outline" onClick={() => setAsking(false)}>Back</Button><Button variant="primary" isLoading={busy} disabled={!reason.trim()} onClick={send}>Send for approval</Button></>}>
        <p className="mb-3 rounded-lg bg-surface-subtle px-3 py-2.5 text-sm text-ink-muted">
          Paid so far <strong className="text-ink">{formatCurrency(data.preview.amountPaid)}</strong>; the policy keeps {data.preview.deductionPercent}% (<strong className="text-ink">{formatCurrency(data.preview.deductionAmount)}</strong>),
          so the refund would be <strong className="text-ink">{formatCurrency(data.preview.refundAmount)}</strong>.
        </p>
        <Textarea label="Why is it being cancelled" id="cancelReason" value={reason} onChange={setReason} />
      </Modal>
    </Card>
  );
}
