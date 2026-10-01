import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileDown, FileSpreadsheet } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { StatCard } from '../../components/ui/StatCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { getMaterialLookups } from '../../services/vendorService';
import { downloadExcel, downloadPdf, getCatalogue, getProjectReport } from '../../services/projectReportService';

const isNumeric = (v: unknown) => typeof v === 'number';

/** Renders any report from the server's one definition: summary figures, then each table. */
export function ProjectReportPage() {
  const { key = '' } = useParams();
  const { toast } = useToast();
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);
  const cat = useAsync(() => getCatalogue(), []);
  const lookups = useAsync(() => getMaterialLookups(), []);
  const { data, isLoading, error } = useAsync(() => getProjectReport(key, projectId || undefined), [key, projectId]);
  const entry = cat.data?.find((c) => c.key === key);

  const run = async (kind: 'xlsx' | 'pdf') => {
    setBusy(kind);
    try {
      if (kind === 'xlsx') await downloadExcel(key, projectId || undefined);
      else if (data) downloadPdf(data, lookups.data?.projects.find((p) => p.id === projectId)?.projectName);
    } catch (e) {
      toast({ title: 'Could not export', description: (e as Error).message, variant: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title={data?.title ?? entry?.title ?? 'Report'}
        description={data?.description ?? entry?.description}
        breadcrumb={[{ label: 'Reports', to: '/reports' }, { label: entry?.title ?? 'Report' }]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" leftIcon={<FileSpreadsheet size={15} />} onClick={() => run('xlsx')} isLoading={busy === 'xlsx'} disabled={!data}>Excel</Button>
            <Button variant="outline" leftIcon={<FileDown size={15} />} onClick={() => run('pdf')} isLoading={busy === 'pdf'} disabled={!data}>PDF</Button>
          </div>
        }
      />
      {entry?.takesProject && (
        <div className="mb-4">
          <Select aria-label="Project" name="reportProject" value={projectId} onChange={(e) => setProjectId(e.target.value)} wrapperClassName="w-64"
            options={[{ value: '', label: 'All projects' }, ...(lookups.data?.projects ?? []).map((p) => ({ value: p.id, label: p.projectName }))]} />
        </div>
      )}
      {error ? <ErrorState title="Could not build this report" description={error.message} /> : isLoading || !data ? <CardSkeleton /> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {data.summary.map((s) => <StatCard key={s.label} label={s.label} value={s.value} tone="brand" />)}
          </div>
          <div className="flex flex-col gap-5">
            {data.tables.map((t) => (
              <Card key={t.title} padded={false}>
                <h3 className="border-b border-line px-5 py-3 font-semibold text-ink">{t.title} <span className="font-normal text-ink-faint">· {t.rows.length}</span></h3>
                {t.rows.length === 0 ? <EmptyState title="Nothing to show" /> : (
                  <div className="max-h-[28rem] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-white"><tr className="text-left text-xs uppercase tracking-wide text-ink-faint">{t.columns.map((c, i) => <th key={c} className={`px-4 py-2 font-medium ${i === 0 ? 'pl-5' : ''}`}>{c}</th>)}</tr></thead>
                      <tbody>{t.rows.map((r, ri) => (
                        <tr key={ri} className="border-t border-line">{r.map((c, ci) => (
                          <td key={ci} className={`px-4 py-2 ${ci === 0 ? 'pl-5 font-medium text-ink' : 'text-ink'} ${isNumeric(c) ? 'tabular-nums' : ''}`}>
                            {t.money?.includes(ci) && isNumeric(c) ? `₹${(c as number).toLocaleString('en-IN')}` : String(c)}
                          </td>))}</tr>))}</tbody>
                    </table>
                  </div>)}
              </Card>))}
          </div>
        </>)}
    </div>
  );
}
