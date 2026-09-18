import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/ui/PageHeader';
import { OAUTH_CAPABLE_SOURCES } from '../../types';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../context/ToastContext';
import { createConnection } from '../../services/integrationService';
import {
  ConnectionBasicFields, ConnectionOAuthSection, ConnectionCredentialFields, ConnectionFieldMappingSection, supportsFieldMapping,
  defaultConnectionFormValues, validateConnectionForm, type ConnectionFormValues,
} from './ConnectionForm';

export function AddConnection() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [values, setValues] = useState<ConnectionFormValues>(defaultConnectionFormValues());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const patch = (p: Partial<ConnectionFormValues>) => setValues((prev) => ({ ...prev, ...p }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const validationErrors = validateConnectionForm(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      toast({ title: 'Check the form', description: 'Some required fields are missing.', variant: 'error' });
      return;
    }

    setIsSubmitting(true);
    try {
      const fieldMapping = values.fieldMapping.filter((m) => m.key.trim() && m.value.trim());
      await createConnection({
        name: values.name.trim(),
        source: values.source,
        active: values.active,
        credentials: values.credentials,
        fieldMapping: fieldMapping.length > 0 ? Object.fromEntries(fieldMapping.map((m) => [m.key.trim(), m.value.trim()])) : undefined,
      });
      toast({ title: 'Connection created', description: 'Configure the webhook URL on the platform side to start receiving leads.', variant: 'success' });
      navigate('/crm/integrations');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Add Connection"
        description="Connect a new lead source to automatically bring leads into the CRM."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Integrations', to: '/crm/integrations' }, { label: 'Add Connection' }]}
      />

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <Card>
          <CardHeader title="Connection Details" subtitle="Name and source — the source cannot be changed after creation." />
          <ConnectionBasicFields values={values} errors={errors} onChange={patch} />
        </Card>

        {OAUTH_CAPABLE_SOURCES.includes(values.source) && (
          <Card>
            <CardHeader title="OAuth Authorization" />
            <ConnectionOAuthSection source={values.source} />
          </Card>
        )}

        <Card>
          <CardHeader title="API Credentials" subtitle="Stored encrypted on the backend — never re-displayed after saving." />
          <ConnectionCredentialFields values={values} errors={errors} onChange={patch} />
        </Card>

        {supportsFieldMapping(values.source) && (
          <Card>
            <ConnectionFieldMappingSection values={values} onChange={patch} />
          </Card>
        )}

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={values.active}
              onChange={(e) => patch({ active: e.target.checked })}
              className="h-4 w-4 rounded border-line-strong text-brand-600 focus-ring"
            />
            Active
          </label>
          <div className="flex gap-2.5">
            <Button type="button" variant="outline" onClick={() => navigate('/crm/integrations')}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              Save Connection
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
