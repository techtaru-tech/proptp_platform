import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  getNotificationSettings,
  updateNotificationSettings,
  type NotificationSettings as NotificationSettingsType,
} from '../../services/settingsService';
import { cn } from '../../utils/cn';

const TOGGLES: { key: keyof NotificationSettingsType; label: string; description: string }[] = [
  { key: 'emailAlerts', label: 'Email Alerts', description: 'Receive email notifications for important operational events.' },
  { key: 'pushAlerts', label: 'Push Alerts', description: 'Receive push notifications on supported admin devices.' },
  { key: 'dailySummary', label: 'Daily Summary', description: 'Get a daily digest of bookings, payments and attendance activity.' },
  { key: 'ticketAlerts', label: 'Ticket Alerts', description: 'Get notified when a new support ticket is raised or replied to.' },
];

export function NotificationSettings() {
  const { toast } = useToast();
  const { data, isLoading } = useAsync(() => getNotificationSettings(), []);
  const [values, setValues] = useState<NotificationSettingsType | null>(null);

  useEffect(() => {
    if (data) setValues(data);
  }, [data]);

  const toggle = async (key: keyof NotificationSettingsType) => {
    if (!values) return;
    const next = { ...values, [key]: !values[key] };
    setValues(next);
    await updateNotificationSettings({ [key]: next[key] });
    toast({ title: 'Notification preference updated', variant: 'success' });
  };

  if (isLoading || !values) {
    return (
      <div>
        <PageHeader title="Notification Settings" breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'Notifications' }]} />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Notification Settings"
        description="Configure which operational notifications the admin panel surfaces."
        breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'Notifications' }]}
      />

      <Card>
        <CardHeader title="Preferences" subtitle="Toggle notification channels on or off" />
        <div className="divide-y divide-line">
          {TOGGLES.map((t) => (
            <div key={t.key} className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
              <div>
                <p className="text-sm font-medium text-ink">{t.label}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{t.description}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={values[t.key]}
                aria-label={t.label}
                onClick={() => toggle(t.key)}
                className={cn(
                  'relative h-6 w-11 shrink-0 rounded-full transition-colors focus-ring',
                  values[t.key] ? 'bg-brand-600' : 'bg-line-strong'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-card transition-transform',
                    values[t.key] ? 'translate-x-[22px]' : 'translate-x-0.5'
                  )}
                />
              </button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
