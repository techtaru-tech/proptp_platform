import { useState } from 'react';
import { Select } from '../ui/Select';
import { DatePicker } from '../ui/DatePicker';

export interface DateRange {
  from?: string;
  to?: string;
}

type Preset = 'all' | 'today' | 'yesterday' | '7d' | '30d' | 'this_month' | 'last_month' | 'custom';

const PRESET_OPTIONS: { value: Preset; label: string }[] = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'custom', label: 'Custom Range' },
];

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Resolves a preset into concrete `from`/`to` date keys, computed from local "today". */
function rangeForPreset(preset: Preset): DateRange {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (preset) {
    case 'today':
      return { from: toDateKey(today), to: toDateKey(today) };
    case 'yesterday': {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return { from: toDateKey(y), to: toDateKey(y) };
    }
    case '7d': {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      return { from: toDateKey(start), to: toDateKey(today) };
    }
    case '30d': {
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      return { from: toDateKey(start), to: toDateKey(today) };
    }
    case 'this_month':
      return { from: toDateKey(new Date(today.getFullYear(), today.getMonth(), 1)), to: toDateKey(today) };
    case 'last_month': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: toDateKey(start), to: toDateKey(end) };
    }
    case 'all':
    default:
      return { from: undefined, to: undefined };
  }
}

interface DateRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  /** Every Report Center page starts on this preset unless the admin changes it. */
  defaultPreset?: Preset;
}

/**
 * Preset dropdown (Today / Last 30 days / …) that resolves to concrete dates, plus a "Custom
 * Range" option that reveals two date pickers. The preset itself lives in local state — only the
 * resolved `{from, to}` is reported upward, which is all the report endpoints need.
 */
export function DateRangeFilter({ value, onChange, defaultPreset = '30d' }: DateRangeFilterProps) {
  const [preset, setPreset] = useState<Preset>(defaultPreset);

  const handlePresetChange = (next: Preset) => {
    setPreset(next);
    if (next !== 'custom') onChange(rangeForPreset(next));
  };

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Select
        aria-label="Date range"
        value={preset}
        onChange={(e) => handlePresetChange(e.target.value as Preset)}
        options={PRESET_OPTIONS}
        wrapperClassName="w-40"
      />
      {preset === 'custom' && (
        <>
          <DatePicker aria-label="From date" value={value.from ?? ''} onChange={(e) => onChange({ ...value, from: e.target.value })} wrapperClassName="w-36" />
          <span className="text-xs text-ink-faint">to</span>
          <DatePicker aria-label="To date" value={value.to ?? ''} onChange={(e) => onChange({ ...value, to: e.target.value })} wrapperClassName="w-36" />
        </>
      )}
    </div>
  );
}

/** The initial range for a page that mounts with `defaultPreset` (default "Last 30 days"). */
export function initialRangeForPreset(preset: Preset = '30d'): DateRange {
  return rangeForPreset(preset);
}
