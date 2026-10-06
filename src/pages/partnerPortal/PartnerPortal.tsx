import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Handshake } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { StatCard } from '../../components/ui/StatCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { formatCurrency, formatDate } from '../../utils/format';
import { portal } from '../../services/channelPartnerService';
import { BrokerageTable } from './BrokerageTable';

/** The portal is a channel partner's own view, so anyone else who opens it is told what it is. */
export function PartnerOnly({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  if ((session?.accountRole as string | undefined) === 'agent') return <>{children}</>;
  return (
    <Card>
      <EmptyState icon={Handshake} title="This page is for channel partner logins"
        description="The partner portal shows a partner their own leads, bookings and brokerage. You are signed in as staff, so there is nothing of yours to show here. Manage partners, and give them a login, under Channel partners."
        action={<Link to="/channel-partners" className="text-sm font-medium text-brand-700 focus-ring rounded">Open channel partners →</Link>} />
    </Card>
  );
}

export function PartnerHome() {
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const me = useAsync(() => portal.me(), [reload]);
  const leads = useAsync(() => portal.leads(), [reload]);
  if (me.error) return <ErrorState title="Could not load your account" description={me.error.message} />;
  if (!me.data || !leads.data) return <CardSkeleton />;
  const m = me.data;
  return (
    <div>
      <PageHeader title={`Welcome, ${m.name}`} description={`Partner code ${m.partnerCode}. A buyer you register stays yours for ${m.leadProtectionDays} days.`} breadcrumb={[{ label: 'My leads' }]}
        actions={<Button variant="primary" onClick={() => setAdding(true)}>Register a buyer</Button>} />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Leads registered" value={m.leads} tone="brand" />
        <StatCard label="Bookings" value={m.bookings} tone="success" />
        <StatCard label="Brokerage payable" value={formatCurrency(m.totals.payableNet)} tone="warning" />
        <StatCard label="Brokerage paid" value={formatCurrency(m.totals.paidNet)} tone="neutral" />
      </div>
      <Card padded={false}>
        <div className="border-b border-line px-5 py-3"><CardHeader title="My leads" subtitle={m.restricted ? `You may sell: ${m.projects.map((p) => p.projectName).join(', ')}.` : undefined} /></div>
        {leads.data.length === 0 ? <p className="px-5 py-5 text-sm text-ink-muted">No leads yet. Register a buyer to start.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-faint"><th className="px-5 py-2 font-medium">Buyer</th><th className="px-3 font-medium">Project</th><th className="px-3 font-medium">Stage</th><th className="px-5 font-medium">Protection</th></tr></thead>
            <tbody>{leads.data.map((l) => (
              <tr key={l.id} className="border-t border-line">
                <td className="px-5 py-2.5"><span className="font-medium text-ink">{l.name}</span><span className="block text-xs text-ink-muted">{l.phone} · registered {formatDate(l.registeredAt)}</span></td>
                <td className="px-3 text-ink-muted">{l.projectName ?? '—'}</td>
                <td className="px-3"><Badge tone="neutral">{l.stage ?? l.status}</Badge></td>
                <td className="px-5"><Badge tone={l.protected ? 'success' : 'neutral'}>{l.protected ? `Yours till ${formatDate(l.protectedUntil)}` : 'Ended'}</Badge></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
      {adding && <RegisterDialog projects={m.projects} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setReload((k) => k + 1); }} />}
    </div>
  );
}

function RegisterDialog({ projects, onClose, onSaved }: { projects: { id: string; projectName: string }[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({ name: '', phone: '', projectId: '', note: '' });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const go = async () => {
    setSaving(true);
    try { const r = await portal.registerLead({ name: f.name, phone: f.phone, projectId: f.projectId || undefined, note: f.note || undefined }); toast({ title: 'Buyer registered', description: `Yours until ${formatDate(r.protectedUntil)}.`, variant: 'success' }); onSaved(); }
    catch (e) { toast({ title: 'Could not register', description: (e as Error).message, variant: 'error' }); }
    finally { setSaving(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title="Register a buyer" footer={<><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={go} isLoading={saving} disabled={!f.name.trim() || f.phone.replace(/\D/g, '').length < 10}>Register</Button></>}>
      <div className="flex flex-col gap-4">
        <Input label="Buyer’s name" name="buyerName" required value={f.name} onChange={set('name')} />
        <Input label="Phone" name="buyerPhone" required inputMode="numeric" value={f.phone} onChange={set('phone')} hint="10 digits. A number already in our system cannot be registered again." />
        <Select label="Project" name="buyerProject" value={f.projectId} onChange={set('projectId')} options={[{ value: '', label: 'Not decided' }, ...projects.map((p) => ({ value: p.id, label: p.projectName }))]} />
        <Input label="Note" name="buyerNote" value={f.note} onChange={set('note')} />
      </div>
    </Modal>
  );
}

export function PartnerBookings() {
  const { data, error } = useAsync(() => portal.bookings(), []);
  return (
    <div>
      <PageHeader title="My bookings" description="Bookings made through you." breadcrumb={[{ label: 'My bookings' }]} />
      {error ? <ErrorState title="Could not load bookings" description={error.message} /> : !data ? <CardSkeleton /> : data.length === 0 ? <Card><EmptyState title="No bookings yet" description="They appear here once a buyer you brought books a plot." /></Card> : (
        <Card padded={false}><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-faint"><th className="px-5 py-2 font-medium">Booking</th><th className="px-3 font-medium">Plot</th><th className="px-3 text-right font-medium">Amount</th><th className="px-5 font-medium">Status</th></tr></thead>
          <tbody>{data.map((b) => (
            <tr key={b.id} className="border-t border-line"><td className="px-5 py-2.5"><span className="font-medium text-ink">{b.reference}</span><span className="block text-xs text-ink-muted">{b.buyerName}</span></td>
              <td className="px-3 text-ink-muted">{b.unit} · {b.projectName}</td><td className="px-3 text-right tabular-nums">{formatCurrency(b.amount)}</td>
              <td className="px-5"><Badge tone={b.status === 'booked' ? 'success' : b.status === 'cancelled' ? 'danger' : 'warning'}>{b.status}</Badge></td></tr>))}</tbody>
        </table></div></Card>
      )}
    </div>
  );
}

export function PartnerBrokerage() {
  const { data, error } = useAsync(() => portal.brokerage(), []);
  if (error) return <ErrorState title="Could not load brokerage" description={error.message} />;
  if (!data) return <CardSkeleton />;
  const eligible = data.eligibleAt === 'booking' ? 'the booking is confirmed' : data.eligibleAt === 'agreement' ? 'the buyer’s agreement is signed' : 'the plot is registered';
  return (
    <div>
      <PageHeader title="My brokerage" description={`Brokerage becomes payable once ${eligible}. ${data.tdsPercent}% tax is deducted.`} breadcrumb={[{ label: 'My brokerage' }]} />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Payable now" value={formatCurrency(data.totals.payableNet)} tone="success" />
        <StatCard label="Waiting for milestone" value={formatCurrency(data.totals.waitingNet)} tone="warning" />
        <StatCard label="Paid" value={formatCurrency(data.totals.paidNet)} tone="neutral" />
        <StatCard label="Tax deducted" value={formatCurrency(data.totals.tdsDeducted)} tone="neutral" />
      </div>
      <Card padded={false}><BrokerageTable data={data} /></Card>
    </div>
  );
}

export function PartnerDisputes() {
  const { toast } = useToast();
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ title: '', details: '', bookingId: '' });
  const [saving, setSaving] = useState(false);
  const { data, error } = useAsync(() => portal.disputes(), [reload]);
  const bookings = useAsync(() => portal.bookings(), []);
  const save = async () => {
    setSaving(true);
    try { await portal.raiseDispute({ title: f.title, details: f.details, bookingId: f.bookingId || undefined }); toast({ title: 'Dispute raised', variant: 'success' }); setAdding(false); setF({ title: '', details: '', bookingId: '' }); setReload((k) => k + 1); }
    catch (e) { toast({ title: 'Could not raise it', description: (e as Error).message, variant: 'error' }); }
    finally { setSaving(false); }
  };
  return (
    <div>
      <PageHeader title="Disputes" description="Raise it here if a lead’s ownership or a brokerage amount looks wrong." breadcrumb={[{ label: 'Disputes' }]} actions={<Button variant="primary" onClick={() => setAdding(true)}>Raise a dispute</Button>} />
      {error ? <ErrorState title="Could not load disputes" description={error.message} /> : !data ? <CardSkeleton /> : data.length === 0 ? <Card><EmptyState title="No disputes" description="Nothing is in dispute." /></Card> : (
        <Card><ul className="divide-y divide-line text-sm">{data.map((d) => (
          <li key={d.id} className="py-2.5"><div className="flex items-center justify-between"><span className="font-medium text-ink">{d.title}</span><Badge tone={d.status === 'open' ? 'warning' : 'success'}>{d.status === 'open' ? 'Open' : 'Resolved'}</Badge></div>
            {d.details && <p className="text-ink-muted">{d.details}</p>}
            <p className="text-xs text-ink-faint">Raised {formatDate(d.createdAt)}{d.resolution ? ` · Answer: ${d.resolution}` : ''}</p></li>))}</ul></Card>
      )}
      {adding && (
        <Modal isOpen onClose={() => setAdding(false)} title="Raise a dispute" footer={<><Button variant="outline" onClick={() => setAdding(false)} disabled={saving}>Cancel</Button><Button variant="primary" onClick={save} isLoading={saving} disabled={!f.title.trim()}>Submit</Button></>}>
          <div className="flex flex-col gap-4">
            <Input label="What is the issue?" name="pdTitle" required value={f.title} onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))} />
            <Input label="Details" name="pdDetails" value={f.details} onChange={(e) => setF((x) => ({ ...x, details: e.target.value }))} />
            <Select label="About which booking?" name="pdBooking" value={f.bookingId} onChange={(e) => setF((x) => ({ ...x, bookingId: e.target.value }))} options={[{ value: '', label: 'Not about a booking' }, ...(bookings.data ?? []).map((b) => ({ value: b.id, label: `${b.reference} · ${b.buyerName}` }))]} />
          </div>
        </Modal>
      )}
    </div>
  );
}
