import { useRef, useState } from 'react';
import { Camera, MapPin, X } from 'lucide-react';
import { cn } from '../../utils/cn';

/**
 * Photos that carry the time and place they were taken.
 *
 * Each photo is stamped at the moment it is added, with the device's clock and location, and is
 * refused if the location cannot be read — the same rule the server enforces, so a photo with no
 * stamp never gets as far as being sent. On a phone the picker opens the camera; a desktop browser
 * cannot be stopped from offering files, which is why the server also requires the stamp.
 */
export interface StampedPhoto {
  file: File;
  takenAt: string;
  latitude: number;
  longitude: number;
}

function locate(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This device cannot share its location.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => reject(new Error('Allow location access — every site photo is stamped with where it was taken.')),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 }
    );
  });
}

export function StampedPhotos({
  label, name, photos, onChange, max = 3,
}: { label: string; name: string; photos: StampedPhoto[]; onChange: (next: StampedPhoto[]) => void; max?: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(undefined);
    setBusy(true);
    try {
      const where = await locate();
      const takenAt = new Date().toISOString();
      const next = [...photos, ...Array.from(files).map((file) => ({ file, takenAt, ...where }))].slice(0, max);
      onChange(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div>
      <p className="text-sm font-medium text-ink" id={`${name}-label`}>{label}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {photos.map((p, i) => (
          <span key={i} className="relative">
            <img src={URL.createObjectURL(p.file)} alt={`${label} ${i + 1}`} className="h-16 w-20 rounded-lg border border-line object-cover" />
            <span className="absolute inset-x-0 bottom-0 flex items-center gap-0.5 rounded-b-lg bg-black/60 px-1 text-[9px] text-white"><MapPin size={8} />{p.latitude.toFixed(3)},{p.longitude.toFixed(3)}</span>
            <button type="button" aria-label={`Remove ${label} ${i + 1}`} onClick={() => onChange(photos.filter((_, j) => j !== i))}
              className="absolute -right-1.5 -top-1.5 rounded-full border border-line bg-surface p-0.5 focus-ring"><X size={11} /></button>
          </span>
        ))}
        {photos.length < max && (
          <button type="button" disabled={busy} onClick={() => input.current?.click()} aria-labelledby={`${name}-label`}
            className={cn('flex h-16 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong text-xs text-ink-muted hover:border-brand-400 focus-ring', busy && 'opacity-60')}>
            <Camera size={16} />{busy ? 'Locating…' : 'Take photo'}
          </button>
        )}
        <input ref={input} id={name} name={name} type="file" accept="image/*" capture="environment" multiple className="sr-only" tabIndex={-1} onChange={(e) => void add(e.target.files)} />
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-danger-700">{error}</p>}
    </div>
  );
}

/** Appends photos and their stamps to a form the way the server's material/progress endpoints expect. */
export function appendStamped(form: FormData, field: string, photos: StampedPhoto[]) {
  photos.forEach((p) => form.append(field, p.file));
  return photos.map((p) => ({ taken_at: p.takenAt, latitude: p.latitude, longitude: p.longitude }));
}
