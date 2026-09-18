import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { FileUploadField } from '../../components/ui/FileUpload';
import { Button } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/Avatar';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { getAdminProfile, updateAdminProfile, type AdminProfile as AdminProfileType } from '../../services/settingsService';

export function AdminProfileSettings() {
  const { toast } = useToast();
  const { refreshSession } = useAuth();
  const { data, isLoading } = useAsync(() => getAdminProfile(), []);
  const [values, setValues] = useState<AdminProfileType | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setValues(data);
  }, [data]);

  const patch = (p: Partial<AdminProfileType>) => setValues((prev) => (prev ? { ...prev, ...p } : prev));

  const handleSave = async () => {
    if (!values) return;
    setSaving(true);
    try {
      await updateAdminProfile(values);
      // The header reads the name and photo off the session, so it has to be re-read here
      // or it keeps showing the old ones until the next full page load.
      await refreshSession();
      toast({ title: 'Profile updated', variant: 'success' });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !values) {
    return (
      <div>
        <PageHeader title="Admin Profile" breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'Admin Profile' }]} />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Admin Profile"
        description="Your administrator account details."
        breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'Admin Profile' }]}
      />

      <Card>
        <CardHeader title="Profile Information" subtitle="Name, contact details and profile photo" />
        <FileUploadField
          label="Profile photo"
          value={values.avatarUrl ?? ''}
          onChange={(avatarUrl) => patch({ avatarUrl: avatarUrl ?? '' })}
          preview={(url) => <Avatar name={values.name} src={url} size="lg" />}
          wrapperClassName="mb-5"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Full name" required value={values.name} onChange={(e) => patch({ name: e.target.value })} />
          <Input label="Email" type="email" required value={values.email} onChange={(e) => patch({ email: e.target.value })} />
          <Input label="Phone" value={values.phone} onChange={(e) => patch({ phone: e.target.value })} />
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
