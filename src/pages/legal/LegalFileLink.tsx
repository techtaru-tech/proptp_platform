import { Link } from 'react-router-dom';
import { Scale } from 'lucide-react';
import { Card, CardHeader } from '../../components/ui/Card';
import { useAsync } from '../../hooks/useAsync';
import { usePermissions } from '../../app/usePermissions';
import { legalFileForBooking, generateDoc } from '../../services/legalService';
import { fileUrl } from '../../services/apiClient';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/ui/Button';

/** On a booking: a way into the buyer's legal file, which opens automatically once it is confirmed. */
export function LegalFileLink({ bookingId }: { bookingId: string }) {
  const { can } = usePermissions();
  const { toast } = useToast();
  const { data } = useAsync(() => (can('legal') ? legalFileForBooking(bookingId) : Promise.resolve(undefined)), [bookingId]);
  if (!data) return null;
  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Legal file" subtitle="Agreement, payment plan, documents and registry for this buyer." action={<Scale size={16} className="text-ink-faint" />} />
      <div className="flex flex-wrap items-center gap-4">
        <Link to={`/legal/files/${data.id}`} className="text-sm font-medium text-brand-700 focus-ring rounded">Open the legal file →</Link>
        <Button variant="outline" size="sm" onClick={async () => {
          try { const doc = await generateDoc(data.id, { kind: 'cost_sheet' }); window.open(fileUrl(doc.url), '_blank', 'noopener'); toast({ title: 'Cost sheet generated', description: 'It is saved in the legal file too.', variant: 'success' }); }
          catch (e) { toast({ title: 'Could not generate the cost sheet', description: (e as Error).message, variant: 'error' }); }
        }}>Generate cost sheet</Button>
      </div>
    </Card>
  );
}
