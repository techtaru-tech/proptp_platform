import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { readSheet } from 'read-excel-file/browser';
import { AlertTriangle, Check, CheckCircle2, Download, FileSpreadsheet, Link2, Pause, Pencil, Play, RefreshCw, X } from 'lucide-react';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Card, CardHeader } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { Badge } from '../../../components/ui/Badge';
import { StatCard } from '../../../components/ui/StatCard';
import { Tabs } from '../../../components/ui/Tabs';
import { SearchInput } from '../../../components/ui/SearchInput';
import { ErrorState } from '../../../components/ui/ErrorState';
import { CardSkeleton } from '../../../components/ui/LoadingSkeleton';
import { DataTable, type DataTableColumn } from '../../../components/tables/DataTable';
import { useToast } from '../../../context/ToastContext';
import { DRIP_STATUS_TONE } from '../../../services/whatsappDripService';
import {
  connectCalendly, getBoard, getCampaign, getDashboard, getReviewQueue, importContacts, listContacts, reviewContact,
  runCampaignsNow, setCampaignStatus,
} from '../../../services/waCampaignService';
import { formatDateTime } from '../../../utils/format';
import type { WaBoard, WaCampaign, WaContactRow, WaDashboard, WaImportResult, WaImportRow, WaReviewQueue } from '../../../types';

