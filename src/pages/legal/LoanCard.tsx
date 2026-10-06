import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../context/ToastContext';
import { formatCurrency, formatDate } from '../../utils/format';
import { addDisbursement, label, removeDisbursement, removeLoan, saveLoan, type Loan } from '../../services/legalService';

const TONE = { applied: 'warning', sanctioned: 'info', partly_disbursed: 'info', disbursed: 'success', rejected: 'danger' } as const;
const today = () => new Date().toISOString().slice(0, 10);

/** The buyer's bank loan: where it stands with the bank and what has been paid out. */
export function LoanCard({ fileId, loan, onChanged }: { fileId: string; loan: Loan | null; onChanged: () => void }) {
  const { toast } = useToast();
  const [dialog, setDialog] = useState<null | 'loan' | 'pay'>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast({ title: ok, variant: 'success' }); onChanged(); }
    catch (e) { toast({ title: 'That did not work', description: (e as Error).message, variant: 'error' }); }
  };
  const done = () => { setDialog(null); onChanged(); };

  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Bank loan" subtitle="If the buyer is financing the plot, track the application and what the bank has paid out."
        action={loan ? <Button variant="outline" size="sm" onClick={() => setDialog('loan')}>Update</Button> : <Button variant="outline" size="sm" leftIcon={<Plus size={13} />} onClick={() => setDialog('loan')}>Add loan</Button>} />
      {!loan ? <p className="text-sm text-ink-muted">No loan recorded.</p> : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium text-ink">{loan.bankName}</span><Badge tone={TONE[loan.stage]}>{label(loan.stage)}</Badge>
            <span className="text-ink-muted">Applied {formatDate(loan.appliedOn)}{loan.sanctionedOn ? ` · sanctioned ${formatDate(loan.sanctionedOn)}` : ''}</span>
          </div>
          {loan.status === 'sanctioned' && (
            <>
              <dl className="grid grid-cols-3 gap-3 text-sm">
                {[['Sanctioned', loan.sanctionedAmount ?? 0], ['Disbursed', loan.disbursed], ['Still to come', loan.remaining]].map(([k, v]) => (
                  <div key={k as string}><dt className="text-ink-muted">{k}</dt><dd className="font-semibold tabular-nums text-ink">{formatCurrency(v as number)}</dd></div>))}
              </dl>
              {loan.disbursements.length > 0 && (
                <ul className="divide-y divide-line text-sm">{loan.disbursements.map((d) => (
                  <li key={d.id} className="flex items-center justify-between py-1.5">
                    <span>{formatCurrency(d.amount)} <span className="text-ink-muted">· {formatDate(d.paidOn)}{d.reference ? ` · ${d.reference}` : ''}</span></span>
                    <button aria-label="Remove disbursement" className="rounded text-danger-600 focus-ring" onClick={() => run(() => removeDisbursement(d.id), 'Disbursement removed')}><Trash2 size={13} /></button>
                  </li>))}</ul>
              )}
              {loan.remaining > 0 && <div><Button variant="outline" size="sm" leftIcon={<Plus size={13} />} onClick={() => setDialog('pay')}>Record disbursement</Button></div>}
            </>
          )}
          {loan.note && <p className="text-sm text-ink-muted">{loan.note}</p>}
          {loan.disbursements.length === 0 && <div><Button variant="ghost" size="sm" className="text-danger-600" onClick={() => run(() => removeLoan(fileId), 'Loan removed')}>Remove loan</Button></div>}
        </div>
      )}
      {dialog === 'loan' && <LoanDialog fileId={fileId} loan={loan} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog === 'pay' && loan && <PayDialog fileId={fileId} loan={loan} onClose={() => setDialog(null)} onSaved={done} />}
    </Card>
  );
}

function LoanDialog({ fileId, loan, onClose, onSaved }: { fileId: string; loan: Loan | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({ bankName: loan?.bankName ?? '', status: loan?.status ?? 'applied', appliedOn: loan?.appliedOn.slice(0, 10) ?? today(), sanctionedOn: loan?.sanctionedOn?.slice(0, 10) ?? today(), sanctionedAmount: String(loan?.sanctionedAmount ?? ''), note: loan?.note ?? '' });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const sanctioned = f.status === 'sanctioned';
  const go = async () => {
    setSaving(true);
    try {
      await saveLoan(fileId, { bankName: f.bankName, status: f.status, appliedOn: f.appliedOn, note: f.note, ...(sanctioned ? { sanctionedOn: f.sanctionedOn, sanctionedAmount: Number(f.sanctionedAmount) } : {}) });
      toast({ title: 'Loan saved', variant: 'success' }); onSaved();
    } catch (e) { toast({ title: 'Could not save', description: (e as Error).message, variant: 'error' }); }
    finally { setSaving(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title="Bank loan" footer={<><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={go} isLoading={saving} disabled={!f.bankName.trim() || (sanctioned && !(Number(f.sanctionedAmount) > 0))}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        <Input label="Bank" name="loanBank" required value={f.bankName} onChange={set('bankName')} />
        <Select label="Status" name="loanStatus" value={f.status} onChange={set('status')} options={[{ value: 'applied', label: 'Applied' }, { value: 'sanctioned', label: 'Sanctioned' }, { value: 'rejected', label: 'Rejected' }]} />
        <DatePicker label="Applied on" name="loanApplied" value={f.appliedOn} onChange={set('appliedOn')} />
        {sanctioned && <>
          <DatePicker label="Sanctioned on" name="loanSanctioned" value={f.sanctionedOn} onChange={set('sanctionedOn')} />
          <Input label="Sanctioned amount (₹)" name="loanAmount" type="number" min={1} value={f.sanctionedAmount} onChange={set('sanctionedAmount')} />
        </>}
        <Input label="Note" name="loanNote" value={f.note} onChange={set('note')} />
      </div>
    </Modal>
  );
}

function PayDialog({ fileId, loan, onClose, onSaved }: { fileId: string; loan: Loan; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({ amount: String(loan.remaining), paidOn: today(), reference: '' });
  const [saving, setSaving] = useState(false);
  const go = async () => {
    setSaving(true);
    try { await addDisbursement(fileId, { amount: Number(f.amount), paidOn: f.paidOn, reference: f.reference || undefined }); toast({ title: 'Disbursement recorded', variant: 'success' }); onSaved(); }
    catch (e) { toast({ title: 'Could not save', description: (e as Error).message, variant: 'error' }); }
    finally { setSaving(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title="Loan disbursement" footer={<><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={go} isLoading={saving} disabled={!(Number(f.amount) > 0)}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        <Input label="Amount (₹)" name="disbAmount" type="number" min={1} max={loan.remaining} value={f.amount} onChange={(e) => setF((x) => ({ ...x, amount: e.target.value }))} hint={`${formatCurrency(loan.remaining)} still to come`} />
        <DatePicker label="Paid on" name="disbDate" value={f.paidOn} onChange={(e) => setF((x) => ({ ...x, paidOn: e.target.value }))} />
        <Input label="Reference" name="disbRef" value={f.reference} onChange={(e) => setF((x) => ({ ...x, reference: e.target.value }))} placeholder="UTR" />
      </div>
    </Modal>
  );
}
