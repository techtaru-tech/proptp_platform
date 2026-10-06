import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { StatCard } from '../../components/ui/StatCard';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { formatCurrency, formatDate } from '../../utils/format';
import { BrokerageTable } from '../partnerPortal/BrokerageTable';
import { KYC_LABEL, getPartner, logDispute, removePartnerLogin, resolveDispute, setPartnerLogin, setPartnerProjects, type PartnerDetail } from '../../services/channelPartnerService';

export function ChannelPartnerDetail() {
  const { id = '' } = useParams();
  const { toast } = useToast();
  const [reload, setReload] = useState(0);
  const [dialog, setDialog] = useState<null | 'login' | 'dispute' | { resolve: string }>(null);
  const { data: p, error } = useAsync(() => getPartner(id), [id, reload]);
  if (error) return <ErrorState title="Could not load this partner" description={error.message} />;
  if (!p) return <CardSkeleton />;
  const done = () => { setDialog(null); setReload((k) => k + 1); };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast({ title: ok, variant: 'success' }); setReload((k) => k + 1); }
    catch (e) { toast({ title: 'That did not work', description: (e as Error).message, variant: 'error' }); }
  };
  const b = p.brokerage;

  return (
    <div>
      <PageHeader title={p.name} description={`${p.partnerCode} · ${p.phone}${p.city ? ` · ${p.city}` : ''}`} breadcrumb={[{ label: 'Channel partners', to: '/channel-partners' }, { label: p.name }]}
        actions={<Badge tone={p.kycStatus === 1 ? 'success' : p.kycStatus === 2 ? 'danger' : 'warning'}>KYC {KYC_LABEL[p.kycStatus].toLowerCase()}</Badge>} />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Leads registered" value={p.leads.length} tone="brand" />
        <StatCard label="Bookings" value={p.bookings.filter((x) => x.status !== 'cancelled').length} tone="success" />
        <StatCard label="Brokerage payable" value={formatCurrency(b.totals.payableNet)} tone="warning" />
        <StatCard label="Brokerage paid" value={formatCurrency(b.totals.paidNet)} tone="neutral" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ProjectsCard p={p} onSave={(ids) => run(() => setPartnerProjects(p.id, ids), 'Projects saved')} />
        <Card>
          <CardHeader title="Portal login" subtitle="Lets the partner sign in to see only their own leads, bookings and brokerage."
            action={<Button variant="outline" size="sm" onClick={() => setDialog('login')}>{p.hasLogin ? 'Reset password' : 'Give a login'}</Button>} />
          {p.hasLogin ? (
            <div className="flex items-center justify-between text-sm"><span>Signs in as <strong>{p.email}</strong></span>
              <Button variant="ghost" size="sm" className="text-danger-600" onClick={() => run(() => removePartnerLogin(p.id), 'Login removed')}>Remove login</Button></div>
          ) : <p className="text-sm text-ink-muted">No portal login.</p>}
        </Card>

        <Card className="lg:col-span-2" padded={false}>
          <div className="border-b border-line px-5 py-3"><CardHeader title="Brokerage" subtitle={`Payable once ${b.eligibleAt === 'booking' ? 'the booking is confirmed' : b.eligibleAt === 'agreement' ? 'the agreement is signed' : 'the unit is registered'}. Tax deducted: ${b.tdsPercent}%.`} /></div>
          <BrokerageTable data={b} />
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Registered leads" subtitle="A lead stays the partner’s until its protection date." />
          {p.leads.length === 0 ? <p className="text-sm text-ink-muted">None yet.</p> : (
            <ul className="divide-y divide-line text-sm">{p.leads.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><span className="font-medium text-ink">{l.name}</span> <span className="text-ink-muted">· {l.phone}{l.projectName ? ` · ${l.projectName}` : ''}</span></span>
                <span className="flex items-center gap-2"><Badge tone="neutral">{l.stage ?? l.status}</Badge><Badge tone={l.protected ? 'success' : 'neutral'}>{l.protected ? `Protected till ${formatDate(l.protectedUntil)}` : 'Protection ended'}</Badge></span>
              </li>))}</ul>)}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Disputes" subtitle="Disagreements over lead ownership or brokerage." action={<Button variant="outline" size="sm" onClick={() => setDialog('dispute')}>Log a dispute</Button>} />
          {p.disputes.length === 0 ? <p className="text-sm text-ink-muted">No disputes.</p> : (
            <ul className="divide-y divide-line text-sm">{p.disputes.map((d) => (
              <li key={d.id} className="py-2.5">
                <div className="flex items-center justify-between gap-2"><span className="font-medium text-ink">{d.title}</span>
                  {d.status === 'open' ? <Button variant="outline" size="sm" onClick={() => setDialog({ resolve: d.id })}>Resolve</Button> : <Badge tone="success">Resolved</Badge>}</div>
                {d.details && <p className="text-ink-muted">{d.details}</p>}
                <p className="text-xs text-ink-faint">Raised by {d.raisedByName} · {formatDate(d.createdAt)}{d.resolution ? ` · Resolved by ${d.resolvedByName}: ${d.resolution}` : ''}</p>
              </li>))}</ul>)}
        </Card>
      </div>

      {dialog === 'login' && <LoginDialog p={p} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog === 'dispute' && <DisputeDialog p={p} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog && typeof dialog === 'object' && <ResolveDialog id={dialog.resolve} onClose={() => setDialog(null)} onSaved={done} />}
    </div>
  );
}

