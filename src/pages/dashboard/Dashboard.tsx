import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, ClipboardList, Wallet, Users, Fingerprint, LifeBuoy,
  Plus, BarChart3, ArrowUpRight,
} from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { StatCard } from '../../components/ui/StatCard';
import { StatCardSkeleton, TableSkeleton } from '../../components/ui/LoadingSkeleton';
import { Card, CardHeader } from '../../components/ui/Card';
import { ChartCard } from '../../components/charts/ChartCard';
import { TrendAreaChart } from '../../components/charts/TrendAreaChart';
import { DonutChart } from '../../components/charts/DonutChart';
import { SimpleBarChart } from '../../components/charts/SimpleBarChart';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Avatar } from '../../components/ui/Avatar';
import { useAsync } from '../../hooks/useAsync';
import {
  getDashboardSnapshot, getRecentBookings, getRecentPayments, getTodayAttendanceSample, getRecentTickets,
  type DashboardRange,
} from '../../services/dashboardService';
import { BusinessOverview } from './BusinessOverview';
import { projectNameForBooking } from '../../services/bookingService';
import { unitLabelForPayment, projectNameForPayment } from '../../services/paymentService';
import { userDisplayName } from '../../data/referenceData';
import { formatCurrency, formatFullCurrency, formatDate, formatTime, formatHours } from '../../utils/format';
import type { BookingRow, AttendanceRecord, SupportTicket } from '../../types';

const RANGE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'custom', label: 'Custom Range' },
];

