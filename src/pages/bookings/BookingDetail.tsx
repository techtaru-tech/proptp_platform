import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, ShieldCheck, Unlock, User, Building2, Wallet, FileText } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { FilePreview } from '../../components/ui/FilePreview';
import { Timeline, type TimelineEntry } from '../../components/ui/Timeline';
import { useAsync } from '../../hooks/useAsync';
import { BuyerConstructionCard } from '../construction/BuyerConstructionCard';
import { LegalFileLink } from '../legal/LegalFileLink';
import { CostSheetCard } from './CostSheetCard';
import { useToast } from '../../context/ToastContext';
import {
  getBookingDetail,
  allowedNextStatuses,
  updateBookingStatus,
  verifyUnitBooking,
  freeUnit,
} from '../../services/bookingService';

import { formatCurrency, formatDate } from '../../utils/format';
import type { BookingStatus } from '../../types';

export function BookingDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmAction, setConfirmAction] = useState<'confirm' | 'verify' | 'free' | null>(null);

  // The booking, its plot, the project name, the derived paid/remaining amounts, every
  // payment row against the same plot and the audit trail all arrive in one request.
  const { data: detail, isLoading, error } = useAsync(() => getBookingDetail(id ?? ''), [id, reloadKey]);

  const booking = detail?.booking;
  const unit = detail?.unit ?? undefined;
  const paymentHistory = detail?.unitBookings ?? [];
  const auditEntries = detail?.audit ?? [];
  const paidAmount = detail?.paidAmount ?? 0;
  const remainingAmount = detail?.remainingAmount ?? 0;

  const timelineEntries: TimelineEntry[] = auditEntries.map((entry) => ({
    id: entry.id,
    title: `${entry.action} — ${entry.userName}`,
    description: entry.description,
    timestamp: entry.timestamp,
    tone: 'info',
  }));

  const handleConfirm = async () => {
    if (!booking || !unit || !confirmAction) return;
    try {
      if (confirmAction === 'confirm') {
        await updateBookingStatus(booking.id, 1, `Status manually changed to "Confirmed" via Booking Detail page.`);
        toast({ title: 'Booking confirmed', description: `Booking ${booking.id} is now confirmed.`, variant: 'success' });
      } else if (confirmAction === 'verify') {
        await verifyUnitBooking(unit.id);
        toast({ title: 'Booking verified', description: `Unit ${unit.propertyNumber} has been verified.`, variant: 'success' });
      } else if (confirmAction === 'free') {
        await freeUnit(unit.id);
        toast({ title: 'Unit released', description: `Unit ${unit.propertyNumber} is now available again.`, variant: 'success' });
      }
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast({ title: 'Unable to complete action', description: err instanceof Error ? err.message : 'Please try again.', variant: 'error' });
    } finally {
      setConfirmAction(null);
    }
  };

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Booking Details" breadcrumb={[{ label: 'Bookings', to: '/bookings' }, { label: id ?? '' }]} />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Booking Details" breadcrumb={[{ label: 'Bookings', to: '/bookings' }, { label: id ?? '' }]} />
        <Card>
          <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
        </Card>
      </div>
    );
  }

  if (!booking) {
    return (
      <div>
        <PageHeader title="Booking Details" breadcrumb={[{ label: 'Bookings', to: '/bookings' }, { label: id ?? '' }]} />
        <Card>
          <EmptyState
            title="Booking not found"
            description="This booking does not exist or may have been removed."
            action={
              <Button variant="outline" onClick={() => navigate('/bookings')}>
                Back to Bookings
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const nextStatuses = allowedNextStatuses(booking.status as BookingStatus);
  const projectId = booking.projectId;

  return (
    <div>
      <PageHeader
        title={`Booking ${booking.reference}`}
        description={`Created ${formatDate(booking.createdAt)} · Last updated ${formatDate(booking.updatedAt)}`}
        breadcrumb={[{ label: 'Bookings', to: '/bookings' }, { label: booking.id }]}
        actions={<StatusBadge kind="booking" status={booking.status} />}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <BuyerConstructionCard bookingId={booking.id} />
        <CostSheetCard bookingId={booking.id} />
        <LegalFileLink bookingId={booking.id} />

        {/* Customer */}
        <Card>
          <CardHeader title="Customer" subtitle="Booking applicant details" action={<User size={16} className="text-ink-faint" />} />
          <dl className="space-y-2.5 text-sm">
            <Row label="Name" value={booking.bookingName} />
            <Row label="Phone" value={booking.phone} />
            <Row label="Aadhaar Number" value={booking.aadhaarNumber ?? '—'} />
          </dl>
        </Card>

        {/* Property */}
        <Card>
          <CardHeader title="Property" subtitle="Project & unit details" action={<Building2 size={16} className="text-ink-faint" />} />
          <dl className="space-y-2.5 text-sm">
            <Row
              label="Project"
              value={
                projectId ? (
                  <Link to={`/projects/${projectId}`} className="font-medium text-brand-600 hover:text-brand-700 focus-ring rounded">
                    {booking.projectName}
                  </Link>
                ) : (
                  '—'
                )
              }
            />
            <Row label="Unit Number" value={unit?.propertyNumber ?? '—'} />
            <Row label="Unit Type" value={unit?.propertyType ?? '—'} />
            <Row label="Unit Status" value={unit ? <StatusBadge kind="unit" status={unit.bookingStatus} /> : '—'} />
            <Row label="Verified" value={unit?.isVerified ? 'Yes' : 'No'} />
          </dl>
        </Card>

        {/* Partner */}
        <Card>
          <CardHeader title="Partner" subtitle="Referring / handling partner" action={<User size={16} className="text-ink-faint" />} />
          <dl className="space-y-2.5 text-sm">
            {booking.userId ? (
              <>
                <Row
                  label="Name"
                  value={
                    <Link to={`/users/${booking.userId}`} className="font-medium text-brand-600 hover:text-brand-700 focus-ring rounded">
                      {detail?.partnerName ?? '—'}
                    </Link>
                  }
                />
                <Row label="Partner ID" value={booking.userId} />
              </>
            ) : (
              <p className="text-sm text-ink-muted">No partner linked to this booking.</p>
            )}
          </dl>
        </Card>

        {/* Payment */}
        <Card>
          <CardHeader title="Payment" subtitle="Amount & payment mode" action={<Wallet size={16} className="text-ink-faint" />} />
          <dl className="space-y-2.5 text-sm">
            <Row label="This Payment" value={formatCurrency(booking.amount)} />
            <Row label="Total Investment" value={unit ? formatCurrency(unit.totalInvestmentAmount) : '—'} />
            <Row label="Paid So Far" value={formatCurrency(paidAmount)} />
            <Row label="Remaining" value={formatCurrency(remainingAmount)} />
            <Row label="Payment Mode" value={<StatusBadge kind="paymentMode" status={booking.paymentMode} dot={false} />} />
            <Row label="Payment Type" value={<StatusBadge kind="depositType" status={booking.isDeposit} dot={false} />} />
          </dl>

          {paymentHistory && paymentHistory.length > 0 && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Payment History</p>
              <div className="space-y-2">
                {paymentHistory.map((b) => (
                  <div key={b.id} className="flex items-center justify-between rounded-lg bg-surface-subtle px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-ink">{b.id}</p>
                      <p className="text-xs text-ink-faint">{formatDate(b.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink">{formatCurrency(b.amount)}</span>
                      <StatusBadge kind="depositType" status={b.isDeposit} dot={false} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Documents */}
        <Card className="lg:col-span-2">
          <CardHeader title="Documents" subtitle="Uploaded KYC & payment documents" action={<FileText size={16} className="text-ink-faint" />} />
          {!booking.aadhaarImage && !booking.aadhaarBack && !booking.chequeImage ? (
            <p className="text-sm text-ink-muted">No documents uploaded for this booking.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {booking.aadhaarImage && <FilePreview label="Aadhaar Card — Front" url={booking.aadhaarImage} sensitive />}
              {booking.aadhaarBack && <FilePreview label="Aadhaar Card — Back" url={booking.aadhaarBack} sensitive />}
              {booking.chequeImage && <FilePreview label="Cheque" url={booking.chequeImage} />}
            </div>
          )}
        </Card>

        {/* Status & actions */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Status"
            subtitle="Current booking status & available actions"
            action={<StatusBadge kind="booking" status={booking.status} />}
          />
          <div className="flex flex-wrap gap-2.5">
            {nextStatuses.includes(1) && (
              <Button variant="primary" leftIcon={<CheckCircle2 size={15} />} onClick={() => setConfirmAction('confirm')}>
                Confirm Booking
              </Button>
            )}
            {unit && !unit.isVerified && unit.bookingStatus !== 0 && (
              <Button variant="outline" leftIcon={<ShieldCheck size={15} />} onClick={() => setConfirmAction('verify')}>
                Verify Booking
              </Button>
            )}
            {unit && unit.bookingStatus !== 0 && (
              <Button variant="danger" leftIcon={<Unlock size={15} />} onClick={() => setConfirmAction('free')}>
                Release Unit
              </Button>
            )}
            {nextStatuses.length === 0 && !(unit && (!unit.isVerified || unit.bookingStatus !== 0)) && (
              <p className="text-sm text-ink-muted">No further actions are available for this booking.</p>
            )}
          </div>
        </Card>

        {/* Audit trail */}
        <Card className="lg:col-span-2">
          <CardHeader title="Audit Trail" subtitle="History of changes made to this booking" />
          {timelineEntries.length === 0 ? (
            <p className="text-sm text-ink-muted">No audit history recorded for this booking yet.</p>
          ) : (
            <Timeline entries={timelineEntries} />
          )}
        </Card>
      </div>

      <ConfirmationDialog
        isOpen={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirm}
        title={
          confirmAction === 'confirm' ? 'Confirm Booking' : confirmAction === 'verify' ? 'Verify Booking' : 'Release Unit'
        }
        description={
          confirmAction === 'confirm'
            ? `This will mark booking ${booking.id} as confirmed.`
            : confirmAction === 'verify'
              ? `This will mark the unit's booking as verified.`
              : `This will release the unit back to Available and clear its booking assignment.`
        }
        confirmLabel="Confirm"
        variant={confirmAction === 'free' ? 'danger' : 'primary'}
        audited
      />
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
