import { Link } from 'react-router-dom';
import {
  Building2, ClipboardList, Wallet, Users, UsersRound, Fingerprint, LifeBuoy, Banknote, ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { useAsync } from '../../hooks/useAsync';
import { getCatalogue } from '../../services/projectReportService';

interface ReportCard {
  title: string;
  description: string;
  to: string;
  icon: LucideIcon;
}

const REPORTS: ReportCard[] = [
  { title: 'Property Report', description: 'Inventory, availability and booking counts across every project.', to: '/reports/properties', icon: Building2 },
  { title: 'Booking Report', description: 'Booking pipeline across projects, partners and statuses.', to: '/reports/bookings', icon: ClipboardList },
  { title: 'Payment Report', description: 'Collections by payment mode, status and date.', to: '/reports/payments', icon: Wallet },
  { title: 'Partner Report', description: 'Agents, employees and leaders with status and team assignment.', to: '/reports/partners', icon: Users },
  { title: 'Team Report', description: 'Team rosters, leaders and member counts.', to: '/reports/teams', icon: UsersRound },
  { title: 'Attendance Report', description: 'Check-ins, working hours and geo-fence compliance.', to: '/reports/attendance', icon: Fingerprint },
  { title: 'Support Report', description: 'Ticket volumes, statuses and response activity.', to: '/reports/support', icon: LifeBuoy },
  { title: 'Payout Report', description: 'Partner payout requests, amounts and approval status.', to: '/reports/payouts', icon: Banknote },
];

export function ReportsHome() {
  const { data: suite } = useAsync(() => getCatalogue(), []);
  return (
    <div>
      <PageHeader title="Reports" description="Operational reports across properties, bookings, payments, partners and more." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {REPORTS.map((report) => (
          <Link key={report.to} to={report.to} className="focus-ring block rounded-xl">
            <Card className="flex h-full flex-col gap-3 transition-shadow hover:shadow-popover">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                <report.icon size={19} />
              </span>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-ink">{report.title}</h3>
                <p className="mt-1 text-xs text-ink-muted">{report.description}</p>
              </div>
              <span className="flex items-center gap-1 text-xs font-medium text-brand-600">
                View report <ArrowRight size={13} />
              </span>
            </Card>
          </Link>
        ))}
      </div>

      {suite && suite.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-ink-faint">Projects &amp; operations</h2>
          <p className="mb-4 text-sm text-ink-muted">Construction, material, vendors, plot inventory, legal and collections. Each exports to Excel and PDF.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {suite.map((r) => (
              <Link key={r.key} to={`/reports/suite/${r.key}`} className="focus-ring block rounded-xl">
                <Card className="flex h-full flex-col gap-3 transition-shadow hover:shadow-popover">
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-ink">{r.title}</h3>
                    <p className="mt-1 text-xs text-ink-muted">{r.description}</p>
                  </div>
                  <span className="flex items-center gap-1 text-xs font-medium text-brand-600">View report <ArrowRight size={13} /></span>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
