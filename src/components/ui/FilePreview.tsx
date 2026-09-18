import { useState } from 'react';
import { Eye, EyeOff, FileText } from 'lucide-react';
import { Modal } from './Modal';
import { fileUrl } from '../../services/apiClient';
import { cn } from '../../utils/cn';

interface FilePreviewProps {
  label: string;
  url: string;
  sensitive?: boolean;
  className?: string;
}

export function FilePreview({ label, url, sensitive, className }: FilePreviewProps) {
  const [revealed, setRevealed] = useState(!sensitive);
  const [zoomed, setZoomed] = useState(false);

  return (
    <div className={cn('overflow-hidden rounded-lg border border-line', className)}>
      <div className="relative flex h-32 items-center justify-center bg-surface-subtle">
        {revealed ? (
          <button type="button" onClick={() => setZoomed(true)} className="h-full w-full focus-ring">
            <img src={fileUrl(url)} alt={label} className="h-full w-full object-cover" />
          </button>
        ) : (
          <div className="flex flex-col items-center gap-1 text-ink-faint">
            <FileText size={22} />
            <span className="text-xs">Protected document</span>
          </div>
        )}
        {sensitive && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-[11px] font-medium text-ink-muted shadow-card hover:bg-white focus-ring"
          >
            {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
            {revealed ? 'Hide' : 'View'}
          </button>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-line px-2.5 py-1.5">
        <span className="text-xs font-medium text-ink-muted">{label}</span>
        {sensitive && <span className="text-[10px] font-medium uppercase tracking-wide text-warning-600">Sensitive</span>}
      </div>
      {zoomed && (
        <Modal isOpen={zoomed} onClose={() => setZoomed(false)} title={label} size="lg">
          <img src={fileUrl(url)} alt={label} className="w-full rounded-lg" />
        </Modal>
      )}
    </div>
  );
}
