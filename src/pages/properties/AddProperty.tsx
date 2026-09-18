import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { useToast } from '../../context/ToastContext';
import { createUnit } from '../../services/projectService';
import { refProjects } from '../../data/referenceData';
import {
  UnitBasicInfoFields,
  UnitPlotFacingFields,
  UnitMediaFields,
  UnitPricingFields,
  UnitAmenityFields,
  defaultUnitFormValues,
  validateUnitForm,
  type UnitFormValues,
} from '../projects/UnitForm';

const PROJECT_OPTIONS = [
  { value: '', label: 'Select a project' },
  ...refProjects.map((p) => ({ value: p.id, label: p.projectName })),
];

export function AddProperty() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [projectId, setProjectId] = useState('');
  const [projectError, setProjectError] = useState('');
  const [values, setValues] = useState<UnitFormValues>(defaultUnitFormValues());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const patch = (p: Partial<UnitFormValues>) => setValues((prev) => ({ ...prev, ...p }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const validationErrors = validateUnitForm(values);
    setErrors(validationErrors);
    setProjectError(projectId ? '' : 'Project is required.');
    if (Object.keys(validationErrors).length > 0 || !projectId) {
      toast({ title: 'Check the form', description: 'Some required fields are missing or invalid.', variant: 'error' });
      return;
    }

    setIsSubmitting(true);
    try {
      const unit = await createUnit(projectId, {
        propertyTitle: values.propertyTitle.trim(),
        propertyNumber: values.propertyNumber.trim(),
        propertyType: values.propertyType,
        addressId: values.addressId || undefined,
        location: values.location.trim() || undefined,
        amenityIds: values.amenityIds,
        isCorner: values.isCorner,
        constructedArea: values.constructedArea.trim() || undefined,
        width: values.width.trim() || undefined,
        length: values.length.trim() || undefined,
        details: values.details.trim() || undefined,
        thumbnail: values.thumbnail.trim() || undefined,
        images: values.images,
        isFeatured: values.isFeatured,
        plotFacings: values.plotFacings.filter((f) => f.key.trim() && f.value.trim()),
        sitePlan: values.sitePlan.trim() || undefined,
        propertyArea: values.propertyArea.trim(),
        propertyMeasurement: values.propertyMeasurement,
        perAreaAmount: values.perAreaAmount,
        perAreaProfit: values.perAreaProfit,
        totalInvestmentAmount: values.totalInvestmentAmount,
        profit: values.profit,
        bookingStatus: values.bookingStatus,
        status: values.status,
      });
      toast({ title: 'Property created', description: `${unit.propertyTitle} has been added successfully.`, variant: 'success' });
      navigate('/properties');
    } catch (err) {
      toast({
        title: 'Failed to create property',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader title="Add Property" description="Create a new property/unit and assign it to a project." />

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <Card>
          <CardHeader title="Project" subtitle="Every property belongs to exactly one project." />
          <Select
            label="Project"
            required
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            options={PROJECT_OPTIONS}
            error={projectError}
          />
        </Card>

        <Card>
          <CardHeader title="Basic Information" subtitle="Core property details." />
          <UnitBasicInfoFields values={values} errors={errors} onChange={patch} />
        </Card>

        <Card>
          <CardHeader title="Plot Facing" subtitle="Optional key/value facing details (e.g. Facing: North)." />
          <UnitPlotFacingFields values={values} onChange={patch} />
        </Card>

        <Card>
          <CardHeader title="Media" subtitle="Thumbnail, site plan and gallery images." />
          <UnitMediaFields values={values} onChange={patch} />
        </Card>

        <Card>
          <CardHeader title="Pricing & Status" subtitle="Deposit amount, commission and availability." />
          <UnitPricingFields values={values} errors={errors} onChange={patch} />
        </Card>

        <Card>
          <CardHeader title="Amenities" subtitle="Amenities available at this property." />
          <UnitAmenityFields values={values} errors={errors} onChange={patch} />
        </Card>

        <div className="flex justify-end gap-2.5">
          <Button type="button" variant="outline" onClick={() => navigate('/properties')}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isSubmitting}>
            Save Property
          </Button>
        </div>
      </form>
    </div>
  );
}
