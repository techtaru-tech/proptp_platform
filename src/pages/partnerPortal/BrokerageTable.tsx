import { Badge } from '../../components/ui/Badge';
import { formatCurrency, formatDate } from '../../utils/format';
import type { Brokerage } from '../../services/channelPartnerService';

const TONE = { payable: 'success', waiting: 'warning', paid: 'info', cancelled: 'neutral' } as const;
const TEXT = { payable: 'Payable', waiting: 'Waiting for milestone', paid: 'Paid', cancelled: 'Cancelled' } as const;

/** Brokerage lines with the tax taken off, shared by the partner's portal and the staff view of the partner. */
export function BrokerageTable({ data }: { data: Brokerage }) {
  if (data.lines.length === 0) return <p className="px-5 py-5 text-sm text-ink-muted">No brokerage yet.</p>;
  return (
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-faint">
        <th className="px-5 py-2 font-medium">Booking</th><th className="px-3 text-right font-medium">Brokerage</th><th className="px-3 text-right font-medium">Tax</th><th className="px-3 text-right font-medium">You receive</th><th className="px-5 font-medium">Status</th></tr></thead>
      <tbody>{data.lines.map((l) => (
        <tr key={l.id} className="border-t border-line">
          <td className="px-5 py-2.5"><span className="font-medium text-ink">{l.reference ?? l.title}</span><span className="block text-xs text-ink-muted">{l.buyerName} · {l.unit} · {l.projectName} · {formatDate(l.creditedOn)}</span></td>
          <td className="px-3 text-right tabular-nums">{formatCurrency(l.gross)}{l.percent > 0 && <span className="block text-xs text-ink-faint">{l.percent}%</span>}</td>
          <td className="px-3 text-right tabular-nums text-ink-muted">{formatCurrency(l.tds)}</td>
          <td className="px-3 text-right font-medium tabular-nums">{formatCurrency(l.net)}</td>
          <td className="px-5"><Badge tone={TONE[l.state]}>{TEXT[l.state]}</Badge></td>
        </tr>))}</tbody>
    </table></div>
  );
}
