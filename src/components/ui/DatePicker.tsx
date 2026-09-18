import { forwardRef, type InputHTMLAttributes } from 'react';
import { Calendar } from 'lucide-react';
import { cn } from '../../utils/cn';

interface DatePickerProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  wrapperClassName?: string;
}

export const DatePicker = forwardRef<HTMLInputElement, DatePickerProps>(
  ({ className, wrapperClassName, label, id, ...props }, ref) => {
    const inputId = id ?? props.name;
    return (
      <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-ink">
            {label}
          </label>
        )}
        <div className="relative">
          <Calendar size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            ref={ref}
            type="date"
            id={inputId}
            className={cn(
              'h-9 w-full rounded-lg border border-line-strong bg-white pl-9 pr-3 text-sm text-ink transition-colors hover:border-ink-faint focus-ring',
              className
            )}
            {...props}
          />
        </div>
      </div>
    );
  }
);
DatePicker.displayName = 'DatePicker';
