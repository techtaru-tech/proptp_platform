import { Plus, Trash2 } from 'lucide-react';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { ACCEPT_DOCUMENT, FileUploadField, FileUploadList } from '../../components/ui/FileUpload';
import { amenityOptions, propertyTypeOptions, addressOptions } from '../../services/projectService';
import type { PlotFacing, PropertyUnit, UnitActiveStatus, UnitBookingStatus } from '../../types';

export interface UnitFormValues {
  propertyTitle: string;
  propertyNumber: string;
  propertyType: string;
  addressId: string;
  location: string;
  amenityIds: string[];
  isCorner: boolean;
  constructedArea: string;
  width: string;
  length: string;
  details: string;
  thumbnail: string;
  images: string[];
  isFeatured: boolean;
  plotFacings: PlotFacing[];
  sitePlan: string;
  propertyArea: string;
  propertyMeasurement: string;
  perAreaAmount: number;
  perAreaProfit: number;
  totalInvestmentAmount: number;
  profit: number;
  bookingStatus: UnitBookingStatus;
  status: UnitActiveStatus;
}

export function defaultUnitFormValues(): UnitFormValues {
  return {
    propertyTitle: '',
    propertyNumber: '',
    propertyType: '',
    addressId: '',
    location: '',
    amenityIds: [],
    isCorner: false,
    constructedArea: '',
    width: '',
    length: '',
    details: '',
    thumbnail: '',
    images: [],
    isFeatured: false,
    plotFacings: [],
    sitePlan: '',
    propertyArea: '',
    propertyMeasurement: 'Sq yard',
    perAreaAmount: 0,
    perAreaProfit: 0,
    totalInvestmentAmount: 0,
    profit: 0,
    bookingStatus: 0,
    status: 1,
  };
}

export function unitToFormValues(unit: PropertyUnit): UnitFormValues {
  return {
    propertyTitle: unit.propertyTitle,
    propertyNumber: unit.propertyNumber,
    propertyType: unit.propertyType,
    addressId: unit.addressId ?? '',
    location: unit.location ?? '',
    amenityIds: unit.amenityIds,
    isCorner: unit.isCorner,
    constructedArea: unit.constructedArea ?? '',
    width: unit.width ?? '',
    length: unit.length ?? '',
    details: unit.details ?? '',
    thumbnail: unit.thumbnail ?? '',
    images: unit.images,
    isFeatured: unit.isFeatured,
    plotFacings: unit.plotFacings,
    sitePlan: unit.sitePlan ?? '',
    propertyArea: unit.propertyArea,
    propertyMeasurement: unit.propertyMeasurement,
    perAreaAmount: unit.perAreaAmount,
    perAreaProfit: unit.perAreaProfit,
    totalInvestmentAmount: unit.totalInvestmentAmount,
    profit: unit.profit,
    bookingStatus: unit.bookingStatus,
    status: unit.status,
  };
}

export function unitFormValuesToPatch(values: UnitFormValues): Partial<PropertyUnit> {
  return {
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
  };
}

export function validateUnitForm(values: UnitFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.propertyTitle.trim()) errors.propertyTitle = 'Title is required.';
  if (!values.propertyNumber.trim()) errors.propertyNumber = 'Property number is required.';
  if (!values.propertyType.trim()) errors.propertyType = 'Property type is required.';
  if (!values.addressId) errors.addressId = 'Address / area is required.';
  if (values.amenityIds.length === 0) errors.amenityIds = 'Select at least one amenity.';
  if (!values.perAreaAmount || values.perAreaAmount <= 0) errors.perAreaAmount = 'Per-area amount is required.';
  if (!values.perAreaProfit || values.perAreaProfit <= 0) errors.perAreaProfit = 'Per-area profit is required.';
  return errors;
}

/** Mirrors the real create/edit form's JS: total amount & profit are auto-computed from area × per-area rate, and remain editable afterwards. */
export function recomputeUnitAmounts(values: UnitFormValues): Pick<UnitFormValues, 'totalInvestmentAmount' | 'profit'> {
  const area = Number(values.propertyArea) || 0;
  return {
    totalInvestmentAmount: Math.round(area * values.perAreaAmount),
    profit: Math.round(area * values.perAreaProfit),
  };
}

