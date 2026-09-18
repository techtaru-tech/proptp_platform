import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../context/ToastContext';
import { createProject } from '../../services/projectService';
import {
  ProjectBasicInfoFields,
  ProjectMediaFields,
  ProjectMetadataFields,
  ProjectCertificateFields,
  defaultProjectFormValues,
  validateProjectForm,
  type ProjectFormValues,
} from './ProjectForm';

export function AddProject() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [values, setValues] = useState<ProjectFormValues>(defaultProjectFormValues());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const patch = (p: Partial<ProjectFormValues>) => setValues((prev) => ({ ...prev, ...p }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const validationErrors = validateProjectForm(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      toast({ title: 'Check the form', description: 'Some required fields are missing or invalid.', variant: 'error' });
      return;
    }

    setIsSubmitting(true);
    try {
      const project = await createProject({
        projectName: values.projectName.trim(),
        projectType: values.projectType.trim() || undefined,
        projectLocation: values.projectLocation.trim(),
        landArea: values.landArea.trim(),
        projectPrice: values.projectPrice.trim() || undefined,
        projectDescription: values.projectDescription.trim(),
        status: values.status,
        sortOrder: values.sortOrder,
        banner: values.banner.trim() || undefined,
        thumbnail: values.thumbnail.trim() || undefined,
        map: values.map.trim() || undefined,
        googleLocation: values.googleLocation.trim() || undefined,
        distanceMap: values.distanceMap.trim() || undefined,
        d3ViewLink: values.d3ViewLink.trim() || undefined,
        d3WalkthroughLink: values.d3WalkthroughLink.trim() || undefined,
        amenityIds: values.amenityIds,
        jdaCertificates: values.jdaCertificates,
        reraCertificates: values.reraCertificates,
        constructionPhotographs: values.constructionPhotographs,
      });
      toast({ title: 'Project created', description: `${project.projectName} has been added successfully.`, variant: 'success' });
      navigate(`/projects/${project.id}`);
    } catch (err) {
      toast({
        title: 'Failed to create project',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader title="Add Project" description="Create a new property listing with details, media and inventory metadata." />

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <Card>
          <CardHeader title="Basic Information" subtitle="Core details shown across listings and search." />
          <ProjectBasicInfoFields values={values} errors={errors} onChange={patch} />
        </Card>

        <Card>
          <CardHeader title="Media" subtitle="Banner image and gallery shown on the project detail page." />
          <ProjectMediaFields values={values} onChange={patch} />
        </Card>

        <Card>
          <CardHeader title="Property Metadata" subtitle="Amenities and status." />
          <ProjectMetadataFields values={values} onChange={patch} />
        </Card>

        <Card>
          <CardHeader title="Certificates" subtitle="JDA, RERA and construction photograph uploads." />
          <ProjectCertificateFields values={values} onChange={patch} />
        </Card>

        <div className="flex justify-end gap-2.5">
          <Button type="button" variant="outline" onClick={() => navigate('/projects')}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isSubmitting}>
            Save Project
          </Button>
        </div>
      </form>
    </div>
  );
}
