import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Toggle } from '../../components/ui/Toggle';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  createLeaveType, deleteLeaveType, listLeaveBalances, listLeaveTypes, setLeaveAllocation,
  updateLeaveType, type LeaveTypeInput,
} from '../../services/hrService';
import type { LeaveType } from '../../types';

const YEARS = [new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1];

export function LeaveSettings() {
  const [reloadKey, setReloadKey] = useState(0);
  const [year, setYear] = useState(new Date().getFullYear());
  const { data: types, isLoading } = useAsync(() => listLeaveTypes(), [reloadKey]);
  const { data: staff } = useAsync(() => listLeaveBalances(year), [year, reloadKey]);
  const [editing, setEditing] = useState<LeaveType | 'new' | null>(null);

  if (isLoading) return <CardSkeleton />;

  return (
    <div>
      <PageHeader
        title="Leave Types & Balances"
        description="What kinds of leave exist, how many days each person gets, and what is left."
        breadcrumb={[{ label: 'Attendance', to: '/attendance/today' }, { label: 'Leave Types' }]}
        actions={
          <Button variant="primary" leftIcon={<Plus size={15} />} onClick={() => setEditing('new')}>
            Add Leave Type
          </Button>
        }
      />

      <Card className="mb-5">
        <CardHeader title="Leave types" subtitle="Unpaid leave still needs approving — it just costs a day's salary" />
        {(types ?? []).length === 0 ? (
          <p className="text-sm text-ink-faint">
            None yet. Most companies start with Casual, Sick, Earned and Unpaid.
          </p>
        ) : (
          <div className="space-y-2">
            {(types ?? []).map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium text-ink">
                    {t.name}
                    <Badge tone="neutral">{t.code}</Badge>
                    {!t.isPaid && <Badge tone="warning">unpaid</Badge>}
                    {!t.active && <Badge tone="neutral">off</Badge>}
                  </p>
                  <p className="text-xs text-ink-faint">
                    {t.annualQuota > 0 ? `${t.annualQuota} days a year` : 'No annual quota'}
                    {t.carryForward && ' · carries forward'}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Button variant="outline" size="icon" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}>
                    <Pencil size={14} />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`Delete ${t.name}`}
                    onClick={async () => {
                      const result = await deleteLeaveType(t.id);
                      setReloadKey((k) => k + 1);
                      if (result.deactivated) alert(result.message);
                    }}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-3">
          <div>
            <p className="text-sm font-medium text-ink">Balances</p>
            <p className="text-xs text-ink-muted">Counted from approved requests, never from a running total</p>
          </div>
          <Select
            aria-label="Year"
            value={String(year)}
            onChange={(e) => setYear(Number(e.target.value))}
            options={YEARS.map((y) => ({ value: String(y), label: String(y) }))}
            wrapperClassName="w-32"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5 font-medium">Employee</th>
                {(types ?? []).filter((t) => t.active).map((t) => (
                  <th key={t.id} className="px-4 py-2.5 text-right font-medium">
                    {t.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(staff ?? []).map((row) => (
                <tr key={row.userId} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 font-medium text-ink">{row.name}</td>
                  {(types ?? []).filter((t) => t.active).map((t) => {
                    const b = row.balances.find((x) => x.leaveTypeId === t.id);
                    return (
                      <td key={t.id} className="px-4 py-2.5 text-right tabular-nums">
                        <button
                          className="rounded px-1.5 py-0.5 hover:bg-surface-subtle focus-ring"
                          title="Click to change this person's allocation"
                          onClick={async () => {
                            const next = window.prompt(`${row.name} — ${t.name} days for ${year}`, String(b?.allocated ?? 0));
                            if (next === null) return;
                            await setLeaveAllocation({ userId: row.userId, leaveTypeId: t.id, year, allocated: Number(next) || 0 });
                            setReloadKey((k) => k + 1);
                          }}
                        >
                          <span className="text-ink">{b ? b.remaining : 0}</span>
                          <span className="text-ink-faint"> / {b?.allocated ?? 0}</span>
                          {b && b.pending > 0 && <span className="ml-1 text-warning-600">+{b.pending}</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4 py-2.5 text-xs text-ink-faint">
          Shown as remaining / allocated. An amber figure is days requested but not yet decided. Click any cell to
          change that person's allocation — a mid-year joiner does not get the full year.
        </p>
      </Card>

      {editing && (
        <TypeDialog
          type={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function TypeDialog({ type, onClose, onSaved }: { type: LeaveType | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [values, setValues] = useState<LeaveTypeInput>({
    name: type?.name ?? '',
    code: type?.code ?? '',
    annualQuota: type?.annualQuota ?? 12,
    isPaid: type?.isPaid ?? true,
    carryForward: type?.carryForward ?? false,
    active: type?.active ?? true,
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (type) await updateLeaveType(type.id, values);
      else await createLeaveType(values);
      toast({ title: type ? 'Leave type updated' : 'Leave type added', variant: 'success' });
      onSaved();
    } catch (err) {
      toast({ title: 'Could not save', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={type ? 'Edit leave type' : 'Add leave type'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} isLoading={saving}>
            {type ? 'Save changes' : 'Add'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Name" required value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} placeholder="Casual Leave" />
          <Input
            label="Short code"
            required
            value={values.code}
            onChange={(e) => setValues((v) => ({ ...v, code: e.target.value.toUpperCase() }))}
            placeholder="CL"
            hint="Shown on balance tables and payslips."
          />
        </div>
        <Input
          label="Days per year"
          type="number"
          min={0}
          step="0.5"
          value={String(values.annualQuota)}
          onChange={(e) => setValues((v) => ({ ...v, annualQuota: Number(e.target.value) || 0 }))}
          hint="Zero means no quota — right for unpaid leave, which is tracked but never runs out."
        />
        <Toggle
          label="Paid"
          description="Unpaid leave still needs approving; it just comes off the salary as loss of pay."
          checked={values.isPaid}
          onChange={(isPaid) => setValues((v) => ({ ...v, isPaid }))}
        />
        <Toggle
          label="Carries forward"
          description="An unused balance survives into next year."
          checked={values.carryForward}
          onChange={(carryForward) => setValues((v) => ({ ...v, carryForward }))}
        />
        <Toggle
          label="Active"
          description="An inactive type stays on old records but cannot be chosen again."
          checked={values.active}
          onChange={(active) => setValues((v) => ({ ...v, active }))}
        />
      </form>
    </Modal>
  );
}
