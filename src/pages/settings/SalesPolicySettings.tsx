import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Button } from '../../components/ui/Button';
import { Toggle } from '../../components/ui/Toggle';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { DOC_KINDS, label } from '../../services/legalService';
import { getSalesPolicy, saveSalesPolicy, type SalesPolicy } from '../../services/salesPolicyService';

/** The three rules the sales team's money depends on, edited here rather than fixed in code. */
export function SalesPolicySettings() {
  const { toast } = useToast();
  const { data, isLoading, error } = useAsync(() => getSalesPolicy(), []);
  const [f, setF] = useState<SalesPolicy | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setF(data); }, [data]);
  if (error) return <ErrorState title="Could not load the policy" description={error.message} />;
  if (isLoading || !f) return <CardSkeleton />;
  const set = <K extends keyof SalesPolicy>(k: K, v: SalesPolicy[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const num = (k: keyof SalesPolicy) => (e: { target: { value: string } }) => set(k, Number(e.target.value) as never);
  const dirty = JSON.stringify({ ...f, updatedAt: '' }) !== JSON.stringify({ ...data, updatedAt: '' });
  const save = async () => {
    setSaving(true);
    try { const { updatedAt: _u, ...body } = f; setF(await saveSalesPolicy(body)); toast({ title: 'Sales policy saved', variant: 'success' }); }
    catch (e) { toast({ title: 'Could not save', description: (e as Error).message, variant: 'error' }); }
    finally { setSaving(false); }
  };
  const unit = f.penaltyType === 'percent' ? '% of the overdue amount' : '₹ flat';
  const sample = (() => {
    const late = Math.max(0, 40 - f.penaltyGraceDays);
    const periods = f.penaltyPeriod === 'day' ? late : Math.ceil(late / 30);
    const raw = (f.penaltyType === 'percent' ? (100000 * f.penaltyRate) / 100 : f.penaltyRate) * periods;
    const capped = f.penaltyCapPercent > 0 ? Math.min(raw, (100000 * f.penaltyCapPercent) / 100) : raw;
    return Math.round(capped);
  })();

  return (
    <div>
      <PageHeader title="Sales policy" description="Rules the sales and accounts teams work to. Change them here; nothing is fixed in code." breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'Sales policy' }]}
        actions={<Button variant="primary" onClick={save} isLoading={saving} disabled={!dirty}>Save changes</Button>} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Late-payment penalty" subtitle="Charged on an overdue instalment, simple (not compounding)." />
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Select label="Charged as" name="penaltyType" value={f.penaltyType} onChange={(e) => set('penaltyType', e.target.value as SalesPolicy['penaltyType'])} options={[{ value: 'percent', label: 'A percentage' }, { value: 'fixed', label: 'A flat amount (₹)' }]} />
              <Select label="For every" name="penaltyPeriod" value={f.penaltyPeriod} onChange={(e) => set('penaltyPeriod', e.target.value as SalesPolicy['penaltyPeriod'])} options={[{ value: 'day', label: 'Day late' }, { value: 'month', label: 'Month late' }]} />
            </div>
            <Input label={`Rate (${unit})`} name="penaltyRate" type="number" min={0} step="any" value={f.penaltyRate} onChange={num('penaltyRate')} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Grace days" name="penaltyGraceDays" type="number" min={0} value={f.penaltyGraceDays} onChange={num('penaltyGraceDays')} hint="No penalty until this many days after the due date." />
              <Input label="Cap (% of the instalment)" name="penaltyCapPercent" type="number" min={0} max={100} step="any" value={f.penaltyCapPercent} onChange={num('penaltyCapPercent')} hint="0 means no cap." />
            </div>
            <p className="rounded-lg bg-surface-subtle px-3 py-2.5 text-xs text-ink-muted">Example: ₹1,00,000 still unpaid 40 days after its due date would carry a penalty of <strong className="text-ink">₹{sample.toLocaleString('en-IN')}</strong>.</p>
          </div>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Required documents" subtitle="What every buyer's legal file must hold, verified, before it counts as complete." />
            <div className="grid grid-cols-2 gap-2">
              {DOC_KINDS.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" className="h-4 w-4 rounded border-line-strong focus-ring" checked={f.requiredDocKinds.includes(k)}
                    onChange={(e) => set('requiredDocKinds', e.target.checked ? [...f.requiredDocKinds, k] : f.requiredDocKinds.filter((x) => x !== k))} />
                  {label(k)}
                </label>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Booking cancellation and refund" subtitle="What is kept when a booking is cancelled, and who decides." />
            <div className="flex flex-col gap-4">
              <Input label="Amount kept (% of what the buyer paid)" name="refundDeductionPercent" type="number" min={0} max={100} step="any" value={f.refundDeductionPercent} onChange={num('refundDeductionPercent')} hint="The rest is refunded." />
              <Select label="Who approves a refund" name="refundApprover" value={f.refundApprover} onChange={(e) => set('refundApprover', e.target.value as SalesPolicy['refundApprover'])}
                options={[{ value: 'admin', label: 'A full-access administrator' }, { value: 'leader', label: 'A Leader' }, { value: 'accounts', label: 'Anyone with Payments access (accounts)' }]}
                hint="Whoever raised the request cannot approve it themselves, unless they have full access." />
            </div>
          </Card>
          <Card>
            <CardHeader title="Plot stages" subtitle="How the plot status flow reads a booking that is still waiting to be verified." />
            <Toggle label="Show “Token” before “Booked”" checked={f.showTokenStage} onChange={(v) => set('showTokenStage', v)}
              description="On: a booking with money taken but not yet verified shows as Token, and becomes Booked once confirmed. Off: it shows as Booked straight away." />
          </Card>
        </div>
      </div>
    </div>
  );
}
