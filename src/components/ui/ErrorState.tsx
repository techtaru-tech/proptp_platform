import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from './Button';

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export function ErrorState({ title = 'Something went wrong', description = 'We could not load this data. Please try again.', onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2.5 px-6 py-10 text-center">
      <AlertTriangle size={18} className="text-danger-600" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-0.5 max-w-sm text-xs text-ink-subtle">{description}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" leftIcon={<RotateCw size={14} />} onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
