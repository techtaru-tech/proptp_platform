import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BellRing, Check, Clock, Search, Send, Smartphone, Users2, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../context/ToastContext';
import {
  AUDIENCE_LABEL, createNotification, previewAudience, searchRecipients,
  type AudiencePreview, type NotificationRecipientOption,
} from '../../services/notificationService';
import type { NotificationAudience } from '../../types';

const AUDIENCES: { value: NotificationAudience; label: string; hint: string }[] = [
  { value: 'all', label: 'Everyone', hint: 'Agents, employees and leaders' },
  { value: 'agents', label: 'Channel partners', hint: 'Partner app users' },
  { value: 'employees', label: 'Employees', hint: 'Office staff' },
  { value: 'leaders', label: 'Leaders', hint: 'Team leaders' },
  { value: 'custom', label: 'Specific people', hint: 'Pick them by name' },
];

/** The soonest a schedule may be set, as the value a datetime-local input wants. */
function localInputValue(date: Date): string {
  // Built from local parts: toISOString() would shift an IST time back by five and a half hours.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function NotificationComposer({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const { toast } = useToast();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<NotificationAudience>('all');
  const [picked, setPicked] = useState<NotificationRecipientOption[]>([]);
  const [scheduling, setScheduling] = useState(false);
  const [sendAt, setSendAt] = useState(() => localInputValue(new Date(Date.now() + 30 * 60 * 1000)));
  const [errors, setErrors] = useState<{ title?: string; body?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  const [results, setResults] = useState<NotificationRecipientOption[]>([]);

  const pickedIds = useMemo(() => picked.map((p) => p.id), [picked]);

  // Recount whenever the audience changes, so the Send button always states a live number.
  useEffect(() => {
    let cancelled = false;
    if (audience === 'custom' && pickedIds.length === 0) {
      setPreview({ count: 0, withDevice: 0, byRole: {}, sample: [] });
      return;
    }
    previewAudience({ audience, userIds: pickedIds })
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [audience, pickedIds]);

  useEffect(() => {
    if (audience !== 'custom') return;
    let cancelled = false;
    searchRecipients(debouncedQuery)
      .then((users) => {
        if (!cancelled) setResults(users);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, audience]);

  const toggle = useCallback((user: NotificationRecipientOption) => {
    setPicked((prev) => (prev.some((p) => p.id === user.id) ? prev.filter((p) => p.id !== user.id) : [...prev, user]));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const nextErrors: { title?: string; body?: string } = {};
    if (!title.trim()) nextErrors.title = 'Title is required.';
    if (!body.trim()) nextErrors.body = 'Message body is required.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    if (audience === 'custom' && picked.length === 0) {
      return toast({ title: 'Pick at least one person', variant: 'error' });
    }
    if (!preview || preview.count === 0) {
      return toast({ title: 'Nobody would receive this', description: 'Choose an audience that has someone in it.', variant: 'error' });
    }

    const scheduledFor = scheduling ? new Date(sendAt) : null;
    if (scheduledFor && (Number.isNaN(scheduledFor.valueOf()) || scheduledFor <= new Date())) {
      return toast({ title: 'Pick a time in the future', variant: 'error' });
    }

    setSubmitting(true);
    try {
      await createNotification({
        title: title.trim(),
        body: body.trim(),
        audience,
        ...(audience === 'custom' ? { userIds: pickedIds } : {}),
        ...(scheduledFor ? { scheduledFor: scheduledFor.toISOString() } : {}),
      });
      toast({
        title: scheduledFor ? 'Notification scheduled' : 'Notification sent',
        description: scheduledFor
          ? `"${title.trim()}" goes out on ${scheduledFor.toLocaleString()} to ${preview.count} ${preview.count === 1 ? 'person' : 'people'}.`
          : `"${title.trim()}" sent to ${preview.count} ${preview.count === 1 ? 'person' : 'people'}, ${preview.withDevice} with the app.`,
        variant: 'success',
      });
      onSent();
    } catch (err) {
      toast({ title: 'Could not send', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Create Notification"
      description="Write it, choose who gets it, and see how it will land."
      size="xl"
      footer={
        <>
          <span className="mr-auto flex items-center gap-2 text-sm text-ink-muted">
            <Users2 size={15} className="text-ink-faint" />
            {preview ? (
              <span>
                <strong className="text-ink">{preview.count}</strong> {preview.count === 1 ? 'person' : 'people'} ·{' '}
                {preview.withDevice} with the app
              </span>
            ) : (
              <span className="text-ink-faint">Counting…</span>
            )}
          </span>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            leftIcon={scheduling ? <Clock size={14} /> : <Send size={14} />}
            onClick={submit}
            isLoading={submitting}
            disabled={!preview || preview.count === 0}
          >
            {scheduling ? 'Schedule' : `Send to ${preview?.count ?? 0}`}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_auto]">
        <div className="space-y-5">
          <Input
            label="Title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            error={errors.title}
            placeholder="e.g. New project launched"
            hint={`${title.length}/65 — Android trims a longer title on the lock screen`}
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="notif-body" className="text-sm font-medium text-ink">
              Message<span className="text-danger-500"> *</span>
            </label>
            <textarea
              id="notif-body"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write the notification message..."
              className={`w-full rounded-lg border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-ring ${
                errors.body ? 'border-danger-500' : 'border-line-strong hover:border-ink-faint'
              }`}
            />
            {errors.body ? (
              <p className="text-xs text-danger-600">{errors.body}</p>
            ) : (
              <p className="text-xs text-ink-faint">{body.length}/240 — the rest is only visible once it is expanded</p>
            )}
          </div>

          {/* Audience */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-ink">Audience</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {AUDIENCES.map((option) => {
                const active = audience === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setAudience(option.value)}
                    aria-pressed={active}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors focus-ring ${
                      active ? 'border-brand-500 bg-brand-50' : 'border-line hover:border-ink-faint'
                    }`}
                  >
                    <span className={`block text-sm font-medium ${active ? 'text-brand-700' : 'text-ink'}`}>
                      {option.label}
                    </span>
                    <span className="block text-xs text-ink-faint">{option.hint}</span>
                  </button>
                );
              })}
            </div>

            {preview && audience !== 'custom' && Object.keys(preview.byRole).length > 0 && (
              <p className="text-xs text-ink-muted">
                {Object.entries(preview.byRole)
                  .map(([role, count]) => `${count} ${role}${count === 1 ? '' : 's'}`)
                  .join(' · ')}
                {preview.sample.length > 0 && ` — ${preview.sample.map((s) => s.name).join(', ')}…`}
              </p>
            )}
          </div>

          {audience === 'custom' && (
            <div className="rounded-lg border border-line">
              <div className="border-b border-line p-3">
                <Input
                  aria-label="Search people"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  leftIcon={<Search size={14} />}
                  placeholder="Search by name or phone…"
                />
                {picked.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {picked.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggle(p)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-700 hover:bg-brand-100 focus-ring"
                      >
                        {p.name}
                        <X size={11} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="max-h-52 overflow-y-auto p-1.5">
                {results.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-ink-faint">No one matches that.</p>
                ) : (
                  results.map((user) => {
                    const chosen = picked.some((p) => p.id === user.id);
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => toggle(user)}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm focus-ring ${
                          chosen ? 'bg-brand-50' : 'hover:bg-surface-subtle'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">{user.name}</span>
                          <span className="block text-xs text-ink-faint">
                            {user.phone} · {user.role}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {user.hasDevice ? (
                            <Smartphone size={13} className="text-success-600" aria-label="Has the app" />
                          ) : (
                            <Smartphone size={13} className="text-ink-faint" aria-label="No device registered" />
                          )}
                          {chosen && <Check size={14} className="text-brand-600" />}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Schedule */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-ink">When</span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setScheduling(false)}
                aria-pressed={!scheduling}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors focus-ring ${
                  !scheduling ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line text-ink hover:border-ink-faint'
                }`}
              >
                Send now
              </button>
              <button
                type="button"
                onClick={() => setScheduling(true)}
                aria-pressed={scheduling}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors focus-ring ${
                  scheduling ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line text-ink hover:border-ink-faint'
                }`}
              >
                Schedule
              </button>
              {scheduling && (
                <input
                  type="datetime-local"
                  aria-label="Send at"
                  value={sendAt}
                  min={localInputValue(new Date())}
                  onChange={(e) => setSendAt(e.target.value)}
                  className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus-ring"
                />
              )}
            </div>
            {scheduling && (
              <p className="text-xs text-ink-faint">
                Checked every minute, so it goes out within a minute of the time you set. A role audience is worked out
                then, not now — anyone who joins in between is included.
              </p>
            )}
          </div>
        </div>

        <PhonePreview title={title} body={body} scheduled={scheduling ? sendAt : null} />
      </form>
    </Modal>
  );
}

/**
 * How it lands on a phone. Deliberately the lock-screen shape rather than a pretty card: the
 * question someone is really asking here is whether their title survives the one line it gets.
 */
function PhonePreview({ title, body, scheduled }: { title: string; body: string; scheduled: string | null }) {
  const when = scheduled
    ? new Date(scheduled).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'now';

  return (
    <div className="flex flex-col items-center gap-3 lg:w-[290px]">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Mobile preview</span>

      <div className="w-[270px] rounded-[34px] border-[7px] border-ink bg-gradient-to-b from-shell-700 to-shell-900 p-3 pt-7 shadow-popover">
        <div className="relative mb-6 text-center">
          {/* The notch, and the clock a lock screen always shows above it. */}
          <span className="absolute left-1/2 top-[-18px] h-4 w-20 -translate-x-1/2 rounded-b-xl bg-ink" />
          <p className="text-3xl font-light text-white">{when === 'now' ? 'Now' : when}</p>
          <p className="text-xs text-white/60">Propto Partner</p>
        </div>

        <div className="rounded-2xl bg-white/95 p-3 shadow-card backdrop-blur">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="flex h-4 w-4 items-center justify-center rounded bg-brand-600">
              <BellRing size={10} className="text-white" />
            </span>
            <span className="text-[11px] font-medium text-ink-muted">Propto CRM</span>
            <span className="ml-auto text-[11px] text-ink-faint">{when === 'now' ? 'now' : when}</span>
          </div>
          <p className="line-clamp-1 text-sm font-semibold text-ink">
            {title.trim() || 'Your title appears here'}
          </p>
          <p className="line-clamp-3 text-[13px] leading-snug text-ink-muted">
            {body.trim() || 'And the message body, trimmed to about three lines until it is expanded.'}
          </p>
        </div>
      </div>

      {scheduled && (
        <Badge tone="info">
          <Clock size={11} /> {new Date(scheduled).toLocaleString()}
        </Badge>
      )}
      <p className="max-w-[270px] text-center text-xs text-ink-faint">
        Partners without the app still see it in the app's notification feed when they next sign in.
      </p>
    </div>
  );
}

export { AUDIENCE_LABEL };