export function WaCampaignDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [campaign, setCampaign] = useState<WaCampaign | null | undefined>(undefined);
  const [tab, setTab] = useState('dashboard');
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => setCampaign((await getCampaign(id)) ?? null), [id]);
  useEffect(() => {
    void load();
  }, [load, tick]);

  if (campaign === undefined) return <CardSkeleton />;
  if (campaign === null) return <ErrorState title="Campaign not found" description="It may have been deleted." />;

  const flow = campaign.kind === 'flow';
  const refresh = () => setTick((k) => k + 1);

  const toggle = async () => {
    try {
      await setCampaignStatus(campaign.id, campaign.status === 'active' ? 'paused' : 'active');
      refresh();
    } catch (err) {
      toast({ title: 'Could not change status', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    }
  };

  return (
    <div>
      <PageHeader
        title={campaign.name}
        description={flow ? 'Demo journey' : 'One template to a list'}
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'WhatsApp Campaigns', to: '/crm/wa-campaigns' }, { label: campaign.name }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={DRIP_STATUS_TONE[campaign.status]}>{campaign.status}</Badge>
            <Button variant="outline" leftIcon={<RefreshCw size={14} />} onClick={async () => { await runCampaignsNow(); refresh(); toast({ title: 'Checked for due messages', variant: 'success' }); }}>Run now</Button>
            <Button variant="outline" leftIcon={<Pencil size={14} />} onClick={() => navigate(`/crm/wa-campaigns/${campaign.id}/edit`)}>Settings</Button>
            <Button variant="primary" leftIcon={campaign.status === 'active' ? <Pause size={14} /> : <Play size={14} />} onClick={toggle}>{campaign.status === 'active' ? 'Pause' : 'Start'}</Button>
          </div>
        }
      />

      {campaign.lastError && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> Sending is stopped: {campaign.lastError}
        </p>
      )}
      {campaign.warnings.length > 0 && (
        <div className="mb-4 rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          <p className="mb-1 font-medium">Still to set up</p>
          <ul className="list-disc pl-5">{campaign.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: 'dashboard', label: 'Dashboard' },
          { key: 'import', label: 'Import list' },
          ...(flow ? [{ key: 'board', label: 'Board' }, { key: 'review', label: 'Review' }] : []),
          { key: 'people', label: 'People' },
          ...(flow ? [{ key: 'calendly', label: 'Calendly' }] : []),
        ]}
      >
        {(active) => (
          <div className="pt-5">
            {active === 'dashboard' && <DashboardTab id={id} flow={flow} tick={tick} />}
            {active === 'import' && <ImportTab id={id} onDone={refresh} />}
            {active === 'board' && <BoardTab id={id} tick={tick} />}
            {active === 'review' && <ReviewTab id={id} onChanged={refresh} />}
            {active === 'people' && <PeopleTab id={id} tick={tick} />}
            {active === 'calendly' && <CalendlyTab campaign={campaign} onChanged={refresh} />}
          </div>
        )}
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function DashboardTab({ id, flow, tick }: { id: string; flow: boolean; tick: number }) {
  const [d, setD] = useState<WaDashboard | null>(null);
  useEffect(() => {
    void getDashboard(id).then(setD);
  }, [id, tick]);
  if (!d) return <CardSkeleton />;

  const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : '—');
  const funnel: [string, number][] = flow
    ? [['Sent', d.sent], ['Delivered', d.delivered], ['Read', d.read], ['Replied', d.replies], ['Asked for the demo', d.demoRequested], ['Demo sent', d.demoSent], ['Interested', d.interested], ['Labs to review', d.reviewRequired], ['Verified eligible', d.verifiedEligible], ['Booking link sent', d.linkSent], ['Meetings booked', d.meetingsBooked], ['Meetings attended', d.meetingsCompleted]]
    : [['Sent', d.sent], ['Delivered', d.delivered], ['Read', d.read], ['Replied', d.replies]];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="On the list" value={d.imported} />
        <StatCard label="Sent" value={d.sent} tone="info" />
        <StatCard label="Replied" value={d.replies} tone="success" footer={<span className="text-xs text-ink-faint">{pct(d.replies, d.sent)} of sent</span>} />
        <StatCard label="Opted out" value={d.optedOut} tone={d.optedOut > 0 ? 'warning' : 'neutral'} />
        {flow && <StatCard label="Meetings booked" value={d.meetingsBooked} tone="success" />}
        {flow && <StatCard label="Meetings attended" value={d.meetingsCompleted} />}
        {flow && <StatCard label="Hindi / English" value={`${d.hindi} / ${d.english}`} />}
        <StatCard label="Failed" value={d.failed} tone={d.failed > 0 ? 'danger' : 'neutral'} />
      </div>

      <Card>
        <CardHeader title="Funnel" subtitle="Delivered and read are Meta’s own receipts for the first message. “Read” does not mean the video was watched." />
        <div className="space-y-2">
          {funnel.map(([label, n]) => (
            <div key={label} className="flex items-center gap-3 text-sm">
              <span className="w-44 shrink-0 text-ink-muted">{label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-subtle">
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${d.sent > 0 ? Math.min(100, (n / d.sent) * 100) : 0}%` }} />
              </div>
              <span className="w-24 shrink-0 text-right font-medium text-ink">{n} <span className="font-normal text-ink-faint">{pct(n, d.sent)}</span></span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import — an Excel or CSV sheet of name and mobile number
// ---------------------------------------------------------------------------

/** The same rule the server applies: a ten-digit Indian mobile, with or without 91 or a leading 0. */
function validMobile(raw: unknown): boolean {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  return d.length === 10 && /^[6-9]/.test(d);
}

function parseCsv(text: string): string[][] {
  const delimiter = [',', ';', '\t'].map((d) => [d, (text.split('\n')[0] ?? '').split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/** Finds the name and mobile columns by their headers, or by which column holds numbers. */
function toImportRows(grid: unknown[][]): WaImportRow[] {
  if (grid.length === 0) return [];
  const header = grid[0].map((c) => String(c ?? '').trim().toLowerCase());
  const find = (re: RegExp) => header.findIndex((h) => re.test(h));
  let phoneCol = find(/mobile|phone|whatsapp|contact|number|मोबाइल/);
  let nameCol = find(/^(full\s*)?name$|doctor|owner|naam|नाम/);
  const hasHeader = phoneCol >= 0 || nameCol >= 0;
  const body = hasHeader ? grid.slice(1) : grid;
  if (phoneCol < 0) {
    // No header: the column where most cells look like a mobile number.
    const width = Math.max(...grid.map((r) => r.length));
    phoneCol = Array.from({ length: width }, (_, c) => c).sort((a, b) => body.filter((r) => validMobile(r[b])).length - body.filter((r) => validMobile(r[a])).length)[0];
  }
  if (nameCol < 0) nameCol = phoneCol === 0 ? 1 : 0;
  const cityCol = find(/city|शहर/), labCol = find(/lab|centre|center|clinic/);
  return body
    .map((r) => ({
      name: String(r[nameCol] ?? '').trim(), phone: String(r[phoneCol] ?? '').trim(),
      ...(cityCol >= 0 ? { city: String(r[cityCol] ?? '').trim() } : {}), ...(labCol >= 0 ? { labName: String(r[labCol] ?? '').trim() } : {}),
    }))
    .filter((r) => r.name || r.phone);
}

function ImportTab({ id, onDone }: { id: string; onDone: () => void }) {
  const { toast } = useToast();
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<WaImportRow[]>([]);
  const [source, setSource] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WaImportResult | null>(null);

  const valid = useMemo(() => rows.filter((r) => validMobile(r.phone)).length, [rows]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setResult(null);
    try {
      const grid = /\.(xlsx)$/i.test(file.name)
        ? ((await readSheet(file)) as unknown[][])
        : parseCsv(await file.text());
      setRows(toImportRows(grid));
      setFileName(file.name);
    } catch {
      toast({ title: 'Could not read that file', description: 'Use an Excel (.xlsx) or CSV file with a Name and a Mobile column.', variant: 'error' });
    }
  };

  const run = async () => {
    setBusy(true);
    try {
      setResult(await importContacts(id, rows, source.trim()));
      setRows([]);
      setFileName('');
      onDone();
    } catch (err) {
      toast({ title: 'Could not import', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const sample = () => {
    const blob = new Blob(['Name,Mobile\nDr Sharma,9876543210\nDr Mehta,9123456789\n'], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'whatsapp-list-sample.csv';
    a.click();
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Import a list" subtitle="An Excel (.xlsx) or CSV sheet with a Name column and a Mobile column. A City or Lab column is picked up too." action={<Button variant="ghost" size="sm" leftIcon={<Download size={13} />} onClick={sample}>Sample file</Button>} />
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-line-strong px-4 py-5 hover:bg-surface-subtle">
          <FileSpreadsheet size={20} className="text-ink-faint" />
          <span className="text-sm text-ink-muted">{fileName ? `${fileName} — choose another` : 'Choose an Excel or CSV file'}</span>
          <input type="file" accept=".xlsx,.csv,.tsv,.txt" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
        </label>

        {rows.length > 0 && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-ink">
              <strong>{rows.length}</strong> rows read · <strong className="text-success-700">{valid}</strong> valid mobile numbers
              {rows.length - valid > 0 && <> · <strong className="text-danger-600">{rows.length - valid}</strong> will be skipped</>}
            </p>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="bg-surface-subtle text-left text-xs uppercase tracking-wide text-ink-faint"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Mobile</th><th className="px-3 py-2" /></tr></thead>
                <tbody>
                  {rows.slice(0, 8).map((r, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="px-3 py-1.5">{r.name || <span className="text-ink-faint">—</span>}</td>
                      <td className="px-3 py-1.5">{r.phone}</td>
                      <td className="px-3 py-1.5">{validMobile(r.phone) ? <Check size={14} className="text-success-600" /> : <X size={14} className="text-danger-600" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 8 && <p className="border-t border-line px-3 py-1.5 text-xs text-ink-faint">…and {rows.length - 8} more</p>}
            </div>

            <Input label="Where did these people agree to receive WhatsApp messages?" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Website enquiry form, Oct 2026" hint="Required. Kept with each contact as proof of consent." />
            <label className="flex items-start gap-2 text-sm text-ink">
              <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              I confirm these people have agreed to receive WhatsApp messages from us. Anyone who has already said STOP is skipped automatically.
            </label>
            <Button variant="primary" isLoading={busy} disabled={!consent || source.trim().length < 3 || valid === 0 || rows.length > 5000} onClick={run}>
              Add {valid} people to the campaign
            </Button>
            {rows.length > 5000 && <p className="text-sm text-danger-600">That is over 5,000 rows — split the file.</p>}
          </div>
        )}
      </Card>

      {result && (
        <Card>
          <p className="flex items-center gap-2 text-sm font-medium text-success-700"><CheckCircle2 size={16} /> {result.added} people added. They are sent the first message gradually, within your daily limit.</p>
          <ul className="mt-2 text-sm text-ink-muted">
            {result.duplicates > 0 && <li>{result.duplicates} already on the list or repeated in the sheet</li>}
            {result.optedOut > 0 && <li>{result.optedOut} skipped — they had opted out</li>}
            {result.invalid.length > 0 && <li>{result.invalid.length} invalid numbers: {result.invalid.slice(0, 5).map((i) => `row ${i.row} (${i.value || 'empty'})`).join(', ')}{result.invalid.length > 5 ? '…' : ''}</li>}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Board and people
// ---------------------------------------------------------------------------

function BoardTab({ id, tick }: { id: string; tick: number }) {
  const [board, setBoard] = useState<WaBoard | null>(null);
  useEffect(() => {
    void getBoard(id).then(setBoard);
  }, [id, tick]);
  if (!board) return <CardSkeleton />;
  const shown = board.columns.filter((c) => c.total > 0 || ['UGC Sent', 'Demo Requested', 'Demo Sent', 'Interested', 'Eligibility Review', 'Booking Pending', 'Meeting Booked', 'Meeting Completed'].includes(c.name));

  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {shown.map((col) => (
        <div key={col.name} className="w-64 shrink-0 rounded-lg bg-surface-subtle p-2.5">
          <p className="mb-2 flex items-center justify-between text-sm font-medium text-ink">{col.name}<Badge tone="neutral">{col.total}</Badge></p>
          <div className="space-y-2">
            {col.contacts.map((c) => (
              <div key={c.id} className="rounded-md border border-line bg-white p-2.5 text-sm shadow-card">
                <p className="font-medium text-ink">{c.name || c.phone}</p>
                <p className="text-xs text-ink-faint">{c.name ? c.phone : ''}{c.language ? ` · ${c.language === 'hi' ? 'Hindi' : 'English'}` : ''}</p>
              </div>
            ))}
            {col.total > col.contacts.length && <p className="text-center text-xs text-ink-faint">+{col.total - col.contacts.length} more — see People</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function PeopleTab({ id, tick }: { id: string; tick: number }) {
  const [rows, setRows] = useState<WaContactRow[] | null>(null);
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => void listContacts(id, search).then(setRows), 250);
    return () => clearTimeout(t);
  }, [id, search, tick]);

  const columns: DataTableColumn<WaContactRow>[] = [
    { key: 'name', header: 'Person', render: (c) => <div><p className="font-medium text-ink">{c.name || '—'}</p><p className="text-xs text-ink-faint">{c.phone}</p></div> },
    { key: 'stage', header: 'Stage', render: (c) => <Badge tone={c.state === 'OPTED_OUT' || c.state === 'FAILED' ? 'danger' : 'info'}>{c.column}</Badge> },
    { key: 'lang', header: 'Language', render: (c) => (c.language === 'hi' ? 'Hindi' : c.language === 'en' ? 'English' : '—') },
    { key: 'consent', header: 'Consent from', render: (c) => <span className="text-xs text-ink-muted">{c.optInSource}</span> },
    { key: 'updated', header: 'Updated', render: (c) => formatDateTime(c.updatedAt) },
    { key: 'err', header: '', render: (c) => (c.lastError ? <span className="text-xs text-danger-600">{c.lastError}</span> : null) },
  ];
  return (
    <Card padded={false}>
      <div className="flex justify-end border-b border-line p-3"><SearchInput value={search} onChange={setSearch} placeholder="Search name or number…" className="sm:w-72" /></div>
      <DataTable columns={columns} rows={rows ?? []} rowKey={(c) => c.id} isLoading={rows === null} emptyTitle="Nobody here yet" emptyDescription="Import a list to get started." />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Review queue
// ---------------------------------------------------------------------------

const SAMPLES: Record<string, string> = { '50plus': '50 or more a day', below50: 'Under 50 a day', unsure: 'Not sure' };
const PRO: Record<string, string> = { pathologist: 'Pathologist-led', '3yrs': '3+ years running', other: 'Other / unsure' };

function ReviewTab({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [status, setStatus] = useState<'pending' | 'verified' | 'rejected'>('pending');
  const [queue, setQueue] = useState<WaReviewQueue | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    void getReviewQueue(id, status).then(setQueue);
  }, [id, status, n]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-xs"><Select label="Show" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} options={[{ value: 'pending', label: 'Waiting for review' }, { value: 'verified', label: 'Verified eligible' }, { value: 'rejected', label: 'Rejected' }]} /></div>
        {queue && <p className="text-sm text-ink-muted">{queue.slotCap > 0 ? <>Offer slots: <strong className="text-ink">{queue.slotsTaken} of {queue.slotCap}</strong> taken</> : <>{queue.slotsTaken} verified · no slot limit</>}</p>}
      </div>
      <p className="text-xs text-ink-faint">A lab’s own answers are recorded here, but nothing is confirmed until you verify it — check the lab’s details, that it does B2C work, and your own criteria ({queue?.minSamples ?? 50}+ samples a day, and a pathologist-led lab or {queue?.minLabAgeYears ?? 3}+ years running).</p>
      {!queue ? <CardSkeleton /> : queue.contacts.length === 0 ? (
        <Card><p className="text-sm text-ink-faint">Nobody here.</p></Card>
      ) : (
        queue.contacts.map((c) => <ReviewCard key={c.id} c={c} readOnly={status !== 'pending'} onDone={() => { setN((x) => x + 1); onChanged(); }} />)
      )}
    </div>
  );
}

function ReviewCard({ c, readOnly, onDone }: { c: WaContactRow; readOnly: boolean; onDone: () => void }) {
  const { toast } = useToast();
  const [labName, setLabName] = useState(c.labName ?? '');
  const [city, setCity] = useState(c.city ?? '');
  const [age, setAge] = useState(c.labAgeYears ? String(c.labAgeYears) : '');
  const [b2c, setB2c] = useState(c.b2c === undefined ? '' : c.b2c ? 'yes' : 'no');
  const [note, setNote] = useState(c.reviewNote ?? '');
  const [busy, setBusy] = useState(false);

  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    try {
      await reviewContact(c.id, { decision, labName, city, labAgeYears: age ? Number(age) : undefined, b2c: b2c === '' ? undefined : b2c === 'yes', note });
      toast({ title: decision === 'approve' ? 'Verified' : 'Rejected', variant: 'success' });
      onDone();
    } catch (err) {
      toast({ title: 'Could not save', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div><p className="font-medium text-ink">{c.name || c.phone}</p><p className="text-xs text-ink-faint">{c.phone}</p></div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="info">Said: {SAMPLES[c.sampleBand ?? ''] ?? '—'}</Badge>
          <Badge tone="info">Said: {PRO[c.professionalType ?? ''] ?? '—'}</Badge>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Input label="Lab name" value={labName} disabled={readOnly} onChange={(e) => setLabName(e.target.value)} />
        <Input label="City" value={city} disabled={readOnly} onChange={(e) => setCity(e.target.value)} />
        <Input label="Years running" type="number" min={0} value={age} disabled={readOnly} onChange={(e) => setAge(e.target.value)} />
        <Select label="Does B2C work?" value={b2c} disabled={readOnly} onChange={(e) => setB2c(e.target.value)} options={[{ value: '', label: 'Not checked' }, { value: 'yes', label: 'Yes, confirmed' }, { value: 'no', label: 'No' }]} />
        <Input label="Evidence / note" value={note} disabled={readOnly} onChange={(e) => setNote(e.target.value)} placeholder="What you checked" wrapperClassName="sm:col-span-4" />
      </div>
      {!readOnly && (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" isLoading={busy} onClick={() => decide('reject')}>Not eligible</Button>
          <Button variant="primary" isLoading={busy} onClick={() => decide('approve')}>Verify eligible</Button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Calendly
// ---------------------------------------------------------------------------

function CalendlyTab({ campaign, onChanged }: { campaign: WaCampaign; onChanged: () => void }) {
  const { toast } = useToast();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <Card>
      <CardHeader title="Calendly" subtitle="A booking, cancellation or reschedule updates the person here and stops the booking reminders." action={<Badge tone={campaign.calendlyConnected ? 'success' : 'warning'}>{campaign.calendlyConnected ? 'Connected' : 'Not connected'}</Badge>} />
      <div className="space-y-4">
        <Input
          label="Calendly personal access token"
          type="password"
          secret
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={campaign.hasCalendlyToken ? '•••••••• stored — type to replace' : 'Paste the token'}
          hint="From Calendly → Integrations → API & Webhooks. Needs a Calendly plan that supports webhooks. Stored encrypted."
        />
        <Button
          variant="primary"
          leftIcon={<Link2 size={14} />}
          isLoading={busy}
          disabled={!token.trim() && !campaign.hasCalendlyToken}
          onClick={async () => {
            setBusy(true);
            try {
              await connectCalendly(campaign.id, token.trim());
              setToken('');
              toast({ title: 'Calendly connected', description: 'Bookings now reach the CRM.', variant: 'success' });
              onChanged();
            } catch (err) {
              toast({ title: 'Could not connect', description: err instanceof Error ? err.message : undefined, variant: 'error' });
            } finally {
              setBusy(false);
            }
          }}
        >
          {campaign.calendlyConnected ? 'Reconnect' : 'Connect Calendly'}
        </Button>
        <div className="rounded-lg border border-line bg-surface-subtle p-3 text-xs text-ink-muted">
          <p className="mb-1 font-medium text-ink">How it fits together</p>
          <p>Each person’s booking link carries their own id, so Calendly can tell us who booked. The webhook address we register is <code className="break-all">{campaign.calendlyWebhookUrl}</code>. It must be reachable over https.</p>
          {!campaign.calendlyUrl && <p className="mt-1 text-warning-700">Set the Calendly booking link in the campaign settings first.</p>}
        </div>
      </div>
    </Card>
  );
}
