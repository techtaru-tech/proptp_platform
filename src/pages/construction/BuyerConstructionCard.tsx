import { useState } from 'react';
import { HardHat, Send } from 'lucide-react';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Textarea } from '../../components/ui/Textarea';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { usePermissions } from '../../app/usePermissions';
import { formatDateTime } from '../../utils/format';
import { getBuyerStatus, sendBuyerStatus } from '../../services/constructionService';
import { BehindBadge, PlanVsActual } from './PlanVsActual';

/** On a booking: how far the buyer's project has actually got, and a ready-to-send update. */
export function BuyerConstructionCard({ bookingId }: { bookingId: string }) {
  const { can } = usePermissions();
  const { toast } = useToast();
  const [reload, setReload] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const { data } = useAsync(() => (can('construction') ? getBuyerStatus(bookingId) : Promise.resolve(undefined)), [bookingId, reload]);
  if (!data) return null;

  const text = message ?? data.message;
  const send = async () => {
    try {
      const { whatsappUrl } = await sendBuyerStatus(bookingId, text);
      window.open(whatsappUrl, '_blank', 'noopener');
      setMessage(null);
      setReload((k) => k + 1);
    } catch (err) {
      toast({ title: 'Could not prepare the update', description: (err as Error).message, variant: 'error' });
    }
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Construction status" subtitle={`${data.projectName} · plot ${data.unit}`} action={<HardHat size={16} className="text-ink-faint" />} />
      {data.summary.activities === 0 ? (
        <p className="text-sm text-ink-muted">The construction schedule for this project has not been set up yet.</p>
      ) : (
        <>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="tabular-nums text-ink">{data.summary.actual}% complete <span className="text-ink-faint">/ plan {data.summary.planned}%</span></span>
            <BehindBadge days={data.summary.daysBehind} />
          </div>
          <PlanVsActual planned={data.summary.planned} actual={data.summary.actual} />
        </>
      )}
      <div className="mt-4">
        <Textarea label="Message to the buyer" id="buyerProgressMessage" value={text} onChange={setMessage} rows={3} />
        <div className="mt-2 flex justify-end">
          <Button variant="outline" leftIcon={<Send size={14} />} onClick={send}>Send on WhatsApp</Button>
        </div>
      </div>
      {data.history.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-ink-muted">
          {data.history.map((h) => <li key={h.id}>Sent {formatDateTime(h.createdAt)} — {h.message}</li>)}
        </ul>
      )}
    </Card>
  );
}
