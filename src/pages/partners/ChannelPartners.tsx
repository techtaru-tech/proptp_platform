import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { KYC_LABEL, listPartners } from '../../services/channelPartnerService';

export function ChannelPartners() {
  const { data, error } = useAsync(() => listPartners(), []);
  return (
    <div>
      <PageHeader title="Channel partners" description="The agents who bring buyers: their projects, protected leads, brokerage and disputes." breadcrumb={[{ label: 'Partners / Users' }, { label: 'Channel partners' }]} />
      {error ? <ErrorState title="Could not load partners" description={error.message} /> : !data ? <CardSkeleton /> : data.length === 0 ? (
        <Card><EmptyState title="No channel partners yet" description="Agents appear here once they join." /></Card>
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-faint">
              <th className="px-5 py-2.5 font-medium">Partner</th><th className="px-3 font-medium">KYC</th><th className="px-3 font-medium">Projects</th>
              <th className="px-3 text-right font-medium">Leads</th><th className="px-3 text-right font-medium">Bookings</th><th className="px-3 font-medium">Portal login</th><th className="px-5 font-medium">Disputes</th></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.id} className="border-t border-line hover:bg-surface-subtle">
                <td className="px-5 py-3"><Link to={`/channel-partners/${p.id}`} className="font-medium text-ink hover:text-brand-700">{p.name}</Link><span className="block text-xs text-ink-muted">{p.partnerCode} · {p.phone}</span></td>
                <td className="px-3"><Badge tone={p.kycStatus === 1 ? 'success' : p.kycStatus === 2 ? 'danger' : 'warning'}>{KYC_LABEL[p.kycStatus]}</Badge></td>
                <td className="px-3 text-ink-muted">{p.authorisedProjectIds.length ? `${p.authorisedProjectIds.length} authorised` : 'Not restricted'}</td>
                <td className="px-3 text-right tabular-nums">{p.leads}</td><td className="px-3 text-right tabular-nums">{p.bookings}</td>
                <td className="px-3">{p.hasLogin ? <Badge tone="success" dot>Has login</Badge> : <span className="text-ink-faint">None</span>}</td>
                <td className="px-5">{p.openDisputes > 0 ? <Badge tone="danger">{p.openDisputes} open</Badge> : <span className="text-ink-faint">—</span>}</td>
              </tr>))}</tbody>
          </table></div>
        </Card>
      )}
    </div>
  );
}
