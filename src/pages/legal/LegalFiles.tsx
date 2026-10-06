import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Select } from '../../components/ui/Select';
import { SearchInput } from '../../components/ui/SearchInput';
import { StatCard } from '../../components/ui/StatCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { formatCurrency } from '../../utils/format';
import { STAGES, getOverdue, label, listLegalFiles } from '../../services/legalService';

export function LegalFiles() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [stage, setStage] = useState(params.get('stage') || 'all');
  const [overdue, setOverdue] = useState(params.get('overdue') === '1');
  const [registry, setRegistry] = useState(params.get('registry') || 'all');
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 300);
  const { data, isLoading, error } = useAsync(() => listLegalFiles({ stage, overdue, registry, search: q }), [stage, overdue, registry, q]);
  const od = useAsync(() => getOverdue(), []);

  return (
    <div>
      <PageHeader title="Legal files" description="One file per confirmed booking, opened automatically with the buyer, unit and value carried over." breadcrumb={[{ label: 'Legal & Registry' }, { label: 'Files' }]} />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open files" value={data?.length ?? '…'} tone="brand" />
        <StatCard label="Overdue instalments" value={od.data?.items.length ?? '…'} tone={od.data?.items.length ? 'danger' : 'neutral'} icon={AlertTriangle} onClick={() => setOverdue((v) => !v)} />
        <StatCard label="Overdue amount" value={od.data ? formatCurrency(od.data.total) : '…'} tone="warning" />
        <StatCard label="Registered" value={data?.filter((f) => f.registryStatus === 'registered').length ?? '…'} tone="success" />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search buyer, phone or booking…" />
        <Select aria-label="Agreement stage" name="stageFilter" value={stage} onChange={(e) => setStage(e.target.value)} wrapperClassName="w-48"
          options={[{ value: 'all', label: 'Any agreement stage' }, { value: 'none', label: 'Not started' }, ...STAGES.map((s) => ({ value: s, label: label(s) }))]} />
        <Select aria-label="Registry" name="registryFilter" value={registry} onChange={(e) => setRegistry(e.target.value)} wrapperClassName="w-56"
          options={[{ value: 'all', label: 'Any registry status' }, { value: 'in_progress', label: 'Registry in progress' }, { value: 'possession_pending', label: 'Registered, not handed over' }, { value: 'possessed', label: 'Possession given' }]} />
        <button type="button" aria-pressed={overdue} onClick={() => setOverdue((v) => !v)}
          className={`rounded-lg border px-3 py-1.5 text-sm focus-ring ${overdue ? 'border-danger-600 bg-danger-50 text-danger-700' : 'border-line text-ink-muted'}`}>Overdue only</button>
      </div>
      {error ? <ErrorState title="Could not load legal files" description={error.message} /> : isLoading || !data ? <CardSkeleton /> : data.length === 0 ? (
        <Card><EmptyState title="No legal files" description="A file opens as soon as a booking is confirmed." /></Card>
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-5 py-2.5 font-medium">Buyer</th><th className="px-3 font-medium">Project</th><th className="px-3 font-medium">Agreement</th><th className="px-3 font-medium">Registry</th>
                <th className="px-3 text-right font-medium">Value</th><th className="px-5 text-right font-medium">Outstanding</th></tr></thead>
              <tbody>
                {data.map((f) => (
                  <tr key={f.id} className="cursor-pointer border-t border-line hover:bg-surface-subtle" onClick={() => navigate(`/legal/files/${f.id}`)}>
                    <td className="px-5 py-3"><Link to={`/legal/files/${f.id}`} className="font-medium text-ink hover:text-brand-700" onClick={(e) => e.stopPropagation()}>{f.buyerName}</Link><span className="block text-xs text-ink-muted">{f.phone}</span></td>
                    <td className="px-3 text-ink-muted">{f.projectName}</td>
                    <td className="px-3">{f.agreementStage ? <Badge tone={f.agreementStage === 'stamped' || f.agreementStage === 'executed' ? 'success' : 'info'}>{label(f.agreementStage)}</Badge> : <span className="text-ink-faint">Not started</span>}</td>
                    <td className="px-3"><Badge tone={f.registryStatus === 'registered' ? 'success' : 'neutral'}>{label(f.registryStatus)}</Badge></td>
                    <td className="px-3 text-right tabular-nums">{formatCurrency(f.agreedValue)}</td>
                    <td className="px-5 text-right tabular-nums">{f.hasPlan ? <>{formatCurrency(f.outstanding)}{f.overdueMilestones > 0 && <span className="block text-xs font-medium text-danger-700">{f.overdueMilestones} overdue</span>}</> : <span className="text-ink-faint">No plan</span>}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
