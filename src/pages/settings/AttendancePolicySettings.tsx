import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { getAttendancePolicy, updateAttendancePolicy } from '../../services/attendanceService';
import type { AttendancePolicy } from '../../types';

export function AttendancePolicySettings() {
  const { toast } = useToast();
  const { data, isLoading } = useAsync(() => getAttendancePolicy(), []);
  const [values, setValues] = useState<AttendancePolicy | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setValues(data);
  }, [data]);

  const patch = (p: Partial<AttendancePolicy>) => setValues((prev) => (prev ? { ...prev, ...p } : prev));

  const handleSave = async () => {
    if (!values) return;
    setSaving(true);
    try {
      await updateAttendancePolicy(values);
      toast({ title: 'Attendance policy updated', variant: 'success' });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !values) {
    return (
      <div>
        <PageHeader title="Attendance Policy" breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'Attendance Policy' }]} />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Attendance Policy"
        description="Office location and geo-fence configuration for Employee and Leader attendance."
        breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'Attendance Policy' }]}
      />

      <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-info-100 bg-info-50 px-4 py-3 text-sm text-info-700">
        <Info size={16} className="mt-0.5 shrink-0" />
        <p>
          Saving here also moves the office the partner app reads, so a mark is measured against these coordinates from the
          next check-in onwards. A mark taken outside the radius is still recorded — it is flagged{' '}
          <strong>Outside Geo-fence</strong> with its distance, not blocked.
        </p>
      </div>

      <Card>
        <CardHeader title="Office Location" subtitle="Latitude, longitude and permitted geo-fence radius" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input label="Office latitude" type="number" step="0.0001" value={values.officeLat} onChange={(e) => patch({ officeLat: Number(e.target.value) })} />
          <Input label="Office longitude" type="number" step="0.0001" value={values.officeLng} onChange={(e) => patch({ officeLng: Number(e.target.value) })} />
          <Input
            label="Geo-fence radius (meters)"
            type="number"
            min={50}
            value={values.geoFenceRadiusMeters}
            onChange={(e) => patch({ geoFenceRadiusMeters: Number(e.target.value) })}
            hint="Default suggested radius is 200m."
          />
        </div>
        <input
          type="range"
          min={50}
          max={1000}
          step={10}
          value={values.geoFenceRadiusMeters}
          onChange={(e) => patch({ geoFenceRadiusMeters: Number(e.target.value) })}
          className="mt-4 w-full accent-brand-600"
          aria-label="Geo-fence radius slider"
        />

        <div className="mt-5 grid grid-cols-1 gap-4 border-t border-line pt-5 sm:grid-cols-3">
          <Input label="Work start time" type="time" value={values.workStartTime} onChange={(e) => patch({ workStartTime: e.target.value })} />
          <Input label="Late after (minutes)" type="number" min={0} value={values.lateAfterMinutes} onChange={(e) => patch({ lateAfterMinutes: Number(e.target.value) })} />
          <Input
            label="Standard working hours"
            type="number"
            step="0.5"
            min={1}
            value={values.standardWorkingHours}
            onChange={(e) => patch({ standardWorkingHours: Number(e.target.value) })}
          />
        </div>

        <div className="mt-5 flex justify-end border-t border-line pt-5">
          <Button variant="primary" onClick={handleSave} isLoading={saving}>
            Save Changes
          </Button>
        </div>
      </Card>
    </div>
  );
}
