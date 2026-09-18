import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { FileUploadField } from '../../components/ui/FileUpload';
import { Button } from '../../components/ui/Button';
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
      await updateOrganizationSettings(values);
      toast({ title: 'Organization settings saved', variant: 'success' });
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
