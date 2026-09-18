import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, FileUp, Upload, AlertTriangle } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { StatCard } from '../../components/ui/StatCard';
import { parseCsv, matchHeader, CSV_TARGET_FIELDS } from '../../utils/csvHeaderMatcher';
import { importLeads, type ImportSummary } from '../../services/leadService';
import { usePipelineReferenceData } from '../../hooks/usePipelineReferenceData';

type WizardStep = 'upload' | 'mapping' | 'done';

const FIELD_LABELS: Record<string, string> = {
  source_id: 'External ID',
  first_name: 'First Name',
  last_name: 'Last Name',
  full_name: 'Full Name',
  email: 'Email',
  phone: 'Phone',
  company: 'Company',
  city: 'City',
  source: 'Source',
  status: 'Status',
  priority: 'Priority',
  deal_value: 'Deal Value',
  assigned: 'Assigned To (name)',
  follow_up: 'Next Follow-up (becomes a task)',
  contacted: 'Last Contacted',
  notes: 'Notes',
};

const SKIP_VALUE = '__skip__';

export function ImportLeads() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<WizardStep>('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const { defaultPipeline, stagesForPipeline } = usePipelineReferenceData();
  const pipeline = defaultPipeline();
  const firstStage = pipeline ? stagesForPipeline(pipeline.id)[0] : undefined;

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const rows = parseCsv(text);
      if (rows.length === 0) return;
      const [headerRow, ...rest] = rows;
      setHeaders(headerRow);
      setDataRows(rest);
      const autoMapping: Record<number, string> = {};
      headerRow.forEach((h, i) => {
        const matched = matchHeader(h);
        if (matched) autoMapping[i] = matched;
      });
      setMapping(autoMapping);
      setFileName(file.name);
      setStep('mapping');
    };
    reader.readAsText(file);
  };

  const onFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const recognizedCount = Object.keys(mapping).length;
  const unmappedCount = headers.length - recognizedCount;

  const handleImport = async () => {
    setIsImporting(true);
    try {
      const rows = dataRows.map((row) => {
        const record: Record<string, string> = {};
        headers.forEach((_, i) => {
          const field = mapping[i];
          if (field && field !== SKIP_VALUE && row[i]) record[field] = row[i];
        });
        return record;
      });
      const result = await importLeads(rows, pipeline?.id, firstStage?.id);
      setSummary(result);
      setStep('done');
    } finally {
      setIsImporting(false);
    }
  };

  const reset = () => {
    setStep('upload');
    setFileName('');
    setHeaders([]);
    setDataRows([]);
    setMapping({});
    setSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div>
      <PageHeader
        title="Import Leads"
        description="Upload a CSV, map its columns to lead fields, and review before importing."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Leads', to: '/crm/leads' }, { label: 'Import' }]}
      />

      <div className="mb-6 flex items-center gap-2">
        {(['upload', 'mapping', 'done'] as WizardStep[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                step === s ? 'bg-brand-600 text-white' : i < ['upload', 'mapping', 'done'].indexOf(step) ? 'bg-success-500 text-white' : 'bg-surface-muted text-ink-faint'
              }`}
            >
              {i + 1}
            </span>
            <span className={`text-sm ${step === s ? 'font-medium text-ink' : 'text-ink-faint'}`}>
              {s === 'upload' ? 'Upload' : s === 'mapping' ? 'Map Columns' : 'Done'}
            </span>
            {i < 2 && <span className="mx-1 h-px w-8 bg-line-strong" />}
          </div>
        ))}
      </div>

      {step === 'upload' && (
        <Card>
          <CardHeader title="Upload a CSV file" subtitle="Column headers will be auto-matched to lead fields where possible." />
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-line-strong px-6 py-14 text-center hover:border-brand-300 hover:bg-surface-subtle"
          >
            <Upload size={28} className="text-ink-faint" />
            <div>
              <p className="text-sm font-medium text-ink">Click to choose a file, or drag it here</p>
              <p className="mt-1 text-xs text-ink-faint">.csv files only</p>
            </div>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFileInputChange} />
          </div>
        </Card>
      )}

      {step === 'mapping' && (
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Map Columns"
              subtitle={`${fileName} · ${dataRows.length} row(s) · ${recognizedCount} column(s) recognized automatically`}
            />
            {unmappedCount > 0 && (
              <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-warning-100 bg-warning-50 px-3.5 py-2.5 text-sm text-warning-700">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <p>{unmappedCount} column(s) could not be auto-matched and will be ignored unless you map them manually below.</p>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {headers.map((header, i) => (
                <div key={i}>
                  <p className="mb-1 truncate text-xs font-medium text-ink-faint" title={header}>
                    {header}
                  </p>
                  <Select
                    value={mapping[i] ?? SKIP_VALUE}
                    onChange={(e) => setMapping((prev) => ({ ...prev, [i]: e.target.value }))}
                    options={[{ value: SKIP_VALUE, label: 'Do not import' }, ...CSV_TARGET_FIELDS.map((f) => ({ value: f, label: FIELD_LABELS[f] ?? f }))]}
                  />
                </div>
              ))}
            </div>
          </Card>

          <Card padded={false}>
            <div className="px-5 pt-5">
              <CardHeader title="Preview" subtitle="First rows as they will be imported, based on the mapping above" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-subtle">
                    {headers.map((_, i) => (
                      <th key={i} className="whitespace-nowrap px-4 py-2 text-left text-xs font-semibold uppercase text-ink-faint">
                        {mapping[i] && mapping[i] !== SKIP_VALUE ? FIELD_LABELS[mapping[i]] ?? mapping[i] : <span className="italic text-ink-faint">ignored</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dataRows.slice(0, 5).map((row, r) => (
                    <tr key={r} className="border-b border-line last:border-0">
                      {headers.map((_, i) => (
                        <td key={i} className={`px-4 py-2 ${mapping[i] && mapping[i] !== SKIP_VALUE ? 'text-ink' : 'text-ink-faint line-through'}`}>
                          {row[i] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="rounded-lg bg-surface-subtle px-4 py-3 text-xs text-ink-faint">
            Leads without a mapped Pipeline/Stage will be placed into <strong>{pipeline?.name ?? '—'} — {firstStage?.name ?? '—'}</strong>{' '}
            by default. Rows matching an existing lead by email or phone will be skipped as duplicates.
          </div>

          <div className="flex justify-end gap-2.5">
            <Button variant="outline" onClick={reset}>
              Start Over
            </Button>
            <Button variant="primary" leftIcon={<FileUp size={15} />} onClick={handleImport} isLoading={isImporting}>
              Import {dataRows.length} Row{dataRows.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && summary && (
        <Card>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success-50 text-success-600">
              <CheckCircle2 size={24} />
            </span>
            <h2 className="text-lg font-semibold text-ink">Import complete</h2>
          </div>
          <div className="mb-6 grid grid-cols-3 gap-4">
            <StatCard label="Imported" value={summary.imported} tone="success" />
            <StatCard label="Duplicates Skipped" value={summary.duplicates} tone="warning" />
            <StatCard label="Rows Skipped" value={summary.skipped} tone="neutral" />
          </div>
          <div className="flex justify-center gap-2.5">
            <Button variant="outline" onClick={reset}>
              Import Another File
            </Button>
            <Button variant="primary" onClick={() => navigate('/crm/leads')}>
              View Leads
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