export function Dashboard() {
  const navigate = useNavigate();
  const [range, setRange] = useState<DashboardRange>('month');

  const { data: snapshot, isLoading } = useAsync(() => getDashboardSnapshot(range), [range]);
  const { data: recentBookings, isLoading: bookingsLoading } = useAsync(() => getRecentBookings(6), []);
  const { data: recentPayments, isLoading: paymentsLoading } = useAsync(() => getRecentPayments(6), []);
  const { data: todayAttendance, isLoading: attendanceLoading } = useAsync(() => getTodayAttendanceSample(6), []);
  const { data: recentTickets, isLoading: ticketsLoading } = useAsync(() => getRecentTickets(6), []);

  const bookingColumns: DataTableColumn<BookingRow>[] = [
    { key: 'id', header: 'Booking ID', render: (b) => <span className="font-medium text-ink">{b.id}</span> },
    { key: 'customer', header: 'Customer', render: (b) => b.bookingName },
    { key: 'project', header: 'Project', render: (b) => projectNameForBooking(b) },
    { key: 'partner', header: 'Partner', render: (b) => (b.userId ? userDisplayName(b.userId) : '—') },
    { key: 'amount', header: 'Amount', align: 'right', render: (b) => formatCurrency(b.amount) },
    { key: 'mode', header: 'Payment Mode', render: (b) => <StatusBadge kind="paymentMode" status={b.paymentMode} dot={false} /> },
    { key: 'status', header: 'Status', render: (b) => <StatusBadge kind="booking" status={b.status} /> },
    { key: 'date', header: 'Date', render: (b) => formatDate(b.createdAt) },
  ];

  const paymentColumns: DataTableColumn<BookingRow>[] = [
    { key: 'id', header: 'Payment ID', render: (b) => <span className="font-medium text-ink">{b.id}</span> },
    { key: 'unit', header: 'Unit', render: (b) => unitLabelForPayment(b) },
    { key: 'project', header: 'Project', render: (b) => projectNameForPayment(b) },
    { key: 'amount', header: 'Amount', align: 'right', render: (b) => formatCurrency(b.amount) },
    { key: 'mode', header: 'Payment Mode', render: (b) => <StatusBadge kind="paymentMode" status={b.paymentMode} dot={false} /> },
    { key: 'type', header: 'Type', render: (b) => <StatusBadge kind="depositType" status={b.isDeposit} dot={false} /> },
    { key: 'date', header: 'Date', render: (b) => formatDate(b.createdAt) },
  ];

  const attendanceColumns: DataTableColumn<AttendanceRecord>[] = [
    {
      key: 'user',
      header: 'Employee / Leader',
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={r.userName} size="xs" />
          <span className="font-medium text-ink">{r.userName}</span>
        </div>
      ),
    },
    { key: 'role', header: 'Role', render: (r) => (r.role === 3 ? 'Leader' : 'Employee') },
    { key: 'checkIn', header: 'Check-in', render: (r) => (r.checkInAt ? formatTime(r.checkInAt) : '—') },
    { key: 'checkOut', header: 'Check-out', render: (r) => (r.checkOutAt ? formatTime(r.checkOutAt) : '—') },
    { key: 'duration', header: 'Duration', render: (r) => formatHours(r.workingHours) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge kind="attendance" status={r.status} /> },
    { key: 'location', header: 'Location Status', render: (r) => <StatusBadge kind="geo" status={r.geoFenceResult} /> },
  ];

  const ticketColumns: DataTableColumn<SupportTicket>[] = [
    { key: 'id', header: 'Ticket ID', render: (t) => <span className="font-medium text-ink">{t.id}</span> },
    { key: 'user', header: 'User', render: (t) => t.userName },
    { key: 'subject', header: 'Subject', render: (t) => <span className="line-clamp-1 max-w-xs">{t.subject}</span> },
    { key: 'status', header: 'Status', render: (t) => <StatusBadge kind="ticket" status={t.status} /> },
    { key: 'created', header: 'Created', render: (t) => formatDate(t.createdAt) },
    { key: 'lastReply', header: 'Last Reply', render: (t) => (t.lastReplyAt ? formatDate(t.lastReplyAt) : '—') },
  ];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Operational overview across properties, bookings, payments, partners and attendance."
        actions={
          <>
            <Select
              value={range}
              onChange={(e) => setRange(e.target.value as DashboardRange)}
              options={RANGE_OPTIONS}
              wrapperClassName="w-40"
              aria-label="Date filter"
            />
            <Button variant="outline" leftIcon={<Plus size={15} />} onClick={() => navigate('/projects/new')}>
              Add Property
            </Button>
            <Button variant="primary" leftIcon={<BarChart3 size={15} />} onClick={() => navigate('/reports')}>
              Reports
            </Button>
          </>
        }
      />

      <BusinessOverview />

      {/* Quick actions */}
      <div className="mb-6 flex flex-wrap gap-2.5">
        {[
          { label: 'Add Property', to: '/projects/new', icon: Building2 },
          { label: 'View Bookings', to: '/bookings', icon: ClipboardList },
          { label: 'Users', to: '/users/agents', icon: Users },
          { label: 'Attendance', to: '/attendance/today', icon: Fingerprint },
          { label: 'Reports', to: '/reports', icon: BarChart3 },
        ].map((qa) => (
          <button
            key={qa.to}
            onClick={() => navigate(qa.to)}
            className="flex items-center gap-2 rounded-lg border border-line-strong bg-white px-3.5 py-2 text-sm font-medium text-ink-muted transition-colors hover:border-brand-300 hover:text-brand-700 focus-ring"
          >
            <qa.icon size={15} />
            {qa.label}
          </button>
        ))}
      </div>

      {isLoading || !snapshot ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => <StatCardSkeleton key={i} />)}
        </div>
      ) : (
        <>
          {/* Properties */}
          <SectionLabel label="Properties" />
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Total Projects" value={snapshot.properties.total} icon={Building2} tone="brand" onClick={() => navigate('/projects')} />
            <StatCard label="Active" value={snapshot.properties.active} tone="success" />
            <StatCard label="Inactive" value={snapshot.properties.inactive} tone="neutral" />
            <StatCard label="Available Units" value={snapshot.units.available} tone="success" />
            <StatCard label="Sold Out Units" value={snapshot.units.soldOut} tone="shell" />
          </div>

          {/* Bookings */}
          <SectionLabel label="Bookings" />
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Today" value={snapshot.bookings.today} icon={ClipboardList} tone="brand" onClick={() => navigate('/bookings')} />
            <StatCard label="Pending" value={snapshot.bookings.pending} tone="warning" onClick={() => navigate('/bookings/pending')} />
            <StatCard label="Confirmed" value={snapshot.bookings.confirmed} tone="success" onClick={() => navigate('/bookings/booked')} />
            <StatCard label="Booked Units" value={snapshot.units.booked} tone="info" />
          </div>

          {/* Payments */}
          <SectionLabel label="Payments" />
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Collected" value={formatCurrency(snapshot.payments.collected)} icon={Wallet} tone="success" onClick={() => navigate('/transactions')} />
            <StatCard label="Remaining" value={formatCurrency(snapshot.payments.remaining)} tone="danger" onClick={() => navigate('/bookings/remaining')} />
            <StatCard label="Bank Transfer" value={formatCurrency(snapshot.payments.bankTransfer)} tone="shell" />
            <StatCard label="Cash" value={formatCurrency(snapshot.payments.cash)} tone="neutral" />
            <StatCard label="Cheque" value={formatCurrency(snapshot.payments.cheque)} tone="info" />
          </div>

          {/* Partners */}
          <SectionLabel label="Partners / Users" />
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Total Agents" value={snapshot.partners.agents} icon={Users} tone="brand" onClick={() => navigate('/users/agents')} />
            <StatCard label="Employees" value={snapshot.partners.employees} tone="shell" onClick={() => navigate('/users/employees')} />
            <StatCard label="Leaders" value={snapshot.partners.leaders} tone="accent" onClick={() => navigate('/users/leaders')} />
            <StatCard label="Active Users" value={snapshot.partners.active} tone="success" />
            <StatCard label="Inactive Users" value={snapshot.partners.inactive} tone="neutral" />
          </div>

          {/* Teams + Attendance + Support combined row */}
          <SectionLabel label="Teams · Attendance · Support" />
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Employee Network" value={snapshot.teams.employeeNetwork} tone="shell" onClick={() => navigate('/teams')} />
            <StatCard label="Leader Network" value={snapshot.teams.leaderNetwork} tone="accent" />
            <StatCard label="Present Today" value={snapshot.attendance.present} icon={Fingerprint} tone="success" onClick={() => navigate('/attendance/today')} />
            <StatCard label="Late" value={snapshot.attendance.late} tone="warning" />
            <StatCard label="Absent" value={snapshot.attendance.absent} tone="danger" />
            <StatCard label="Open Tickets" value={snapshot.support.open} icon={LifeBuoy} tone="brand" onClick={() => navigate('/support')} />
          </div>

          {/* Charts */}
          <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ChartCard title="Booking Trend" subtitle="Bookings created over the last 14 days">
                <TrendAreaChart data={snapshot.bookingTrend} xKey="date" yKey="bookings" />
              </ChartCard>
            </div>
            <ChartCard title="User Distribution" subtitle="Agents, Employees, Leaders">
              <DonutChart data={snapshot.userDistribution} />
            </ChartCard>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
            <ChartCard title="Payment Overview" subtitle="Collected vs pending vs remaining">
              <SimpleBarChart data={snapshot.paymentOverview} valueFormatter={(v) => formatFullCurrency(v)} />
            </ChartCard>
            <ChartCard title="Property Inventory" subtitle="Unit status across all projects">
              <SimpleBarChart data={snapshot.inventoryBreakdown} />
            </ChartCard>
            <ChartCard title="Booking Status" subtitle="Current booking pipeline">
              <DonutChart data={snapshot.bookingStatusBreakdown} />
            </ChartCard>
          </div>

          <div className="mb-6">
            <ChartCard title="Attendance Overview" subtitle="Today's attendance breakdown for Employees & Leaders">
              <SimpleBarChart data={snapshot.attendanceOverview} horizontal height={220} />
            </ChartCard>
          </div>
        </>
      )}

      {/* Tables */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card padded={false}>
          <div className="p-5 pb-0">
            <CardHeader
              title="Recent Bookings"
              action={
                <Button variant="ghost" size="sm" rightIcon={<ArrowUpRight size={13} />} onClick={() => navigate('/bookings')}>
                  View all
                </Button>
              }
            />
          </div>
          {bookingsLoading ? <TableSkeleton cols={6} /> : (
            <DataTable columns={bookingColumns} rows={recentBookings ?? []} rowKey={(b) => b.id} onRowClick={(b) => navigate(`/bookings/${b.id}`)} />
          )}
        </Card>

        <Card padded={false}>
          <div className="p-5 pb-0">
            <CardHeader
              title="Recent Payments"
              action={
                <Button variant="ghost" size="sm" rightIcon={<ArrowUpRight size={13} />} onClick={() => navigate('/transactions')}>
                  View all
                </Button>
              }
            />
          </div>
          {paymentsLoading ? <TableSkeleton cols={6} /> : (
            <DataTable columns={paymentColumns} rows={recentPayments ?? []} rowKey={(b) => b.id} onRowClick={(b) => navigate(`/bookings/${b.id}`)} />
          )}
        </Card>

        <Card padded={false}>
          <div className="p-5 pb-0">
            <CardHeader
              title="Today's Attendance"
              action={
                <Button variant="ghost" size="sm" rightIcon={<ArrowUpRight size={13} />} onClick={() => navigate('/attendance/today')}>
                  View all
                </Button>
              }
            />
          </div>
          {attendanceLoading ? <TableSkeleton cols={6} /> : (
            <DataTable columns={attendanceColumns} rows={todayAttendance ?? []} rowKey={(r) => r.id} onRowClick={(r) => navigate(`/attendance/${r.id}`)} />
          )}
        </Card>

        <Card padded={false}>
          <div className="p-5 pb-0">
            <CardHeader
              title="Support Tickets"
              action={
                <Button variant="ghost" size="sm" rightIcon={<ArrowUpRight size={13} />} onClick={() => navigate('/support')}>
                  View all
                </Button>
              }
            />
          </div>
          {ticketsLoading ? <TableSkeleton cols={6} /> : (
            <DataTable columns={ticketColumns} rows={recentTickets ?? []} rowKey={(t) => t.id} onRowClick={(t) => navigate(`/support/${t.id}`)} />
          )}
        </Card>
      </div>
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</p>;
}
