import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { listCancellations } from '../../services/salesPolicyService';
import { CancellationButtons, CancellationFacts } from './CancellationActions';

const TABS = [{ key: 'pending', label: 'Waiting for approval' }, { key: 'approved', label: 'Approved' }, { key: 'rejected', label: 'Rejected' }];

export function Cancellations() {
  const [tab, setTab] = useState('pending');
  const [reload, setReload] = useState(0);
  const { data, isLoading, error } = useAsync(() => listCancellations(tab), [tab, reload]);
  return (
    <div>
      <PageHeader title="Booking cancellations" description="Requests to cancel a booking, with the refund worked out from the sales policy." breadcrumb={[{ label: 'Bookings', to: '/bookings' }, { label: 'Cancellations' }]} />
      <div className="mb-4 flex gap-2" role="tablist">
        {TABS.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`rounded-lg border px-3 py-1.5 text-sm focus-ring ${tab === t.key ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line text-ink-muted'}`}>{t.label}</button>)}
      </div>
      {error ? <ErrorState title="Could not load requests" description={error.message} /> : isLoading || !data ? <CardSkeleton /> : data.items.length === 0 ? (
        <Card><EmptyState icon={Ban} title={tab === 'pending' ? 'Nothing waiting' : 'Nothing here'} /></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {data.items.map((c) => (
            <Card key={c.id}>
              <p className="mb-2 font-semibold text-ink"><Link to={`/bookings/${c.bookingId}`} className="hover:text-brand-700">{c.buyerName}</Link> <span className="font-normal text-ink-muted">· {c.projectName} · plot {c.unit} · {c.reference}</span></p>
              <CancellationFacts c={c} />
              <div className="mt-3"><CancellationButtons c={c} canDecide={data.canDecide} approver={data.approver} onDone={() => setReload((k) => k + 1)} /></div>
            </Card>))}
        </div>)}
    </div>
  );
}
