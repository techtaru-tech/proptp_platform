import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { FileUploadField } from '../../components/ui/FileUpload';
import { Button } from '../../components/ui/Button';
import { Toggle } from '../../components/ui/Toggle';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { getOrganizationSettings, updateOrganizationSettings, type OrganizationSettings as OrgSettingsType } from '../../services/settingsService';

export function OrganizationSettings() {
  const { toast } = useToast();
  const { data, isLoading } = useAsync(() => getOrganizationSettings(), []);
  const [values, setValues] = useState<OrgSettingsType | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setValues(data);
  }, [data]);

  const patch = (p: Partial<OrgSettingsType>) => setValues((prev) => (prev ? { ...prev, ...p } : prev));

  const handleSave = async () => {
    if (!values) return;
    setSaving(true);
    try {
      const before = data;
      await updateOrganizationSettings(values);
      toast({ title: 'Organization settings saved', variant: 'success' });
      // Every amount on screen changes with this, so start the page again rather than half-update it.
      if (before && (before.pointsEnabled !== values.pointsEnabled || before.pointsPerRupee !== values.pointsPerRupee)) window.location.reload();
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !values) {
    return (
      <div>
        <PageHeader title="Organization Settings" breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'Organization' }]} />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Organization Settings"
        description="Company information shown across the admin panel and partner-facing communications."
        breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'Organization' }]}
      />

      <Card className="mb-5">
        <CardHeader title="Points" subtitle="Show every amount in the panel as points instead of rupees." />
        <div className="flex flex-col gap-4">
          <Toggle label="Show money as points" checked={values.pointsEnabled} onChange={(v) => patch({ pointsEnabled: v })}
            description="On: collections, bookings, prices, payouts and every other amount read in points. Nothing stored changes; turn it off and rupees are back." />
          {values.pointsEnabled && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="Points for ₹1" name="pointsPerRupee" type="number" min={0} step="any" value={values.pointsPerRupee} onChange={(e) => patch({ pointsPerRupee: Number(e.target.value) })} hint="10 means 10 points = ₹1, so ₹9 Cr is shown as 90 Cr pts." />
              <p className="self-end rounded-lg bg-surface-subtle px-3 py-2.5 text-sm text-ink-muted">₹1,00,000 will read as <strong className="text-ink">{(100000 * (values.pointsPerRupee || 0)).toLocaleString('en-IN')} pts</strong>.</p>
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end border-t border-line pt-5">
          <Button variant="primary" onClick={handleSave} isLoading={saving}>Save Changes</Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Company Information" subtitle="Logo, name and contact details" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Company name" required value={values.companyName} onChange={(e) => patch({ companyName: e.target.value })} wrapperClassName="sm:col-span-2" />
          <FileUploadField
            label="Company logo"
            value={values.logoUrl}
            onChange={(logoUrl) => patch({ logoUrl: logoUrl ?? '' })}
            wrapperClassName="sm:col-span-2"
          />
          <Input label="Contact email" type="email" value={values.contactEmail} onChange={(e) => patch({ contactEmail: e.target.value })} />
          <Input label="Contact phone" value={values.contactPhone} onChange={(e) => patch({ contactPhone: e.target.value })} />
          <Input label="Address" value={values.address} onChange={(e) => patch({ address: e.target.value })} wrapperClassName="sm:col-span-2" />
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