interface FieldsProps {
  values: UnitFormValues;
  errors: Record<string, string>;
  onChange: (patch: Partial<UnitFormValues>) => void;
}

export function UnitBasicInfoFields({ values, errors, onChange }: FieldsProps) {
  const typeOptions = [{ value: '', label: 'Select a type' }, ...propertyTypeOptions().map((t) => ({ value: t.name, label: t.name }))];
  const addressSelectOptions = [{ value: '', label: 'Select address / area' }, ...addressOptions().map((a) => ({ value: a.id, label: a.name }))];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Input
        label="Property title"
        required
        value={values.propertyTitle}
        onChange={(e) => onChange({ propertyTitle: e.target.value })}
        error={errors.propertyTitle}
        wrapperClassName="sm:col-span-2"
      />
      <Select label="Property type" required value={values.propertyType} onChange={(e) => onChange({ propertyType: e.target.value })} options={typeOptions} />
      <Input
        label="Property number"
        required
        hint="Enter only number"
        value={values.propertyNumber}
        onChange={(e) => onChange({ propertyNumber: e.target.value })}
        error={errors.propertyNumber}
        placeholder="e.g. A-012"
      />
      <Select
        label="Address / Area"
        required
        value={values.addressId}
        onChange={(e) => onChange({ addressId: e.target.value })}
        options={addressSelectOptions}
        error={errors.addressId}
      />
      <Input
        label="Location (embed URL)"
        value={values.location}
        onChange={(e) => onChange({ location: e.target.value })}
        hint="Only embed URL accepted"
      />
      <Input label="Constructed area" value={values.constructedArea} onChange={(e) => onChange({ constructedArea: e.target.value })} placeholder="Optional" />
      <Select
        label="Is corner"
        value={values.isCorner ? 'yes' : 'no'}
        onChange={(e) => onChange({ isCorner: e.target.value === 'yes' })}
        options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]}
      />
      <Input label="Width" value={values.width} onChange={(e) => onChange({ width: e.target.value })} />
      <Input label="Length" value={values.length} onChange={(e) => onChange({ length: e.target.value })} />
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label htmlFor="unit-details" className="text-sm font-medium text-ink">
          Details
        </label>
        <textarea
          id="unit-details"
          rows={3}
          value={values.details}
          onChange={(e) => onChange({ details: e.target.value })}
          placeholder="Describe this unit..."
          className="w-full rounded-lg border border-line-strong bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors hover:border-ink-faint focus-ring"
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-muted sm:col-span-2">
        <input type="checkbox" checked={values.isFeatured} onChange={(e) => onChange({ isFeatured: e.target.checked })} className="h-4 w-4 rounded border-line-strong text-brand-600 focus-ring" />
        Featured property
      </label>
    </div>
  );
}

