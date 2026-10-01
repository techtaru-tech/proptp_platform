import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { Card } from '../../components/ui/Card';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../app/usePermissions';

/**
 * The vendor portal is a vendor's own view of their work, so it only has anything to show for a
 * vendor login. Anyone else who opens it (an administrator following a link, say) is told what it
 * is and where to manage vendors instead, rather than shown a bare "not linked" error.
 */
export function VendorOnly({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { can } = usePermissions();
  if ((session?.accountRole as string | undefined) === 'vendor') return <>{children}</>;
  return (
    <Card>
      <EmptyState
        icon={Briefcase}
        title="This page is for vendor logins"
        description="The vendor portal shows a vendor their own work orders, daily updates, material and bills. You are signed in as staff, so there is nothing of yours to show here."
        action={can('vendors') ? <Link to="/vendors" className="text-sm font-medium text-brand-700 focus-ring rounded">Manage vendors, their material and bills →</Link> : undefined}
      />
    </Card>
  );
}
