import { cn } from '../../utils/cn';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Renders the label next to the switch. Off when the label is only for screen readers. */
  showLabel?: boolean;
  description?: string;
  disabled?: boolean;
  className?: string;
}

/** The switch already used inline by the settings pages, extracted so forms can reuse it. */
export function Toggle({ checked, onChange, label, showLabel = true, description, disabled, className }: ToggleProps) {
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors focus-ring',
          checked ? 'bg-brand-600' : 'bg-line-strong',
          disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        {/* Positioned with `left`, not a translate: the translate utilities emit no offset in this
            Tailwind v4 setup, which let the knob spill out of the track and over the label. */}
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-card transition-[left] duration-150',
            checked ? 'left-[22px]' : 'left-0.5'
          )}
        />
      </button>
      {showLabel && (
        <div>
          <p className="text-sm font-medium text-ink">{label}</p>
          {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
        </div>
      )}
    </div>
  );
}
