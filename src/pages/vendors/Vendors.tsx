import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { SearchInput } from '../../components/ui/SearchInput';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../context/ToastContext';
import { formatCurrency } from '../../utils/format';
import { VENDOR_CATEGORIES, createVendor, listVendors } from '../../services/vendorService';

export function Vendors() {
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const q = useDebounce(search, 300);
  const { data, isLoading, error } = useAsync(() => listVendors(category, q), [category, q, reload]);

  return (
    <div>
      <PageHeader title="Vendors & stakeholders" description="Contractors, suppliers, architects, consultants and agencies." breadcrumb={[{ label: 'Vendors & Material' }, { label: 'Directory' }]}
        actions={<Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setAdding(true)}>Add vendor</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by name, contact or phone…" />
        <Select aria-label="Category" name="categoryFilter" value={category} onChange={(e) => setCategory(e.target.value)} wrapperClassName="w-44"
          options={[{ value: 'all', label: 'All categories' }, ...VENDOR_CATEGORIES]} />
      </div>
      {error ? <ErrorState title="Could not load vendors" description={error.message} /> : isLoading || !data ? <CardSkeleton /> : data.length === 0 ? (
        <Card><EmptyState title="No vendors found" description="Add the first contractor or supplier." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((v) => (
            <Link key={v.id} to={`/vendors/${v.id}`} className="rounded-xl border border-line bg-white p-5 shadow-card hover:shadow-popover focus-ring">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-ink">{v.name}</h3>
                <Badge tone={v.active ? 'success' : 'neutral'}>{v.active ? 'Active' : 'Inactive'}</Badge>
              </div>
              <p className="text-xs capitalize text-ink-muted">{v.category}{v.contactPerson ? ` · ${v.contactPerson}` : ''}</p>
              <p className="mt-3 text-sm text-ink">{formatCurrency(v.contractValue)} <span className="text-ink-faint">contract value</span></p>
              <p className="mt-1 text-xs text-ink-muted">{v.workOrderCount} work order{v.workOrderCount === 1 ? '' : 's'} · {v.documentCount} document{v.documentCount === 1 ? '' : 's'}</p>
              <p className="mt-1 text-xs text-ink-faint">{v.loginEmail ? `Portal login: ${v.loginEmail}` : 'No portal login'}</p>
            </Link>
          ))}
        </div>
      )}
      {adding && <AddVendor onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setReload((k) => k + 1); }} />}
    </div>
  );
}

function AddVendor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({ name: '', category: 'contractor', contactPerson: '', phone: '', email: '', gstin: '', address: '', contractValue: '' });
  const [withLogin, setWithLogin] = useState(false);
  const [login, setLogin] = useState({ email: '', password: '' });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      await createVendor({ ...f, contractValue: Number(f.contractValue) || 0, ...(withLogin ? { login } : {}) });
      toast({ title: 'Vendor added', variant: 'success' });
      onSaved();
    } catch (err) {
      toast({ title: 'Could not add the vendor', description: (err as Error).message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Add vendor" size="lg"
      footer={<><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={save} isLoading={saving} disabled={!f.name.trim()}>Add vendor</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Name" name="vendorName" required value={f.name} onChange={set('name')} />
        <Select label="Category" name="vendorCategory" value={f.category} onChange={set('category')} options={VENDOR_CATEGORIES} />
        <Input label="Contact person" name="contactPerson" value={f.contactPerson} onChange={set('contactPerson')} />
        <Input label="Phone" name="vendorPhone" value={f.phone} onChange={set('phone')} placeholder="10 digits" />
        <Input label="Email" name="vendorEmail" type="email" value={f.email} onChange={set('email')} />
        <Input label="GSTIN" name="gstin" value={f.gstin} onChange={set('gstin')} />
        <MoneyInput label="Contract value (₹)" name="contractValue" type="number" min={0} value={f.contractValue} onChange={set('contractValue')} />
        <Input label="Address" name="vendorAddress" value={f.address} onChange={set('address')} />
      </div>
      <label className="mt-5 flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={withLogin} onChange={(e) => setWithLogin(e.target.checked)} /> Give this vendor a portal login
      </label>
      {withLogin && (
        <div className="mt-3 grid grid-cols-1 gap-4 rounded-lg bg-surface-subtle p-4 sm:grid-cols-2">
          <Input label="Login email" name="loginEmail" type="email" value={login.email} onChange={(e) => setLogin((l) => ({ ...l, email: e.target.value }))} />
          <Input label="Password" name="loginPassword" type="password" value={login.password} onChange={(e) => setLogin((l) => ({ ...l, password: e.target.value }))} hint="At least 8 characters. Needs the phone number above." />
          <p className="text-xs text-ink-muted sm:col-span-2">They see only their own work, material entries and bills — nothing about leads, buyers or other vendors.</p>
        </div>
      )}
    </Modal>
  );
}
