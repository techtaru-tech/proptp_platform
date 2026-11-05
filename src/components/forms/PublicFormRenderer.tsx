import { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn';
import { submitPublicForm } from '../../services/formService';
import type { LeadFormField, PublicLeadForm } from '../../types';

interface PublicFormRendererProps {
  form: PublicLeadForm;
  /** `preview` never submits and never redirects — it is the builder's own preview pane. */
  mode?: 'live' | 'preview';
}

type Answers = Record<string, string | boolean>;

declare global {
  interface Window {
    grecaptcha?: { ready: (cb: () => void) => void; execute: (siteKey: string, opts: { action: string }) => Promise<string> };
  }
}

/** Loads reCAPTCHA v3 on demand and returns a token, or undefined if it can't be reached. */
async function recaptchaToken(siteKey: string): Promise<string | undefined> {
  try {
    if (!window.grecaptcha) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('recaptcha script failed'));
        document.head.appendChild(script);
      });
    }
    const grecaptcha = window.grecaptcha;
    if (!grecaptcha) return undefined;
    await new Promise<void>((resolve) => grecaptcha.ready(() => resolve()));
    return await grecaptcha.execute(siteKey, { action: 'lead_form' });
  } catch {
    // The server decides what to do with a missing token; failing closed here would block real people.
    return undefined;
  }
}

function isBlank(value: string | boolean | undefined): boolean {
  return value === undefined || value === '' || value === false;
}

export function PublicFormRenderer({ form, mode = 'live' }: PublicFormRendererProps) {
  const [answers, setAnswers] = useState<Answers>({});
  const [honeypot, setHoneypot] = useState('');
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);

  const steps = useMemo(() => {
    if (!form.isMultiStep) return [1];
    return [...new Set(form.fields.map((f) => f.step || 1))].sort((a, b) => a - b);
  }, [form.fields, form.isMultiStep]);

  const visibleFields = form.isMultiStep ? form.fields.filter((f) => (f.step || 1) === steps[step - 1]) : form.fields;
  const isLastStep = step >= steps.length;

  const set = (key: string, value: string | boolean) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setError(null);
  };

  /** Blocks Next/Submit on the fields the visitor can currently see, so errors surface in place. */
  const missingOnThisStep = visibleFields.filter((f) => f.required && isBlank(answers[f.fieldKey]));

  const handleSubmit = async () => {
    if (mode === 'preview') return;
    if (missingOnThisStep.length > 0) {
      setError(`Please complete: ${missingOnThisStep.map((f) => f.label).join(', ')}`);
      return;
    }
    if (!isLastStep) {
      setStep((s) => s + 1);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const token = form.recaptchaEnabled && form.recaptchaSiteKey ? await recaptchaToken(form.recaptchaSiteKey) : undefined;
      await submitPublicForm(form.slug, {
        data: answers,
        honeypot,
        recaptchaToken: token,
        pageUrl: window.location.href,
        referrer: document.referrer || undefined,
      });
      if (form.redirectUrl) {
        window.location.href = form.redirectUrl;
        return;
      }
      setIsDone(true);
    } catch (err) {
      setError((err as Error).message);
      setIsSubmitting(false);
    }
  };

  if (isDone) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success-50 text-success-600">
          <CheckCircle2 size={24} />
        </span>
        <p className="text-base font-semibold text-ink">{form.thankYouMessage || 'Thanks — we have your details.'}</p>
        <p className="text-sm text-ink-muted">Someone from our team will be in touch shortly.</p>
      </div>
    );
  }

  const inputClass =
    'h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint transition-colors hover:border-ink-faint focus:outline-none focus:ring-2 focus:ring-offset-1';

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-ink">{form.displayTitle}</h2>
        {form.description && <p className="mt-1 text-sm text-ink-muted">{form.description}</p>}
      </div>

      {form.isMultiStep && steps.length > 1 && (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${(step / steps.length) * 100}%`, backgroundColor: form.accentColor }}
            />
          </div>
          <span className="text-xs font-medium text-ink-muted">
            Step {step} of {steps.length}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-3.5">
        {visibleFields.map((field) => (
          <FieldControl
            key={field.id ?? field.fieldKey}
            field={field}
            value={answers[field.fieldKey]}
            onChange={(value) => set(field.fieldKey, value)}
            accentColor={form.accentColor}
            inputClass={inputClass}
          />
        ))}
      </div>

      {/* Honeypot: off-screen and unlabelled, so only a script fills it. */}
      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
        className="pointer-events-none absolute -left-[9999px] h-0 w-0 opacity-0"
      />

      {error && (
        <p className="flex items-start gap-2 rounded-lg border border-danger-100 bg-danger-50 px-3 py-2 text-xs text-danger-700">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        {form.isMultiStep && step > 1 && (
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            className="h-10 rounded-lg border border-line-strong px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-subtle"
          >
            Back
          </button>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || mode === 'preview'}
          className={cn(
            'inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60',
            mode === 'preview' && 'cursor-not-allowed'
          )}
          style={{ backgroundColor: form.accentColor }}
        >
          {isSubmitting && <Loader2 size={15} className="animate-spin" />}
          {isLastStep ? form.submitLabel : 'Next'}
        </button>
      </div>

      {mode === 'preview' && (
        <p className="text-center text-xs text-ink-faint">Preview only — submitting is disabled here.</p>
      )}
    </div>
  );
}

interface FieldControlProps {
  field: LeadFormField;
  value: string | boolean | undefined;
  onChange: (value: string | boolean) => void;
  accentColor: string;
  inputClass: string;
}

function FieldControl({ field, value, onChange, accentColor, inputClass }: FieldControlProps) {
  const id = `field-${field.fieldKey}`;
  const ring = { ['--tw-ring-color' as string]: accentColor };

  if (field.type === 'checkbox' || field.type === 'gdpr_consent') {
    return (
      <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong focus-ring"
          style={{ accentColor }}
        />
        <span>
          {field.label}
          {field.required && <span style={{ color: accentColor }}> *</span>}
          {field.placeholder && <span className="mt-0.5 block text-xs text-ink-muted">{field.placeholder}</span>}
        </span>
      </label>
    );
  }

  const control = (() => {
    if (field.type === 'long_text') {
      return (
        <textarea
          id={id}
          rows={3}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder ?? undefined}
          onChange={(e) => onChange(e.target.value)}
          style={ring}
          className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors hover:border-ink-faint focus:outline-none focus:ring-2 focus:ring-offset-1"
        />
      );
    }
    if (field.type === 'dropdown') {
      return (
        <select
          id={id}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          style={ring}
          className={inputClass}
        >
          <option value="">Select an option</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }
    const inputType = field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
    return (
      <input
        id={id}
        type={inputType}
        value={typeof value === 'string' ? value : ''}
        placeholder={field.placeholder ?? undefined}
        onChange={(e) => onChange(e.target.value)}
        style={ring}
        className={inputClass}
      />
    );
  })();

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {field.label}
        {field.required && <span style={{ color: accentColor }}> *</span>}
      </label>
      {control}
    </div>
  );
}
