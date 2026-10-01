import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { StampedPhotos, appendStamped, type StampedPhoto } from '../../components/ui/StampedPhotos';
import { useToast } from '../../context/ToastContext';
import { postStaffMaterial } from '../../services/vendorService';

/**
 * Record material received at site. Used by site staff (who pick the vendor) and by a vendor in
 * their portal (whose vendor is fixed by their login on the server). Photos of the material, the
 * challan and the vehicle are all required.
 */
export function MaterialEntryModal({
  projects, vendors, defaultReceiver = '', submit, onClose, onSaved,
}: {
  projects: { id: string; projectName: string }[];
  /** Omit for a vendor's own portal, where the vendor is implied. */
  vendors?: { id: string; name: string }[];
  defaultReceiver?: string;
  submit?: (form: FormData) => Promise<unknown>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [f, setF] = useState({
    project_id: projects[0]?.id ?? '', vendor_id: '', material_name: '', unit: '', quantity: '', challan_no: '', vehicle_no: '',
    received_by: defaultReceiver, received_on: new Date().toISOString().slice(0, 10), expected_on: '',
  });
  const [material, setMaterial] = useState<StampedPhoto[]>([]);
  const [challan, setChallan] = useState<StampedPhoto[]>([]);
  const [vehicle, setVehicle] = useState<StampedPhoto[]>([]);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const ready = f.project_id && f.material_name.trim() && f.unit.trim() && Number(f.quantity) > 0 && f.challan_no.trim() && f.vehicle_no.trim() && f.received_by.trim() && material.length && challan.length && vehicle.length;

  const save = async () => {
    setSaving(true);
    try {
      const form = new FormData();
      Object.entries(f).forEach(([k, v]) => v && form.append(k, v));
      form.append('client_id', crypto.randomUUID());
      const meta = { material: appendStamped(form, 'material_photo', material), challan: appendStamped(form, 'challan_photo', challan), vehicle: appendStamped(form, 'vehicle_photo', vehicle) };
      form.append('photo_meta', JSON.stringify(meta));
      await (submit ?? postStaffMaterial)(form);
      toast({ title: 'Material entry recorded', description: 'It adds to stock once the site engineer verifies it.', variant: 'success' });
      onSaved();
    } catch (err) {
      toast({ title: 'Could not record the entry', description: (err as Error).message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Material received at site" size="lg"
      footer={<><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={save} isLoading={saving} disabled={!ready}>Record entry</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select label="Site" name="project_id" required value={f.project_id} onChange={set('project_id')} options={projects.map((p) => ({ value: p.id, label: p.projectName }))} />
        {vendors && <Select label="Vendor" name="vendor_id" value={f.vendor_id} onChange={set('vendor_id')} options={[{ value: '', label: 'Not listed' }, ...vendors.map((v) => ({ value: v.id, label: v.name }))]} />}
        <Input label="Material" name="material_name" required value={f.material_name} onChange={set('material_name')} placeholder="e.g. Cement (OPC 53)" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Quantity" name="quantity" type="number" min={0} step="any" required value={f.quantity} onChange={set('quantity')} />
          <Input label="Unit" name="unit" required value={f.unit} onChange={set('unit')} placeholder="bags, tonnes…" />
        </div>
        <Input label="Challan / invoice no." name="challan_no" required value={f.challan_no} onChange={set('challan_no')} />
        <Input label="Vehicle number" name="vehicle_no" required value={f.vehicle_no} onChange={set('vehicle_no')} placeholder="RJ14GA1234" />
        <Input label="Received by" name="received_by" required value={f.received_by} onChange={set('received_by')} />
        <DatePicker label="Received on" name="received_on" required value={f.received_on} onChange={set('received_on')} />
        <DatePicker label="Promised for (optional)" name="expected_on" value={f.expected_on} onChange={set('expected_on')} wrapperClassName="sm:col-span-1" />
      </div>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StampedPhotos label="Material photo *" name="material_photo" photos={material} onChange={setMaterial} />
        <StampedPhotos label="Challan photo *" name="challan_photo" photos={challan} onChange={setChallan} />
        <StampedPhotos label="Vehicle photo *" name="vehicle_photo" photos={vehicle} onChange={setVehicle} />
      </div>
      <p className="mt-3 text-xs text-ink-faint">Each photo is stamped with the date, time and location when you take it.</p>
    </Modal>
  );
}
