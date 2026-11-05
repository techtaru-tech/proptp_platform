import { useState } from 'react';
import { CalendarCheck, Clock, Home, RefreshCw, UserPlus } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { getDemoDataStatus, refreshDemoData, rotateDemoData, type DemoRefreshResult } from '../../services/settingsService';
import { formatRelativeTime } from '../../utils/format';

const WHAT_HAPPENS = [
  { icon: Clock, text: 'Every date in the panel moves forward together, so the newest lead is from right now and nothing loses its place.' },
  { icon: UserPlus, text: 'Eight new leads arrive across the last few hours — the first one two minutes ago.' },
  { icon: Home, text: 'The two latest bookings are made today.' },
  { icon: CalendarCheck, text: 'Site visits are scheduled for later today and tomorrow; tasks and follow-ups fill the coming weeks.' },
];

export function DemoDataSettings() {
  const { toast } = useToast();
  const [reload, setReload] = useState(0);
  const { data: status, isLoading } = useAsync(() => getDemoDataStatus(), [reload]);
  const [rotating, setRotating] = useState(false);

  const handleRotate = async () => {
    setRotating(true);
    try {
      const res = await rotateDemoData();
      toast({ title: 'New demo batch added', description: `${res.summary.leads} leads, ${res.summary.calls} calls, ${res.summary.siteVisits} site visits and more.`, variant: 'success' });
      setReload((r) => r + 1);
    } catch (err) {
      toast({ title: 'Could not rotate demo data', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setRotating(false);
    }
  };
  const rotation = status?.rotation;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DemoRefreshResult | null>(null);

  const handleRefresh = async () => {
    setConfirmOpen(false);
    setRunning(true);
    try {
      const res = await refreshDemoData();
      setResult(res);
      toast({ title: 'Demo data refreshed', description: 'Everything now reads as today.', variant: 'success' });
    } catch (err) {
      toast({ title: 'Could not refresh demo data', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <PageHeader title="Demo Data" description="Bring the demo up to today before showing it to a client." />

      <Card>
        <CardHeader
          title="Refresh for a client demo"
          subtitle="Run this just before the meeting. It takes a few seconds."
          action={
            <Button
              leftIcon={<RefreshCw className="h-4 w-4" />}
              isLoading={running}
              disabled={isLoading || !status?.enabled}
              onClick={() => setConfirmOpen(true)}
            >
              Refresh demo data
            </Button>
          }
        />
        {!isLoading && !status?.enabled && (
          <p className="mb-4 rounded-lg bg-surface-muted px-3 py-2 text-sm text-ink-muted">
            Demo tools are switched off on this server. They are only for the demo panel (DEMO_TOOLS=true).
          </p>
        )}
        <ul className="space-y-3">
          {WHAT_HAPPENS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 text-sm text-ink">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </Card>

      {result && (
        <Card className="mt-4">
          <CardHeader title="Done" subtitle={`Dates moved forward by ${result.shiftedByHours} hours across ${result.tables} tables.`} />
          <ul className="space-y-1 text-sm text-ink">
            <li>New leads today: {result.freshLeads.join(', ') || 'none'}</li>
            <li>Bookings made today: {result.freshBookings}</li>
            <li>Site visits later today: {result.visitsToday}</li>
          </ul>
        </Card>
      )}

      {status?.enabled && (
        <Card className="mt-4">
          <CardHeader
            title={`Automatic refresh every ${rotation?.everyHours ?? 6} hours`}
            subtitle="The last batch of demo records is removed, every date moves up to now, and a new batch arrives — so every section always has fresh activity."
            action={<Button variant="outline" leftIcon={<RefreshCw className="h-4 w-4" />} isLoading={rotating} onClick={handleRotate}>Rotate now</Button>}
          />
          <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 [&>div]:bg-surface [&>div]:px-3 [&>div]:py-2.5">
            <div><dt className="text-xs text-ink-subtle">Last run</dt><dd className="mt-0.5 text-[13px] font-medium text-ink">{rotation?.lastRunAt ? formatRelativeTime(rotation.lastRunAt) : 'Not yet'}</dd></div>
            <div><dt className="text-xs text-ink-subtle">Next run</dt><dd className="mt-0.5 text-[13px] font-medium text-ink">{rotation?.nextRunAt ? new Date(rotation.nextRunAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Within 10 minutes'}</dd></div>
            <div><dt className="text-xs text-ink-subtle">Last batch</dt><dd className="mt-0.5 text-[13px] text-ink">{rotation?.lastSummary ? Object.entries(rotation.lastSummary).map(([k, v]) => `${v} ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}`).join(' · ') : '—'}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-ink-subtle">Bookings and payments are not invented — the existing ones move to current dates, so ledgers, commissions and unit status stay consistent.</p>
        </Card>
      )}

      <ConfirmationDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleRefresh}
        title="Refresh demo data?"
        description="Every date in this panel moves forward to today. Use this only on the demo panel."
        confirmLabel="Refresh"
      />
    </div>
  );
}
