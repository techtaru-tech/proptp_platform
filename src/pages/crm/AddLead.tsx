import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../context/ToastContext';
import { createLead } from '../../services/leadService';
import {
  LeadContactFields,
  LeadRequirementFields,
  LeadDetailsFields,
  LeadDealFields,
  defaultLeadFormValues,
  validateLeadForm,
  leadFormValuesToPayload,
  type LeadFormValues,
} from './LeadForm';
import { leadFullName } from '../../utils/format';

export function AddLead() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [values, setValues] = useState<LeadFormValues>(defaultLeadFormValues());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const patch = (p: Partial<LeadFormValues>) => setValues((prev) => ({ ...prev, ...p }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const validationErrors = validateLeadForm(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      toast({ title: 'Check the form', description: 'Some required fields are missing or invalid.', variant: 'error' });
      return;
    }

    setIsSubmitting(true);
    try {
      const lead = await createLead(leadFormValuesToPayload(values));
      toast({ title: 'Lead created', description: `${leadFullName(lead)} has been added.`, variant: 'success' });
      navigate(`/crm/leads/${lead.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Add Lead"
        description="Capture a new lead manually."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Leads', to: '/crm/leads' }, { label: 'Add Lead' }]}
      />

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <Card>
          <CardHeader title="Customer Information" subtitle="Who this lead is." />
          <LeadContactFields values={values} errors={errors} onChange={patch} />
        </Card>

        <Card>
          <CardHeader title="Requirement" subtitle="What they are looking for — the first call's questions." />
          <LeadRequirementFields values={values} errors={errors} onChange={patch} />
        </Card>

        <Card>
          <CardHeader title="Lead Information" subtitle="Source, priority, ownership and pipeline placement." />
          <LeadDetailsFields values={values} onChange={patch} isNewLead />
        </Card>

        <Card>
          <CardHeader title="Deal & Notes" subtitle="Expected value, close date and any context worth capturing." />
          <LeadDealFields values={values} errors={errors} onChange={patch} />
        </Card>

        <div className="flex justify-end gap-2.5">
          <Button type="button" variant="outline" onClick={() => navigate('/crm/leads')}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isSubmitting}>
            Save Lead
          </Button>
        </div>
      </form>
    </div>
  );
}
