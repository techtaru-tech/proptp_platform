import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { ACCEPT_DOCUMENT, ACCEPT_MEDIA, FileUploadField, FileUploadList } from '../../components/ui/FileUpload';
import { amenityOptions, propertyTypeOptions } from '../../services/projectService';
import type { Project, ProjectCertificateFile, ProjectStatus } from '../../types';

export interface ProjectFormValues {
  projectName: string;
  projectType: string;
  projectLocation: string;
  landArea: string;
  projectPrice: string;
  projectDescription: string;
  status: ProjectStatus;
  sortOrder: number;
  banner: string;
  thumbnail: string;
  map: string;
  googleLocation: string;
  distanceMap: string;
  d3ViewLink: string;
  d3WalkthroughLink: string;
  amenityIds: string[];
  jdaCertificates: ProjectCertificateFile[];
  reraCertificates: ProjectCertificateFile[];
  constructionPhotographs: ProjectCertificateFile[];
}

export function defaultProjectFormValues(): ProjectFormValues {
  return {
    projectName: '',
    projectType: '',
    projectLocation: '',
    landArea: '',
    projectPrice: '',
    projectDescription: '',
    status: 1,
    sortOrder: 0,
    banner: '',
    thumbnail: '',
    map: '',
    googleLocation: '',
    distanceMap: '',
    d3ViewLink: '',
    d3WalkthroughLink: '',
    amenityIds: [],
    jdaCertificates: [],
    reraCertificates: [],
    constructionPhotographs: [],
  };
}

export function projectToFormValues(project: Project): ProjectFormValues {
  return {
    projectName: project.projectName,
    projectType: project.projectType ?? '',
    projectLocation: project.projectLocation,
    landArea: project.landArea,
    projectPrice: project.projectPrice ?? '',
    projectDescription: project.projectDescription,
    status: project.status,
    sortOrder: project.sortOrder,
    banner: project.banner ?? '',
    thumbnail: project.thumbnail ?? '',
    map: project.map ?? '',
    googleLocation: project.googleLocation ?? '',
    distanceMap: project.distanceMap ?? '',
    d3ViewLink: project.d3ViewLink ?? '',
    d3WalkthroughLink: project.d3WalkthroughLink ?? '',
    amenityIds: project.amenityIds,
    jdaCertificates: project.jdaCertificates,
    reraCertificates: project.reraCertificates,
    constructionPhotographs: project.constructionPhotographs,
  };
}

export function validateProjectForm(values: ProjectFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.projectName.trim()) errors.projectName = 'Project name is required.';
  if (!values.projectLocation.trim()) errors.projectLocation = 'Location is required.';
  if (!values.landArea.trim()) errors.landArea = 'Land area is required.';
  if (!values.projectDescription.trim()) errors.projectDescription = 'Description is required.';
  return errors;
}

interface FieldsProps {
  values: ProjectFormValues;
  errors: Record<string, string>;
  onChange: (patch: Partial<ProjectFormValues>) => void;
}

