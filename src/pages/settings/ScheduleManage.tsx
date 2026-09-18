import { useState } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { listSchedules, createSchedule, updateSchedule } from '../../services/scheduleService';
import type { ManageTimeType } from '../../types';

const TYPE_OPTIONS: { value: ManageTimeType; label: string }[] = [
  { value: 'Days', label: 'Days' },
  { value: 'Months', label: 'Months' },
  { value: 'Years', label: 'Years' },
];

export function ScheduleManage() {
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const { data: schedules, isLoading } = useAsync(() => listSchedules(), [reloadKey]);

  const [time, setTime] = useState('');
  const [timeType, setTimeType] = useState<ManageTimeType>('Months');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    const value = Number(time);
    if (!value || value <= 0) return;
    setCreating(true);
    try {
      await createSchedule({ time: value, timeType });
      toast({ title: 'Schedule added', description: `${value} ${timeType} added as a return-schedule option.`, variant: 'success' });
      setTime('');
      setReloadKey((k) => k + 1);
    } finally {
      setCreating(false);
    }
  };

  const toggleStatus = async (id: string, status: 1 | 0) => {
    await updateSchedule(id, { status: status === 1 ? 0 : 1 });
    setReloadKey((k) => k + 1);
  };

  return (
    <div>
      <PageHeader
        title="Investment Return Schedules"
        description="Master-data duration options used for investment maturity/return calculations."
        breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'Return Schedules' }]}
      />

      <Card>
        <CardHeader title="Add Schedule" subtitle="Add a new maturity/return duration option." />
        <div className="flex flex-wrap items-end gap-3">
          <Input label="Duration" type="number" min={1} value={time} onChange={(e) => setTime(e.target.value)} wrapperClassName="w-32" />
          <Select label="Unit" value={timeType} onChange={(e) => setTimeType(e.target.value as ManageTimeType)} options={TYPE_OPTIONS} wrapperClassName="w-40" />
          <Button variant="primary" leftIcon={<Plus size={14} />} onClick={handleCreate} isLoading={creating}>
            Add
          </Button>
        </div>
      </Card>

      <Card className="mt-5" padded={false}>
        {isLoading ? (
          <p className="p-5 text-sm text-ink-muted">Loading…</p>
        ) : (
          <div className="divide-y divide-line">
            {(schedules ?? []).map((s) => (
              <div key={s.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-sm font-medium text-ink">{s.time} {s.timeType}</span>
                  <Badge tone={s.status === 1 ? 'success' : 'neutral'}>{s.status === 1 ? 'Active' : 'Inactive'}</Badge>
                </div>
                <Button variant="ghost" size="sm" onClick={() => toggleStatus(s.id, s.status)}>
                  {s.status === 1 ? 'Deactivate' : 'Activate'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
