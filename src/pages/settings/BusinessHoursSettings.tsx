import { useEffect, useState } from 'react';
import { Copy, Info } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Toggle } from '../../components/ui/Toggle';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  getBusinessHours, updateBusinessHours, DAY_LABELS, TIMEZONE_OPTIONS, type DaySchedule,
} from '../../services/businessHoursService';
import { cn } from '../../utils/cn';

const TIME_INPUT_CLASS =
  'h-9 rounded-lg border border-line-strong bg-surface px-2.5 text-sm text-ink transition-colors hover:border-ink-faint focus-ring disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-faint';

/** Monday-first order for display — DAY_LABELS/schedule stay Sunday-first (JS `Date#getDay()`) underneath. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function BusinessHoursSettings() {
  const { toast } = useToast();
  const { data, isLoading } = useAsync(() => getBusinessHours(), []);

  const [enabled, setEnabled] = useState(false);
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [schedule, setSchedule] = useState<DaySchedule[]>([]);
  const [closedMessage, setClosedMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Seeded once when the settings load — after that, local edits are the source of truth
  // until Save, so a background refetch can't clobber an in-progress edit.
  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setTimezone(data.timezone);
    setSchedule(data.schedule);
    setClosedMessage(data.closedMessage ?? '');
  }, [data]);

  const markDirty = () => setIsDirty(true);

  const updateDay = (day: number, patch: Partial<DaySchedule>) => {
    setSchedule((prev) => prev.map((row) => (row.day === day ? { ...row, ...patch } : row)));
    markDirty();
  };

  const applyToWeekdays = () => {
    const monday = schedule.find((row) => row.day === 1);
    if (!monday) return;
    setSchedule((prev) => prev.map((row) => (row.day >= 1 && row.day <= 5 ? { ...row, isOpen: monday.isOpen, openTime: monday.openTime, closeTime: monday.closeTime } : row)));
    markDirty();
    toast({ title: "Monday's hours applied to Tue–Fri", variant: 'info' });
  };

  const handleSave = async () => {
    const invalid = schedule.find((row) => row.isOpen && row.closeTime <= row.openTime);
    if (invalid) {
      toast({ title: 'Check your hours', description: `${DAY_LABELS[invalid.day]}'s close time must be after its open time.`, variant: 'error' });
      return;
    }

    setIsSaving(true);
    try {
      await updateBusinessHours({ enabled, timezone, schedule, closedMessage: closedMessage.trim() || undefined });
      toast({ title: 'Business hours saved', variant: 'success' });
      setIsDirty(false);
    } catch (err) {
      toast({ title: 'Could not save business hours', description: (err as Error).message, variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || schedule.length === 0) {
    return (
      <div>
        <PageHeader title="Business Hours" breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'Business Hours' }]} />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Business Hours"
        description="When your team is open — every lead that arrives outside these hours is quietly flagged so it doesn't get missed."
        breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'Business Hours' }]}
        actions={
          <Button variant="primary" onClick={handleSave} isLoading={isSaving} disabled={!isDirty}>
            Save Changes
          </Button>
        }
      />

      <div className="flex flex-col gap-5">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <Toggle
              label="Enable Business Hours"
              description="When off, every lead is treated as arriving during business hours — nothing is flagged."
              checked={enabled}
              onChange={(v) => { setEnabled(v); markDirty(); }}
            />
            <Select
              label="Timezone"
              value={timezone}
              onChange={(e) => { setTimezone(e.target.value); markDirty(); }}
              options={TIMEZONE_OPTIONS}
              wrapperClassName="w-64"
            />
          </div>
        </Card>

        <Card padded={false}>
          <div className="flex items-center justify-between gap-3 p-5 pb-0">
            <CardHeader title="Weekly Schedule" subtitle="Turn a day off entirely, or set when it opens and closes." />
            <Button variant="ghost" size="sm" leftIcon={<Copy size={13} />} onClick={applyToWeekdays} className="mb-4">
              Copy Monday to Tue–Fri
            </Button>
          </div>

          <div className="divide-y divide-line border-t border-line">
            {DISPLAY_ORDER.map((day) => {
              const row = schedule.find((r) => r.day === day);
              if (!row) return null;
              return (
                <div key={day} className={cn('flex flex-wrap items-center gap-4 px-5 py-3.5', !enabled && 'opacity-60')}>
                  <div className="flex w-40 shrink-0 items-center gap-3">
                    <Toggle
                      label={`${DAY_LABELS[day]} open`}
                      showLabel={false}
                      checked={row.isOpen}
                      onChange={(v) => updateDay(day, { isOpen: v })}
                      disabled={!enabled}
                    />
                    <span className="text-sm font-medium text-ink">{DAY_LABELS[day]}</span>
                  </div>

                  {row.isOpen ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        aria-label={`${DAY_LABELS[day]} open time`}
                        value={row.openTime}
                        disabled={!enabled}
                        onChange={(e) => updateDay(day, { openTime: e.target.value })}
                        className={TIME_INPUT_CLASS}
                      />
                      <span className="text-xs text-ink-faint">to</span>
                      <input
                        type="time"
                        aria-label={`${DAY_LABELS[day]} close time`}
                        value={row.closeTime}
                        disabled={!enabled}
                        onChange={(e) => updateDay(day, { closeTime: e.target.value })}
                        className={TIME_INPUT_CLASS}
                      />
                    </div>
                  ) : (
                    <span className="text-sm text-ink-faint">Closed all day</span>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader title="Outside Business Hours" subtitle="Shown on the lead when it arrives while the office is marked closed." />
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="closed-message" className="text-sm font-medium text-ink">
                Note for your team
              </label>
              <textarea
                id="closed-message"
                rows={2}
                value={closedMessage}
                onChange={(e) => { setClosedMessage(e.target.value); markDirty(); }}
                placeholder="e.g. Follow up first thing tomorrow morning."
                disabled={!enabled}
                className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors hover:border-ink-faint focus-ring disabled:cursor-not-allowed disabled:bg-surface-muted"
              />
            </div>
            <p className="flex items-start gap-2 rounded-lg bg-surface-subtle px-3 py-2.5 text-xs text-ink-muted">
              <Info size={14} className="mt-0.5 shrink-0 text-ink-faint" />
              This only adds an "Outside Business Hours" badge to the lead (visible on the lead list and detail page) — it never
              delays creating the lead, and no message is sent to the visitor or the assignee.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
