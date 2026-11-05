import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../utils/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  wrapperClassName?: string;
  /**
   * An API key, token or app secret — not a login password.
   *
   * Browsers and password managers happily fill any `type="password"` field with the saved
   * login for the site, which is how an admin panel password ends up saved as a third-party
   * app secret. These attributes are what actually stop Chrome, 1Password and LastPass.
   */
  secret?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, wrapperClassName, label, error, hint, leftIcon, rightIcon, secret, id, ...props }, ref) => {
    const inputId = id ?? props.name;
    return (
      <div className={cn('flex flex-col gap-1', wrapperClassName)}>
        {label && (
          <label htmlFor={inputId} className="text-xs font-medium text-ink-muted">
            {label}
            {props.required && <span className="text-danger-500"> *</span>}
          </label>
        )}
        <div className="relative">
          {leftIcon && <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint">{leftIcon}</span>}
          <input
            ref={ref}
            id={inputId}
            {...(secret
              ? { autoComplete: 'new-password' as const, 'data-1p-ignore': '', 'data-lpignore': 'true', 'data-form-type': 'other' }
              : {})}
            className={cn(
              'h-8 w-full rounded-lg border bg-surface px-2.5 text-sm text-ink placeholder:text-ink-faint transition-colors focus-ring',
              leftIcon && 'pl-8',
              rightIcon && 'pr-8',
              error ? 'border-danger-500' : 'border-line-strong hover:border-ink-faint',
              props.disabled && 'bg-surface-muted text-ink-faint cursor-not-allowed',
              className
            )}
            aria-invalid={!!error}
            {...props}
          />
          {rightIcon && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint">{rightIcon}</span>}
        </div>
        {error ? <p className="text-xs text-danger-600">{error}</p> : hint ? <p className="text-xs text-ink-faint">{hint}</p> : null}
      </div>
    );
  }
);
Input.displayName = 'Input';
