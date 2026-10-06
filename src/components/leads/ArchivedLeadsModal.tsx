import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { CardSkeleton } from '../ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { formatDateTime } from '../../utils/format';
import { listArchivedLeads, restoreLead } from '../../services/leadService';

/** Leads that were deleted, which are only archived: nothing is lost, and each can be brought back. */
export function ArchivedLeadsModal({ onClose, onRestored }: { onClose: () => void; onRestored: () => void }) {
  const { toast } = useToast();
  const [reload, setReload] = useState(0);
  const { data } = useAsync(() => listArchivedLeads(), [reload]);
  const restore = async (id: string, name: string) => {
    try { await restoreLead(id); toast({ title: `${name} restored`, variant: 'success' }); setReload((k) => k + 1); onRestored(); }
    catch (e) { toast({ title: 'Could not restore it', description: (e as Error).message, variant: 'error' }); }
  };
  return (
    <Modal isOpen onClose={onClose} size="lg" title="Archived leads" footer={<Button variant="outline" onClick={onClose}>Close</Button>}>
      {!data ? <CardSkeleton /> : data.length === 0 ? <EmptyState title="Nothing archived" description="A deleted lead appears here, and can be restored." /> : (
        <ul className="divide-y divide-line">
          {data.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span><span className="font-medium text-ink">{l.name}</span> <span className="text-ink-muted">· {l.phone} · archived {formatDateTime(l.archivedAt)}</span></span>
              <Button variant="outline" size="sm" onClick={() => restore(l.id, l.name)}>Restore</Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
