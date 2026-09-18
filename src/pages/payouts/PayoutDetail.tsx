import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, XCircle, Banknote, ShieldCheck, Send } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Modal } from '../../components/ui/Modal';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { Timeline, type TimelineEntry } from '../../components/ui/Timeline';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { getPayout, confirmPayout, releasePayout, rejectPayout } from '../../services/payoutService';
import { roleLabel } from '../../services/userService';
import { formatCurrency, formatDate } from '../../utils/format';

export function PayoutDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmingRelease, setConfirmingRelease] = useState(false);
  const [confirmingConfirm, setConfirmingConfirm] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const { data: payout, isLoading, error } = useAsync(() => getPayout(id ?? ''), [id, reloadKey]);

  const handleConfirmPayout = async () => {
    if (!payout) return;
    await confirmPayout(payout.id);
    toast({ title: 'Payout confirmed', description: `Payout ${payout.id} is now confirmed, awaiting release.`, variant: 'success' });
    setReloadKey((k) => k + 1);
  };

  const handleRelease = async () => {
    if (!payout) return;
    const { error: releaseError } = await releasePayout(payout.id);
    if (releaseError) {
      toast({ title: 'Unable to release payout', description: releaseError, variant: 'error' });
      return;
    }
    toast({ title: 'Payout released', description: `Payout ${payout.id} has been released and the wallet debited.`, variant: 'success' });
    setReloadKey((k) => k + 1);
  };

  const handleReject = async () => {
    if (!payout || !rejectReason.trim()) return;
    await rejectPayout(payout.id, rejectReason.trim());
    toast({ title: 'Payout rejected', description: `Payout ${payout.id} has been rejected.`, variant: 'success' });
    setRejectOpen(false);
    setRejectReason('');
    setReloadKey((k) => k + 1);
  };

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Payout Details" breadcrumb={[{ label: 'Payouts', to: '/payouts' }, { label: id ?? '' }]} />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  if (error || !payout) {
    return (
      <div>
        <PageHeader title="Payout Details" breadcrumb={[{ label: 'Payouts', to: '/payouts' }, { label: id ?? '' }]} />
        <Card>
          {error ? (
            <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
          ) : (
            <EmptyState
              title="Payout not found"
              description="This payout request does not exist."
              action={
                <Button variant="outline" onClick={() => navigate('/payouts')}>
                  Back to Payouts
                </Button>
              }
            />
          )}
        </Card>
      </div>
    );
  }

  const timelineEntries: TimelineEntry[] = payout.statusHistory.map((h, i) => ({
    id: `${payout.id}-h${i}`,
    title: h.status.charAt(0).toUpperCase() + h.status.slice(1),
    description: h.note,
    timestamp: h.timestamp,
    tone: h.status === 'released' ? 'success' : h.status === 'rejected' || h.status === 'failed' ? 'danger' : h.status === 'confirmed' ? 'info' : 'neutral',
  }));

  return (
    <div>
      <PageHeader
        title={`Payout ${payout.id}`}
        description={`Requested by ${payout.userName} on ${formatDate(payout.requestDate)}`}
        breadcrumb={[{ label: 'Payouts', to: '/payouts' }, { label: payout.id }]}
        actions={<StatusBadge kind="payout" status={payout.status} />}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="User" subtitle="Requesting partner" />
          <dl className="space-y-2.5 text-sm">
            <Row label="Name" value={payout.userName} />
            <Row label="Role" value={roleLabel(payout.role)} />
            <Row label="Payout method" value={payout.isAutomaticMethod ? 'Automatic gateway' : 'Manual'} />
          </dl>
        </Card>

        <Card>
          <CardHeader title="Bank Details" subtitle="Protected — sensitive fields are masked" action={<ShieldCheck size={16} className="text-ink-faint" />} />
          <dl className="space-y-2.5 text-sm">
            <Row label="Account Number" value={<span className="font-mono">{payout.bankAccountMasked}</span>} />
            <Row label="IFSC" value={<span className="font-mono">{payout.bankIfsc}</span>} />
          </dl>
        </Card>

        <Card>
          <CardHeader title="Amount Breakdown" subtitle="Referral bonus + commission" action={<Banknote size={16} className="text-ink-faint" />} />
          <dl className="space-y-2.5 text-sm">
            <Row label="Referral Bonus" value={formatCurrency(payout.referralBonus)} />
            <Row label="Commission" value={formatCurrency(payout.commission)} />
            <Row label="Total Amount" value={<span className="text-base font-semibold text-ink">{formatCurrency(payout.amount)}</span>} />
            {payout.lastError && <Row label="Last Gateway Error" value={<span className="text-danger-600">{payout.lastError}</span>} />}
          </dl>
        </Card>

        <Card>
          <CardHeader title="Status & Actions" subtitle="Confirm → Release is a genuine two-step process in the real system" />
          {payout.status === 'pending' && (
            <div className="flex flex-wrap gap-2.5">
              <Button variant="primary" leftIcon={<CheckCircle2 size={15} />} onClick={() => setConfirmingConfirm(true)}>
                Confirm Payout
              </Button>
              <Button variant="danger" leftIcon={<XCircle size={15} />} onClick={() => setRejectOpen(true)}>
                Reject Payout
              </Button>
            </div>
          )}
          {payout.status === 'confirmed' && (
            <Button variant="primary" leftIcon={<Send size={15} />} onClick={() => setConfirmingRelease(true)}>
              Release Payout
            </Button>
          )}
          {(payout.status === 'released' || payout.status === 'rejected' || payout.status === 'failed') && (
            <p className="text-sm text-ink-muted">No further status transitions are available for this payout.</p>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Transaction / Status History" subtitle="Full history of this payout request" />
          <Timeline entries={timelineEntries} />
        </Card>
      </div>

      <ConfirmationDialog
        isOpen={confirmingConfirm}
        onClose={() => setConfirmingConfirm(false)}
        onConfirm={handleConfirmPayout}
        title="Confirm Payout"
        description={`This will confirm payout ${payout.id}, making it ready for release.`}
        confirmLabel="Confirm"
        audited
      />

      <ConfirmationDialog
        isOpen={confirmingRelease}
        onClose={() => setConfirmingRelease(false)}
        onConfirm={handleRelease}
        title="Release Payout"
        description={`This will debit ${formatCurrency(payout.amount)} from ${payout.userName}'s wallet and mark the payout as released. Blocked if the wallet balance is insufficient.`}
        confirmLabel="Release"
        audited
      />

      <Modal
        isOpen={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Reject Payout"
        description="A reason is required, matching the real admin's rejection flow."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleReject} disabled={!rejectReason.trim()}>
              Reject
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="payout-reject-reason" className="text-sm font-medium text-ink">
            Reason<span className="text-accent-600"> *</span>
          </label>
          <textarea
            id="payout-reject-reason"
            rows={3}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="e.g. Insufficient supporting documents"
            className="w-full rounded-lg border border-line-strong bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors hover:border-ink-faint focus-ring"
          />
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}
