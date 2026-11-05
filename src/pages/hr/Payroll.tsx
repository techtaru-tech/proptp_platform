import { useState, type FormEvent } from 'react';
import { CheckCircle2, IndianRupee, Lock, Play, Printer, Trash2, Wallet } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  buildPayrollRun, deletePayrollRun, getPayrollRun, listPayrollRuns, listSalaryStructures,
  saveSalaryStructure, setPayrollRunStatus,
} from '../../services/hrService';
import { formatCurrency } from '../../utils/format';
import type { PayrollRun, PayrollRunStatus, SalaryStructureRow } from '../../types';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const STATUS_TONE: Record<PayrollRunStatus, 'neutral' | 'info' | 'success'> = {
  draft: 'neutral',
  finalised: 'info',
  paid: 'success',
};

export function Payroll() {
  const [reloadKey, setReloadKey] = useState(0);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SalaryStructureRow | null>(null);
  const [buildOpen, setBuildOpen] = useState(false);

  const { data: runs, isLoading } = useAsync(() => listPayrollRuns(), [reloadKey]);
  const { data: structures } = useAsync(() => listSalaryStructures(), [reloadKey]);

  if (isLoading) return <CardSkeleton />;

  const withoutSalary = (structures ?? []).filter((s) => !s.hasStructure).length;
  const monthlyCost = (structures ?? []).reduce((sum, s) => sum + s.netMonthly, 0);

  return (
    <div>
      <PageHeader
        title="Payroll"
        description="Monthly salary worked out from what each person is paid, the days they attended and the leave they were given."
        breadcrumb={[{ label: 'Payouts / Earnings', to: '/payouts' }, { label: 'Payroll' }]}
        actions={
          <Button variant="primary" leftIcon={<Play size={15} />} onClick={() => setBuildOpen(true)}>
            Run Payroll
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-faint">Staff on payroll</p>
          <p className="mt-1 text-2xl font-semibold text-ink">
            {(structures ?? []).filter((s) => s.hasStructure).length}
            <span className="text-base font-normal text-ink-faint"> / {(structures ?? []).length}</span>
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-faint">Monthly cost, at full attendance</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{formatCurrency(monthlyCost)}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-faint">Runs recorded</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{(runs ?? []).length}</p>
        </Card>
      </div>

      {withoutSalary > 0 && (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          <Wallet size={16} className="mt-0.5 shrink-0" />
          <p>
            {withoutSalary} {withoutSalary === 1 ? 'person has' : 'people have'} no salary saved yet, so they are left
            out of every run. Set one below.
          </p>
        </div>
      )}

      <Card className="mb-5" padded={false}>
        <div className="border-b border-line p-4">
          <p className="text-sm font-medium text-ink">Salary structures</p>
          <p className="text-xs text-ink-muted">What each person earns in a full month, before attendance is applied</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5 font-medium">Employee</th>
                <th className="px-4 py-2.5 text-right font-medium">Basic</th>
                <th className="px-4 py-2.5 text-right font-medium">HRA</th>
                <th className="px-4 py-2.5 text-right font-medium">Other</th>
                <th className="px-4 py-2.5 text-right font-medium">Gross</th>
                <th className="px-4 py-2.5 text-right font-medium">Net</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {(structures ?? []).map((s) => (
                <tr key={s.userId} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-ink">{s.name}</span>
                    <span className="ml-2 text-xs text-ink-faint">{s.role.replace(/_/g, ' ')}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">{s.basic ? formatCurrency(s.basic) : '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">{s.hra ? formatCurrency(s.hra) : '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">{s.otherAllowance ? formatCurrency(s.otherAllowance) : '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium text-ink">
                    {s.hasStructure ? formatCurrency(s.grossMonthly) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                    {s.hasStructure ? formatCurrency(s.netMonthly) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button variant="outline" size="sm" onClick={() => setEditing(s)}>
                      {s.hasStructure ? 'Edit' : 'Set salary'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card padded={false}>
        <div className="border-b border-line p-4">
          <p className="text-sm font-medium text-ink">Runs</p>
          <p className="text-xs text-ink-muted">A draft recalculates every time you rebuild it; finalising locks the figures</p>
        </div>
        {(runs ?? []).length === 0 ? (
          <p className="p-4 text-sm text-ink-faint">No payroll has been run yet.</p>
        ) : (
          <div className="divide-y divide-line">
            {(runs ?? []).map((run) => (
              <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium text-ink">
                    {MONTHS[run.month - 1]} {run.year}
                    <Badge tone={STATUS_TONE[run.status]}>{run.status}</Badge>
                  </p>
                  <p className="text-xs text-ink-muted">
                    {run.employees} {run.employees === 1 ? 'employee' : 'employees'} · gross {formatCurrency(run.grossTotal)} ·
                    net {formatCurrency(run.netTotal)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => setOpenRunId(run.id)}>
                    View payslips
                  </Button>
                  <RunActions run={run} onChanged={() => setReloadKey((k) => k + 1)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {buildOpen && (
        <BuildDialog
          onClose={() => setBuildOpen(false)}
          onBuilt={(id) => {
            setBuildOpen(false);
            setReloadKey((k) => k + 1);
            setOpenRunId(id);
          }}
        />
      )}

      {editing && (
        <SalaryDialog
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}

      {openRunId && <PayslipsDialog runId={openRunId} onClose={() => setOpenRunId(null)} />}
    </div>
  );
}

function RunActions({ run, onChanged }: { run: PayrollRun; onChanged: () => void }) {
  const { toast } = useToast();
  const [confirm, setConfirm] = useState<'finalise' | 'paid' | 'delete' | null>(null);

  const act = async () => {
    try {
      if (confirm === 'delete') await deletePayrollRun(run.id);
      else if (confirm === 'finalise') await setPayrollRunStatus(run.id, 'finalised');
      else if (confirm === 'paid') await setPayrollRunStatus(run.id, 'paid');
      toast({ title: 'Payroll updated', variant: 'success' });
      setConfirm(null);
      onChanged();
    } catch (err) {
      toast({ title: 'Could not update', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    }
  };

  return (
    <>
      {run.status === 'draft' && (
        <>
          <Button variant="outline" size="sm" leftIcon={<Lock size={13} />} onClick={() => setConfirm('finalise')}>
            Finalise
          </Button>
          <Button variant="outline" size="icon" aria-label="Delete draft" onClick={() => setConfirm('delete')}>
            <Trash2 size={14} />
          </Button>
        </>
      )}
      {run.status === 'finalised' && (
        <Button variant="outline" size="sm" leftIcon={<CheckCircle2 size={13} />} onClick={() => setConfirm('paid')}>
          Mark paid
        </Button>
      )}

      <ConfirmationDialog
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={act}
        title={
          confirm === 'delete' ? 'Delete this draft?'
          : confirm === 'finalise' ? 'Finalise this payroll?'
          : 'Mark this payroll as paid?'
        }
        description={
          confirm === 'delete' ? 'The draft and its payslips are removed. It can be rebuilt from scratch.'
          : confirm === 'finalise' ? 'The figures stop following attendance and leave. Corrections made afterwards will not change them.'
          : 'Records that the money has gone out.'
        }
        confirmLabel={confirm === 'delete' ? 'Delete' : 'Confirm'}
        variant={confirm === 'delete' ? 'danger' : 'primary'}
      />
    </>
  );
}

function BuildDialog({ onClose, onBuilt }: { onClose: () => void; onBuilt: (id: string) => void }) {
  const { toast } = useToast();
  const now = new Date();
  // Payroll is nearly always run for the month that just ended.
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [month, setMonth] = useState(previous.getMonth() + 1);
  const [year, setYear] = useState(previous.getFullYear());
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const run = await buildPayrollRun(month, year);
      toast({
        title: `${MONTHS[month - 1]} ${year} built`,
        description: `${run.employees} employees, ${formatCurrency(run.netTotal)} net.`,
        variant: 'success',
      });
      onBuilt(run.id);
    } catch (err) {
      toast({ title: 'Could not build the run', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Run payroll"
      description="Builds a draft from salaries, attendance and approved leave. Nothing is owed until you finalise it."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} isLoading={saving}>
            Build draft
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Month"
            value={String(month)}
            onChange={(e) => setMonth(Number(e.target.value))}
            options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
          />
          <Select
            label="Year"
            value={String(year)}
            onChange={(e) => setYear(Number(e.target.value))}
            options={[now.getFullYear() - 1, now.getFullYear()].map((y) => ({ value: String(y), label: String(y) }))}
          />
        </div>
        <p className="rounded-lg border border-line bg-surface-subtle p-3 text-xs text-ink-muted">
          Working days exclude Sundays. Days with neither attendance nor approved paid leave become loss of pay, charged
          at a day's gross. Building a month that already exists as a draft recalculates it.
        </p>
      </form>
    </Modal>
  );
}

function SalaryDialog({ row, onClose, onSaved }: { row: SalaryStructureRow; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [values, setValues] = useState({
    basic: row.basic,
    hra: row.hra,
    otherAllowance: row.otherAllowance,
    pfDeduction: row.pfDeduction,
    professionalTax: row.professionalTax,
    otherDeduction: row.otherDeduction,
  });
  const [saving, setSaving] = useState(false);

  const gross = values.basic + values.hra + values.otherAllowance;
  const deductions = values.pfDeduction + values.professionalTax + values.otherDeduction;

  const field = (label: string, key: keyof typeof values, hint?: string) => (
    <Input
      label={label}
      type="number"
      min={0}
      value={String(values[key])}
      onChange={(e) => setValues((v) => ({ ...v, [key]: Math.max(0, Number(e.target.value) || 0) }))}
      hint={hint}
    />
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await saveSalaryStructure(row.userId, values);
      toast({ title: `Salary saved for ${row.name}`, variant: 'success' });
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
      title={`Salary — ${row.name}`}
      description="Monthly figures in rupees. Attendance is applied when payroll runs."
      size="lg"
      footer={
        <>
          <span className="mr-auto text-sm text-ink-muted">
            Gross <strong className="text-ink">{formatCurrency(gross)}</strong> · Net{' '}
            <strong className="text-ink">{formatCurrency(gross - deductions)}</strong>
          </span>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} isLoading={saving}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-ink">
            <IndianRupee size={14} /> Earnings
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {field('Basic', 'basic')}
            {field('HRA', 'hra')}
            {field('Other allowance', 'otherAllowance')}
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-ink">Deductions</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {field('PF', 'pfDeduction')}
            {field('Professional tax', 'professionalTax')}
            {field('Other', 'otherDeduction')}
          </div>
        </div>
        <p className="text-xs text-ink-faint">
          Loss of pay is not set here — payroll works it out each month from attendance and leave.
        </p>
      </form>
    </Modal>
  );
}

function PayslipsDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { data: run } = useAsync(() => getPayrollRun(runId), [runId]);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={run ? `Payslips — ${MONTHS[run.month - 1]} ${run.year}` : 'Payslips'}
      description={run ? `${run.employees} employees · net ${formatCurrency(run.netTotal)}` : undefined}
      size="xl"
      footer={
        <>
          <Button variant="outline" leftIcon={<Printer size={14} />} onClick={() => window.print()}>
            Print
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {!run ? (
        <p className="text-sm text-ink-faint">Loading…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line-strong text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="py-2.5 pr-4 font-medium">Employee</th>
                <th className="px-3 py-2.5 text-right font-medium">Days</th>
                <th className="px-3 py-2.5 text-right font-medium">LOP</th>
                <th className="px-3 py-2.5 text-right font-medium">Gross</th>
                <th className="px-3 py-2.5 text-right font-medium">Deductions</th>
                <th className="py-2.5 pl-3 text-right font-medium">Net pay</th>
              </tr>
            </thead>
            <tbody>
              {run.payslips.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="py-2.5 pr-4">
                    <span className="font-medium text-ink">{p.name}</span>
                    <span className="block text-xs text-ink-faint">{p.phone}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">
                    {p.presentDays + p.paidLeaveDays}
                    <span className="text-ink-faint"> / {p.workingDays}</span>
                    {p.paidLeaveDays > 0 && <span className="block text-xs text-ink-faint">{p.paidLeaveDays} on leave</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {p.lopDays > 0 ? <span className="text-danger-600">{p.lopDays}</span> : <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{formatCurrency(p.grossEarnings)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">
                    {formatCurrency(p.totalDeductions)}
                    {p.lopDeduction > 0 && (
                      <span className="block text-xs text-ink-faint">incl. {formatCurrency(p.lopDeduction)} LOP</span>
                    )}
                  </td>
                  <td className="py-2.5 pl-3 text-right font-semibold tabular-nums text-ink">{formatCurrency(p.netPay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
