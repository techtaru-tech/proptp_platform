import { Flame, Snowflake, Sun } from 'lucide-react';
import type { LeadTemperature } from '../../types';

const META = {
  hot: { label: 'Hot', cls: 'bg-danger-50 text-danger-700', Icon: Flame },
  warm: { label: 'Warm', cls: 'bg-warning-50 text-warning-700', Icon: Sun },
  cold: { label: 'Cold', cls: 'bg-info-50 text-info-700', Icon: Snowflake },
} as const;

/** Hot / warm / cold, with an icon so it does not rely on colour alone. */
export function TemperatureBadge({ value }: { value?: LeadTemperature | null }) {
  if (!value) return <span className="text-xs text-ink-faint">Not rated</span>;
  const { label, cls, Icon } = META[value];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}><Icon size={11} />{label}</span>;
}