export function ProjectBasicInfoFields({ values, errors, onChange }: FieldsProps) {
  const typeOptions = [{ value: '', label: 'Select a type' }, ...propertyTypeOptions().map((t) => ({ value: t.name, label: t.name }))];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Input
        label="Project name"
        required
        value={values.projectName}
        onChange={(e) => onChange({ projectName: e.target.value })}
        error={errors.projectName}
        placeholder="e.g. Shree Ram Elysium"
        wrapperClassName="sm:col-span-2"
      />
      <Select
        label="Project type"
        value={values.projectType}
        onChange={(e) => onChange({ projectType: e.target.value })}
        options={typeOptions}
      />
      <Input
        label="Land area"
        required
        value={values.landArea}
        onChange={(e) => onChange({ landArea: e.target.value })}
        error={errors.landArea}
        placeholder="e.g. 5 Acres"
      />
      <Input
        label="Location"
        required
        value={values.projectLocation}
        onChange={(e) => onChange({ projectLocation: e.target.value })}
        error={errors.projectLocation}
        placeholder="e.g. Vesu, Surat"
        wrapperClassName="sm:col-span-2"
      />
      <Input
        label="Starting price"
        value={values.projectPrice}
        onChange={(e) => onChange({ projectPrice: e.target.value })}
        placeholder="e.g. ₹25 Lakh onwards"
      />
      <Input
        label="Sort order"
        type="number"
        min={0}
        value={values.sortOrder || ''}
        onChange={(e) => onChange({ sortOrder: Number(e.target.value) })}
      />
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label htmlFor="project-description" className="text-sm font-medium text-ink">
          Description<span className="text-accent-600"> *</span>
        </label>
        <textarea
          id="project-description"
          required
          rows={4}
          value={values.projectDescription}
          onChange={(e) => onChange({ projectDescription: e.target.value })}
          placeholder="Describe the project — architecture, positioning, highlights..."
          className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors focus-ring ${
            errors.projectDescription ? 'border-danger-500' : 'border-line-strong hover:border-ink-faint'
          }`}
        />
        {errors.projectDescription && <p className="text-xs text-danger-600">{errors.projectDescription}</p>}
      </div>
    </div>
  );
}

export function ProjectMediaFields({ values, onChange }: Omit<FieldsProps, 'errors'>) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FileUploadField
          label="Banner image"
          value={values.banner}
          onChange={(banner) => onChange({ banner: banner ?? '' })}
          hint="Shown as the main hero image on the project page."
          wrapperClassName="sm:col-span-2"
        />
        <FileUploadField label="Thumbnail image" value={values.thumbnail} onChange={(thumbnail) => onChange({ thumbnail: thumbnail ?? '' })} />
        <FileUploadField label="Site map image" value={values.map} onChange={(map) => onChange({ map: map ?? '' })} />
        <FileUploadField label="Distance map image" value={values.distanceMap} onChange={(distanceMap) => onChange({ distanceMap: distanceMap ?? '' })} />
      </div>
      {/* These three are links to somewhere else on the web, not files we host — they stay typed. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Google location (map link)"
          value={values.googleLocation}
          onChange={(e) => onChange({ googleLocation: e.target.value })}
          placeholder="https://maps.google.com/..."
        />
        <Input label="3D view link" value={values.d3ViewLink} onChange={(e) => onChange({ d3ViewLink: e.target.value })} placeholder="https://..." />
        <Input
          label="3D walkthrough link"
          value={values.d3WalkthroughLink}
          onChange={(e) => onChange({ d3WalkthroughLink: e.target.value })}
          placeholder="https://..."
        />
      </div>
    </div>
  );
}

/**
 * Certificates are stored as `{ id, file }` rows but edited as a plain list of URLs, so the
 * shared uploader handles them like every other file set. Existing rows keep their id;
 * newly uploaded ones get a temporary one until the server assigns the real one on save.
 */
function CertificateList({
  label,
  accept,
  items,
  onChange,
}: {
  label: string;
  accept?: string;
  items: ProjectCertificateFile[];
  onChange: (items: ProjectCertificateFile[]) => void;
}) {
  return (
    <FileUploadList
      label={label}
      accept={accept}
      values={items.map((i) => i.file)}
      onChange={(urls) =>
        onChange(urls.map((file) => items.find((i) => i.file === file) ?? { id: `NEW-${file}`, file }))
      }
    />
  );
}

export function ProjectCertificateFields({ values, onChange }: Omit<FieldsProps, 'errors'>) {
  return (
    <div className="space-y-5">
      <CertificateList label="JDA certificates" accept={ACCEPT_DOCUMENT} items={values.jdaCertificates} onChange={(jdaCertificates) => onChange({ jdaCertificates })} />
      <CertificateList label="RERA certificates" accept={ACCEPT_DOCUMENT} items={values.reraCertificates} onChange={(reraCertificates) => onChange({ reraCertificates })} />
      <CertificateList
        label="Construction photographs"
        accept={ACCEPT_MEDIA}
        items={values.constructionPhotographs}
        onChange={(constructionPhotographs) => onChange({ constructionPhotographs })}
      />
    </div>
  );
}

export function ProjectMetadataFields({ values, onChange }: Omit<FieldsProps, 'errors'>) {
  const toggleAmenity = (id: string) => {
    const next = values.amenityIds.includes(id) ? values.amenityIds.filter((v) => v !== id) : [...values.amenityIds, id];
    onChange({ amenityIds: next });
  };

  return (
    <div className="space-y-5">
      <div>
        <span className="mb-2 block text-sm font-medium text-ink">Amenities</span>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {amenityOptions().map((opt) => (
            <label key={opt.id} className="flex items-center gap-2 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={values.amenityIds.includes(opt.id)}
                onChange={() => toggleAmenity(opt.id)}
                className="h-4 w-4 rounded border-line-strong text-brand-600 focus-ring"
              />
              {opt.name}
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Status"
          value={String(values.status)}
          onChange={(e) => onChange({ status: Number(e.target.value) as Project['status'] })}
          options={[
            { value: '1', label: 'Active' },
            { value: '0', label: 'Deactive' },
          ]}
        />
      </div>
    </div>
  );
}
