import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { StatCard } from '../../components/ui/StatCard';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Tabs } from '../../components/ui/Tabs';
import { ChartCard } from '../../components/charts/ChartCard';
import { DonutChart } from '../../components/charts/DonutChart';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import { listAttendance, type AttendanceListParams } from '../../services/attendanceService';
import { exportToCsv } from '../../services/reportService';
import { refEmployees, refLeaders } from '../../data/referenceData';
import { formatDate, formatHours } from '../../utils/format';
import { RoleId, type AttendanceRecord } from '../../types';

const ROLE_OPTIONS = [
  { value: 'all', label: 'All Roles' },
  { value: String(RoleId.Employee), label: 'Employee' },
  { value: String(RoleId.Leader), label: 'Leader' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'checked_in', label: 'Checked In' },
  { value: 'checked_out', label: 'Checked Out' },
  { value: 'not_checked_in', label: 'Not Checked In' },
  { value: 'pending_sync', label: 'Pending Sync' },
  { value: 'failed', label: 'Failed' },
];

const LOCATION_OPTIONS = [
  { value: 'all', label: 'All Locations' },
  { value: 'inside', label: 'Inside' },
  { value: 'outside', label: 'Outside' },
];

const USER_OPTIONS = [
  { value: 'all', label: 'All Employees / Leaders' },
  ...refEmployees.map((e) => ({ value: e.id, label: e.name })),
  ...refLeaders.map((l) => ({ value: l.id, label: l.name })),
];

function isoDaysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const RANGE_BY_TAB: Record<string, number> = { daily: 0, weekly: 6, monthly: 29 };

export function AttendanceReports() {
  const [tab, setTab] = useState('daily');
  const [userId, setUserId] = useState('all');
  const [role, setRole] = useState<AttendanceListParams['role']>('all');
  const [status, setStatus] = useState<AttendanceListParams['status']>('all');
  const [locationStatus, setLocationStatus] = useState<AttendanceListParams['locationStatus']>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const effectiveFrom = dateFrom || isoDaysAgo(RANGE_BY_TAB[tab] ?? 0);
  const effectiveTo = dateTo || isoDaysAgo(0);

  const params: AttendanceListParams = {
    page: 1,
    pageSize: 500,
    userId: userId === 'all' ? undefined : userId,
    role,
    status,
    locationStatus,
    dateFrom: effectiveFrom,
    dateTo: effectiveTo,
  };

  const { data, isLoading } = useAsync(() => listAttendance(params), [JSON.stringify(params), tab]);
  const rows = data?.items ?? [];

  const summary = useMemo(() => {
    const withHours = rows.filter((r) => r.workingHours !== undefined);
    const avgHours = withHours.length ? withHours.reduce((s, r) => s + (r.workingHours ?? 0), 0) / withHours.length : 0;
    return {
      avgHours,
      late: rows.filter((r) => r.isLate).length,
      early: rows.filter((r) => r.isEarlyDeparture).length,
      inside: rows.filter((r) => r.geoFenceResult === 'inside').length,
      outside: rows.filter((r) => r.geoFenceResult === 'outside').length,
    };
  }, [rows]);

  const geoChartData = [
    { name: 'Inside Geo-fence', value: summary.inside },
    { name: 'Outside Geo-fence', value: summary.outside },
  ];

  const columns: DataTableColumn<AttendanceRecord>[] = [
    { key: 'user', header: 'Employee / Leader', render: (r) => r.userName },
    { key: 'role', header: 'Role', render: (r) => (r.role === RoleId.Leader ? 'Leader' : 'Employee') },
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
    { key: 'hours', header: 'Working Hours', align: 'right', render: (r) => formatHours(r.workingHours) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge kind="attendance" status={r.status} /> },
    { key: 'geo', header: 'Geo Result', render: (r) => <StatusBadge kind="geo" status={r.geoFenceResult} /> },
  ];

  const handleExport = () => {
    exportToCsv(
      `attendance-report-${tab}.csv`,
      rows.map((r) => ({
        user: r.userName,
        role: r.role === RoleId.Leader ? 'Leader' : 'Employee',
        date: r.date,
        workingHours: r.workingHours ?? '',
        status: r.status,
        late: r.isLate,
        earlyDeparture: r.isEarlyDeparture,
        geoResult: r.geoFenceResult,
      }))
    );
  };

  return (
    <div>
      <PageHeader
        title="Attendance Reports"
        description="Daily, weekly and monthly attendance summaries for Employees and Leaders."
        actions={
          <Button variant="outline" leftIcon={<Download size={14} />} onClick={handleExport}>
            Export
          </Button>
        }
      />

      <Card padded={false}>
        <div className="px-5 pt-5">
          <Tabs
            items={[
              { key: 'daily', label: 'Daily' },
              { key: 'weekly', label: 'Weekly' },
              { key: 'monthly', label: 'Monthly' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>

        <div className="space-y-5 p-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <DatePicker value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} wrapperClassName="w-40" aria-label="From date" />
            <DatePicker value={dateTo} onChange={(e) => setDateTo(e.target.value)} wrapperClassName="w-40" aria-label="To date" />
            <Select value={userId} onChange={(e) => setUserId(e.target.value)} options={USER_OPTIONS} wrapperClassName="w-48" />
            <Select value={role} onChange={(e) => setRole(e.target.value as AttendanceListParams['role'])} options={ROLE_OPTIONS} wrapperClassName="w-36" />
            <Select value={status} onChange={(e) => setStatus(e.target.value as AttendanceListParams['status'])} options={STATUS_OPTIONS} wrapperClassName="w-40" />
            <Select
              value={locationStatus}
              onChange={(e) => setLocationStatus(e.target.value as AttendanceListParams['locationStatus'])}
              options={LOCATION_OPTIONS}
              wrapperClassName="w-40"
            />
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Avg. Working Hours" value={formatHours(summary.avgHours)} tone="shell" />
            <StatCard label="Late Arrivals" value={summary.late} tone="warning" />
            <StatCard label="Early Departures" value={summary.early} tone="accent" />
            <StatCard label="Records in Range" value={rows.length} tone="brand" />
          </div>

          <ChartCard title="Geo-fence Result" subtitle="Inside vs outside allowed radius for this range">
            <DonutChart data={geoChartData} height={180} />
          </ChartCard>

          <Card padded={false}>
            <div className="px-5 pt-4">
              <CardHeader title="Records" subtitle={`${effectiveFrom} to ${effectiveTo}`} />
            </div>
            <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} isLoading={isLoading} />
          </Card>
        </div>
      </Card>
    </div>
  );
}
