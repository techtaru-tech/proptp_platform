import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options: SelectOption[];
  wrapperClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, wrapperClassName, label, error, hint, options, id, ...props }, ref) => {
    const selectId = id ?? props.name;
    return (
      <div className={cn('flex flex-col gap-1', wrapperClassName)}>
        {label && (
          <label htmlFor={selectId} className="text-xs font-medium text-ink-muted">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={cn(
              'h-8 w-full appearance-none rounded-lg border bg-surface pl-2.5 pr-8 text-sm text-ink transition-colors focus-ring',
              error ? 'border-danger-500' : 'border-line-strong hover:border-ink-faint',
              props.disabled && 'bg-surface-muted text-ink-faint cursor-not-allowed',
              className
            )}
            {...props}
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
        </div>
        {error ? <p className="text-xs text-danger-600">{error}</p> : hint ? <p className="text-xs text-ink-faint">{hint}</p> : null}
      </div>
    );
  }
);
Select.displayName = 'Select';
