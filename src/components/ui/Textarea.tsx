import { useId } from 'react';

/**
 * Multi-line counterpart to Input. `onChange` hands over the value rather than the event,
 * because every call site wanted the string and nothing else.
 */
export function Textarea({
  label, value, onChange, placeholder, hint, rows = 3, id,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  rows?: number;
  id?: string;
}) {
  const generated = useId();
  const inputId = id ?? generated;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <textarea
        id={inputId}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line-strong bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors hover:border-ink-faint focus-ring"
      />
      {hint && <p className="text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}
