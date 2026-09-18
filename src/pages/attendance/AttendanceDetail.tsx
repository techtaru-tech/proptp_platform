import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MapPin, Navigation, Clock3, AlertCircle } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Avatar } from '../../components/ui/Avatar';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { getAttendanceRecord, getAttendancePolicy } from '../../services/attendanceService';
import { roleLabel } from '../../services/userService';
import { formatDate, formatDateTime, formatHours } from '../../utils/format';

export function AttendanceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [reloadKey, setReloadKey] = useState(0);

  const { data: record, isLoading, error } = useAsync(() => getAttendanceRecord(id ?? ''), [id, reloadKey]);
  const { data: policy } = useAsync(() => getAttendancePolicy(), []);

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Attendance Record" breadcrumb={[{ label: 'Attendance', to: '/attendance/today' }, { label: id ?? '' }]} />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  if (error || !record) {
    return (
      <div>
        <PageHeader title="Attendance Record" breadcrumb={[{ label: 'Attendance', to: '/attendance/today' }, { label: id ?? '' }]} />
        <Card>
          {error ? (
            <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
          ) : (
            <EmptyState
              title="Record not found"
              description="This attendance record does not exist."
              action={
                <Button variant="outline" onClick={() => navigate('/attendance/history')}>
                  Back to History
                </Button>
              }
            />
          )}
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={`${record.userName} — ${formatDate(record.date)}`}
        breadcrumb={[{ label: 'Attendance', to: '/attendance/history' }, { label: record.userName }]}
        actions={<StatusBadge kind="attendance" status={record.status} />}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Record Summary" subtitle="Check-in / check-out details" action={<Clock3 size={16} className="text-ink-faint" />} />
          <div className="mb-4 flex items-center gap-3">
            <Avatar name={record.userName} size="md" />
            <div>
              <p className="text-sm font-semibold text-ink">{record.userName}</p>
              <p className="text-xs text-ink-muted">{roleLabel(record.role)}</p>
            </div>
          </div>
          <dl className="space-y-2.5 text-sm">
            <Row label="Date" value={formatDate(record.date)} />
            <Row label="Check-in" value={record.checkInAt ? formatDateTime(record.checkInAt) : '—'} />
            <Row label="Check-out" value={record.checkOutAt ? formatDateTime(record.checkOutAt) : '—'} />
            <Row label="Working Hours" value={formatHours(record.workingHours)} />
            <Row
              label="Flags"
              value={
                <div className="flex gap-1.5">
                  {record.isLate && <Badge tone="warning">Late</Badge>}
                  {record.isEarlyDeparture && <Badge tone="warning">Early Departure</Badge>}
                  {!record.isLate && !record.isEarlyDeparture && <span className="text-ink-faint">None</span>}
                </div>
              }
            />
            <Row label="Sync Status" value={<StatusBadge kind="sync" status={record.syncStatus} />} />
            {record.failureReason && (
              <Row
                label="Failure Reason"
                value={
                  <span className="flex items-center gap-1.5 text-danger-600">
                    <AlertCircle size={13} /> {record.failureReason}
                  </span>
                }
              />
            )}
          </dl>
        </Card>

        <Card>
          <CardHeader title="Location & Geo-fence" subtitle="Check-in location vs office geo-fence" action={<MapPin size={16} className="text-ink-faint" />} />
          <MapPlaceholder record={record} />
          <dl className="mt-4 space-y-2.5 text-sm">
            <Row label="Office Location" value={policy ? `${policy.officeLat.toFixed(4)}, ${policy.officeLng.toFixed(4)}` : '—'} />
            <Row
              label="Check-in Location"
              value={record.checkInLocation ? `${record.checkInLocation.lat.toFixed(4)}, ${record.checkInLocation.lng.toFixed(4)}` : '—'}
            />
            <Row label="Address" value={record.checkInLocation?.address ?? '—'} />
            <Row label="Distance from Office" value={record.distanceFromOfficeMeters !== undefined ? `${record.distanceFromOfficeMeters} m` : '—'} />
            <Row label="Allowed Radius" value={policy ? `${policy.geoFenceRadiusMeters} m` : '—'} />
            <Row label="Geo-fence Result" value={<StatusBadge kind="geo" status={record.geoFenceResult} />} />
          </dl>
        </Card>

        {record.correctionRequested && (
          <Card className="lg:col-span-2">
            <CardHeader title="Correction Request" subtitle="Employee-submitted correction for this record" />
            <dl className="space-y-2.5 text-sm">
              <Row label="Reason" value={record.correctionReason ?? '—'} />
              <Row label="Status" value={record.correctionStatus ? <StatusBadge kind="correction" status={record.correctionStatus} /> : '—'} />
            </dl>
          </Card>
        )}
      </div>
    </div>
  );
}

function MapPlaceholder({ record }: { record: NonNullable<Awaited<ReturnType<typeof getAttendanceRecord>>> }) {
  const inside = record.geoFenceResult === 'inside';
  return (
    <div
      className="relative flex h-44 w-full items-center justify-center overflow-hidden rounded-lg border border-line"
      style={{
        backgroundImage:
          'linear-gradient(#e4e7ec 1px, transparent 1px), linear-gradient(90deg, #e4e7ec 1px, transparent 1px)',
        backgroundSize: '20px 20px',
        backgroundColor: '#f6f7f9',
      }}
    >
      <div className="absolute flex flex-col items-center" style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
        <span
          className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed"
          style={{ borderColor: inside ? '#12b76a' : '#f04438' }}
        >
          <span className="flex flex-col items-center gap-0.5 text-navy-800">
            <Navigation size={16} />
            <span className="text-[10px] font-medium">Office</span>
          </span>
        </span>
      </div>
      <div
        className="absolute flex flex-col items-center gap-0.5"
        style={{
          left: inside ? '54%' : '76%',
          top: inside ? '46%' : '22%',
        }}
      >
        <MapPin size={20} className={inside ? 'text-success-600' : 'text-danger-600'} fill="currentColor" fillOpacity={0.15} />
        <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-ink shadow-card">Check-in</span>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-ink-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}
