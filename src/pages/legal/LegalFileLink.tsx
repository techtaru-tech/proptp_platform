import { Link } from 'react-router-dom';
import { Scale } from 'lucide-react';
import { Card, CardHeader } from '../../components/ui/Card';
import { useAsync } from '../../hooks/useAsync';
import { usePermissions } from '../../app/usePermissions';
import { legalFileForBooking } from '../../services/legalService';

/** On a booking: a way into the buyer's legal file, which opens automatically once it is confirmed. */
export function LegalFileLink({ bookingId }: { bookingId: string }) {
  const { can } = usePermissions();
  const { data } = useAsync(() => (can('legal') ? legalFileForBooking(bookingId) : Promise.resolve(undefined)), [bookingId]);
  if (!data) return null;
  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Legal file" subtitle="Agreement, payment plan, documents and registry for this buyer." action={<Scale size={16} className="text-ink-faint" />} />
      <Link to={`/legal/files/${data.id}`} className="text-sm font-medium text-brand-700 focus-ring rounded">Open the legal file →</Link>
    </Card>
  );
}
