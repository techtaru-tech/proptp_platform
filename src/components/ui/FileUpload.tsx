import { useId, useRef, useState, type ReactNode } from 'react';
import { FileText, Plus, Trash2, Upload } from 'lucide-react';
import { Button } from './Button';
import { fileUrl, uploadFiles } from '../../services/apiClient';
import { cn } from '../../utils/cn';

/**
 * The single way a file gets onto a record from the admin panel: pick it from the machine,
 * it uploads immediately, and the stored value is the root-relative URL the server returns.
 * No screen asks anyone to paste a URL.
 */

/** Mirrors the server's MIME allowlist (services/upload.ts) so the picker cannot offer a file it will reject. */
export const ACCEPT_IMAGE = 'image/jpeg,image/png,image/webp,image/heic';
export const ACCEPT_DOCUMENT = `${ACCEPT_IMAGE},application/pdf`;
export const ACCEPT_MEDIA = `${ACCEPT_DOCUMENT},video/mp4`;

const MAX_BYTES = 15 * 1024 * 1024;

function isImage(url: string) {
  return !/\.(pdf|mp4)$/i.test(url);
}

/** Rejects anything the server would reject anyway, but without the round trip. */
function tooLarge(files: File[]) {
  const over = files.find((f) => f.size > MAX_BYTES);
  return over ? `${over.name} is larger than 15 MB.` : null;
}

function Thumb({ url, alt, className }: { url: string; alt: string; className?: string }) {
  if (!isImage(url)) {
    return (
      <span className={cn('flex items-center justify-center rounded-md bg-surface-subtle text-ink-faint', className)}>
        <FileText size={18} />
      </span>
    );
  }
  return <img src={fileUrl(url)} alt={alt} className={cn('rounded-md border border-line object-cover', className)} />;
}

interface FileUploadFieldProps {
  label: string;
  value?: string | null;
  onChange: (url: string | undefined) => void;
  accept?: string;
  hint?: string;
  required?: boolean;
  /** Rendered instead of the default square thumbnail — used by the avatar and logo pickers. */
  preview?: (url: string | undefined) => ReactNode;
  wrapperClassName?: string;
}

/** One file on a record — a banner, a site map, a logo, an avatar. */
export function FileUploadField({
  label, value, onChange, accept = ACCEPT_IMAGE, hint, required, preview, wrapperClassName,
}: FileUploadFieldProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const sizeError = tooLarge([file]);
    if (sizeError) return setError(sizeError);
    setError(null);
    setBusy(true);
    try {
      const [url] = await uploadFiles([file]);
      onChange(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
        {required && <span className="text-accent-600"> *</span>}
      </label>
      <div className="flex items-center gap-3">
        {preview ? preview(value ?? undefined) : value ? <Thumb url={value} alt={label} className="h-14 w-20 shrink-0" /> : null}
        <input ref={inputRef} id={inputId} type="file" accept={accept} className="sr-only" onChange={(e) => pick(e.target.files)} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          isLoading={busy}
          leftIcon={<Upload size={14} />}
          onClick={() => inputRef.current?.click()}
        >
          {value ? 'Replace' : 'Upload'}
        </Button>
        {value && !busy && (
          <Button type="button" variant="ghost" size="sm" className="text-danger-600 hover:bg-danger-50" onClick={() => onChange(undefined)}>
            Remove
          </Button>
        )}
      </div>
      {error ? <p className="text-xs text-danger-600">{error}</p> : hint ? <p className="text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

interface FileUploadListProps {
  label: string;
  values: string[];
  onChange: (urls: string[]) => void;
  accept?: string;
  hint?: string;
  emptyText?: string;
}

/** A growing set of files on a record — gallery images, certificates, construction photos. */
export function FileUploadList({
  label, values, onChange, accept = ACCEPT_DOCUMENT, hint, emptyText = 'No files uploaded yet.',
}: FileUploadListProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    const sizeError = tooLarge(files);
    if (sizeError) return setError(sizeError);
    setError(null);
    setBusy(true);
    try {
      onChange([...values, ...(await uploadFiles(files))]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-sm font-medium text-ink">{label}</span>
        <input ref={inputRef} type="file" accept={accept} multiple className="sr-only" onChange={(e) => pick(e.target.files)} />
        <Button type="button" variant="outline" size="sm" isLoading={busy} leftIcon={<Plus size={14} />} onClick={() => inputRef.current?.click()}>
          Upload Files
        </Button>
      </div>
      {values.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong px-4 py-6 text-center hover:border-ink-faint focus-ring"
        >
          <Upload size={18} className="text-ink-faint" />
          <p className="text-xs text-ink-faint">{emptyText} Click to choose from your computer.</p>
        </button>
      ) : (
        <div className="flex flex-wrap gap-3">
          {values.map((url, i) => (
            <div key={`${url}-${i}`} className="flex items-center gap-2 rounded-lg border border-line p-2">
              <Thumb url={url} alt={`${label} ${i + 1}`} className="h-14 w-14 shrink-0" />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove file"
                onClick={() => onChange(values.filter((_, idx) => idx !== i))}
                className="shrink-0 text-danger-600 hover:bg-danger-50"
              >
                <Trash2 size={15} />
              </Button>
            </div>
          ))}
        </div>
      )}
      {error ? <p className="mt-1.5 text-xs text-danger-600">{error}</p> : hint ? <p className="mt-1.5 text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}