function ProjectsCard({ p, onSave }: { p: PartnerDetail; onSave: (ids: string[]) => void }) {
  const [ids, setIds] = useState(p.authorisedProjectIds);
  useEffect(() => setIds(p.authorisedProjectIds), [p.authorisedProjectIds]);
  const dirty = JSON.stringify([...ids].sort()) !== JSON.stringify([...p.authorisedProjectIds].sort());
  return (
    <Card>
      <CardHeader title="Authorised projects" subtitle="The projects this partner may sell. Leave all unticked for no restriction."
        action={<Button variant="primary" size="sm" disabled={!dirty} onClick={() => onSave(ids)}>Save</Button>} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {p.projects.map((pr) => (
          <label key={pr.id} className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" className="h-4 w-4 rounded border-line-strong focus-ring" checked={ids.includes(pr.id)} onChange={(e) => setIds(e.target.checked ? [...ids, pr.id] : ids.filter((x) => x !== pr.id))} />
            {pr.projectName}
          </label>))}
      </div>
    </Card>
  );
}

function useSave(onSaved: () => void, ok: string) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  return { saving, go: async (fn: () => Promise<unknown>) => {
    setSaving(true);
    try { await fn(); toast({ title: ok, variant: 'success' }); onSaved(); }
    catch (e) { toast({ title: 'Could not save', description: (e as Error).message, variant: 'error' }); }
    finally { setSaving(false); } } };
}
const Foot = ({ onClose, onSave, saving, disabled }: { onClose: () => void; onSave: () => void; saving: boolean; disabled: boolean }) =>
  <><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={onSave} isLoading={saving} disabled={disabled}>Save</Button></>;

function LoginDialog({ p, onClose, onSaved }: { p: PartnerDetail; onClose: () => void; onSaved: () => void }) {
  const [email, setEmail] = useState(p.email ?? '');
  const [password, setPassword] = useState('');
  const { saving, go } = useSave(onSaved, 'Login saved');
  return (
    <Modal isOpen onClose={onClose} title={p.hasLogin ? 'Reset password' : 'Give a portal login'} footer={<Foot onClose={onClose} saving={saving} disabled={!email.trim() || password.length < 8} onSave={() => go(() => setPartnerLogin(p.id, { email, password }))} />}>
      <div className="flex flex-col gap-4">
        <Input label="Login email" name="partnerEmail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Password" name="partnerPassword" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 8 characters. Share it with the partner." />
      </div>
    </Modal>
  );
}

function DisputeDialog({ p, onClose, onSaved }: { p: PartnerDetail; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: '', details: '' });
  const { saving, go } = useSave(onSaved, 'Dispute logged');
  return (
    <Modal isOpen onClose={onClose} title="Log a dispute" footer={<Foot onClose={onClose} saving={saving} disabled={!f.title.trim()} onSave={() => go(() => logDispute(p.id, f))} />}>
      <div className="flex flex-col gap-4">
        <Input label="Title" name="disputeTitle" required value={f.title} onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))} />
        <Input label="Details" name="disputeDetails" value={f.details} onChange={(e) => setF((x) => ({ ...x, details: e.target.value }))} />
      </div>
    </Modal>
  );
}

function ResolveDialog({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState('');
  const { saving, go } = useSave(onSaved, 'Dispute resolved');
  return (
    <Modal isOpen onClose={onClose} title="Resolve dispute" footer={<Foot onClose={onClose} saving={saving} disabled={!text.trim()} onSave={() => go(() => resolveDispute(id, text))} />}>
      <Input label="How was it resolved?" name="resolution" required value={text} onChange={(e) => setText(e.target.value)} />
    </Modal>
  );
}