export function UnitPlotFacingFields({ values, onChange }: Omit<FieldsProps, 'errors'>) {
  const addRow = () => onChange({ plotFacings: [...values.plotFacings, { key: '', value: '' }] });
  const updateRow = (i: number, patch: Partial<PlotFacing>) =>
    onChange({ plotFacings: values.plotFacings.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) });
  const removeRow = (i: number) => onChange({ plotFacings: values.plotFacings.filter((_, idx) => idx !== i) });

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-sm font-medium text-ink">Plot facing details</span>
        <Button type="button" variant="outline" size="sm" leftIcon={<Plus size={14} />} onClick={addRow}>
          Add Row
        </Button>
      </div>
      {values.plotFacings.length === 0 ? (
        <p className="text-xs text-ink-faint">No plot facing details added yet.</p>
      ) : (
        <div className="space-y-2.5">
          {values.plotFacings.map((row, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <Input wrapperClassName="flex-1" placeholder="e.g. Facing" value={row.key} onChange={(e) => updateRow(i, { key: e.target.value })} />
              <Input wrapperClassName="flex-1" placeholder="e.g. North" value={row.value} onChange={(e) => updateRow(i, { value: e.target.value })} />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove row" onClick={() => removeRow(i)} className="shrink-0 text-danger-600 hover:bg-danger-50">
                <Trash2 size={15} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function UnitMediaFields({ values, onChange }: Omit<FieldsProps, 'errors'>) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FileUploadField label="Thumbnail image" value={values.thumbnail} onChange={(thumbnail) => onChange({ thumbnail: thumbnail ?? '' })} />
        <FileUploadField
          label="Site plan file"
          accept={ACCEPT_DOCUMENT}
          value={values.sitePlan}
          onChange={(sitePlan) => onChange({ sitePlan: sitePlan ?? '' })}
          hint="Image or PDF."
        />
      </div>
      <FileUploadList
        label="Gallery images"
        values={values.images}
        onChange={(images) => onChange({ images })}
        emptyText="No gallery images added yet."
      />
    </div>
  );
}

export function UnitPricingFields({ values, errors, onChange }: FieldsProps) {
  const applyRecompute = (patch: Partial<UnitFormValues>) => {
    const next = { ...values, ...patch };
    onChange({ ...patch, ...recomputeUnitAmounts(next) });
  };

  const bookingStatusOptions = [
    { value: '0', label: 'Available' },
    { value: '1', label: 'Booked' },
    { value: '2', label: 'Sold Out' },
  ];
  const measurementOptions = [
    { value: 'Sq yard', label: 'Sq yard' },
    { value: 'Sq feet', label: 'Sq feet' },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Select label="Measurement unit" value={values.propertyMeasurement} onChange={(e) => onChange({ propertyMeasurement: e.target.value })} options={measurementOptions} />
      <Input label="Property area" type="number" min={0} step="0.01" value={values.propertyArea} onChange={(e) => applyRecompute({ propertyArea: e.target.value })} />
      <Select
        label="Booking status"
        value={String(values.bookingStatus)}
        onChange={(e) => onChange({ bookingStatus: Number(e.target.value) as UnitBookingStatus })}
        options={bookingStatusOptions}
      />
      <Input
        label="Per-area amount (₹)"
        required
        type="number"
        min={0}
        step="0.01"
        value={values.perAreaAmount || ''}
        onChange={(e) => applyRecompute({ perAreaAmount: Number(e.target.value) })}
        error={errors.perAreaAmount}
      />
      <Input
        label="Per-area profit (₹)"
        required
        type="number"
        min={0}
        step="0.01"
        value={values.perAreaProfit || ''}
        onChange={(e) => applyRecompute({ perAreaProfit: Number(e.target.value) })}
        error={errors.perAreaProfit}
      />
      <Input
        label="Total deposit amount (₹)"
        type="number"
        min={0}
        value={values.totalInvestmentAmount || ''}
        onChange={(e) => onChange({ totalInvestmentAmount: Number(e.target.value) })}
        hint="Auto-computed from area × per-area amount; editable"
      />
      <Input
        label="Total commission (₹)"
        type="number"
        min={0}
        value={values.profit || ''}
        onChange={(e) => onChange({ profit: Number(e.target.value) })}
        hint="Auto-computed from area × per-area profit; editable"
      />
      <Select
        label="Status"
        value={String(values.status)}
        onChange={(e) => onChange({ status: Number(e.target.value) as UnitActiveStatus })}
        options={[
          { value: '1', label: 'Active' },
          { value: '0', label: 'Deactive' },
        ]}
      />
    </div>
  );
}

export function UnitAmenityFields({ values, errors, onChange }: FieldsProps) {
  const toggle = (id: string) => {
    const next = values.amenityIds.includes(id) ? values.amenityIds.filter((v) => v !== id) : [...values.amenityIds, id];
    onChange({ amenityIds: next });
  };
  return (
    <div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {amenityOptions().map((opt) => (
          <label key={opt.id} className="flex items-center gap-2 text-sm text-ink-muted">
            <input type="checkbox" checked={values.amenityIds.includes(opt.id)} onChange={() => toggle(opt.id)} className="h-4 w-4 rounded border-line-strong text-brand-600 focus-ring" />
            {opt.name}
          </label>
        ))}
      </div>
      {errors.amenityIds && <p className="mt-2 text-xs text-danger-600">{errors.amenityIds}</p>}
    </div>
  );
}
