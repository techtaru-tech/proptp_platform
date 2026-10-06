import { useState } from 'react';
import { FileText } from 'lucide-react';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../context/ToastContext';
import { api, fileUrl } from '../../services/apiClient';

/** The cost sheet for the buyer's plot, ready to hand over. Works for any booking, confirmed or not. */
export function CostSheetCard({ bookingId }: { bookingId: string }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ url: string; filed: boolean }>(`/bookings/${bookingId}/cost-sheet`);
      window.open(fileUrl(r.url), '_blank', 'noopener');
      toast({ title: 'Cost sheet generated', description: r.filed ? 'It is also saved in the buyer’s legal file.' : 'It is not saved anywhere; generate it again any time.', variant: 'success' });
    } catch (e) {
      toast({ title: 'Could not generate the cost sheet', description: (e as Error).message, variant: 'error' });
    } finally { setBusy(false); }
  };
  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Cost sheet" subtitle="Rate, basic cost, charges, GST and registration, total, token and balance for this plot." action={<FileText size={16} className="text-ink-faint" />} />
      <Button variant="outline" size="sm" isLoading={busy} onClick={make}>Generate cost sheet</Button>
    </Card>
  );
}
