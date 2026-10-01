import { useMemo } from 'react';
import { NavLink, Outlet, useParams } from 'react-router-dom';
import { Eye } from 'lucide-react';
import { useAsync } from '../../hooks/useAsync';
import { getVendor, makePortal } from '../../services/vendorService';
import { PortalContext } from './PortalContext';

/** Staff looking at one vendor's portal as the vendor sees it. Read-only: nothing is posted in their name. */
export function PortalViewShell() {
  const { id = '' } = useParams();
  const api = useMemo(() => makePortal(`/vendors/portal-view/${id}`), [id]);
  const { data: vendor } = useAsync(() => getVendor(id), [id]);
  const tab = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg border px-3 py-1.5 text-sm focus-ring ${isActive ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line text-ink-muted'}`;
  return (
    <PortalContext.Provider value={{ api, readOnly: true }}>
      <div className="mb-5 rounded-xl border border-info-100 bg-info-50 px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-medium text-info-700">
          <Eye size={15} /> Viewing {vendor?.name ?? 'this vendor'}’s portal exactly as they see it — read-only
        </p>
        <p className="mt-0.5 text-xs text-info-700">Nothing can be posted from here; updates, deliveries and bills are raised by the vendor from their own login.</p>
        <nav className="mt-3 flex flex-wrap gap-2" aria-label="Vendor portal sections">
          <NavLink to={`/vendors/${id}/portal`} end className={tab}>Work &amp; updates</NavLink>
          <NavLink to={`/vendors/${id}/portal/material`} className={tab}>Material</NavLink>
          <NavLink to={`/vendors/${id}/portal/bills`} className={tab}>Bills</NavLink>
          <NavLink to={`/vendors/${id}`} className="ml-auto rounded-lg px-3 py-1.5 text-sm font-medium text-brand-700 focus-ring">← Back to vendor</NavLink>
        </nav>
      </div>
      <Outlet />
    </PortalContext.Provider>
  );
}
