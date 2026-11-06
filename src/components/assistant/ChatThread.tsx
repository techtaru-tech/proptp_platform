import { useEffect, useRef } from 'react';
import { Check, Loader2, Search, SendHorizontal, Sparkles, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { RichText } from '../../pages/assistant/RichText';
import { cn } from '../../utils/cn';
import type { AssistantChatState } from './useAssistantChat';

const SUGGESTIONS = [
  'Overdue follow-ups kaun se hain?',
  'Kaun si instalments overdue hain?',
  'Is hafte ke site visits dikhao',
  'Dashboard ka summary do',
];

/**
 * The conversation itself — messages, the approval card and the composer. `compact` is the
 * widget's narrower layout; the Assistant page uses the roomy one.
 */
export function ChatThread({ state, notReady, compact }: { state: AssistantChatState; notReady: boolean; compact?: boolean }) {
  const { chat, draft, setDraft, sending, shown, send, decide } = state;
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [shown.length, chat?.pending, sending]);
  useEffect(() => { if (compact) input.current?.focus(); }, [compact]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn('min-h-0 flex-1 overflow-y-auto', compact ? 'px-3 py-3' : 'px-4 py-4 sm:px-6')}>
        {notReady && (
          <p className="mb-3 rounded-lg border border-warning-100 bg-warning-50 px-3 py-2 text-xs text-warning-700">
            The assistant is not set up yet. An administrator can add an Anthropic API key in <strong>Settings › AI Assistant</strong>.
          </p>
        )}
        {shown.length === 0 ? (
          <div className={cn('mx-auto text-center', compact ? 'mt-4' : 'mt-10 max-w-lg')}>
            <Sparkles size={compact ? 20 : 22} className="mx-auto text-brand-700" aria-hidden="true" />
            <p className={cn('mt-2 font-semibold text-ink', compact ? 'text-sm' : 'text-lg')}>What would you like to know or do?</p>
            <p className="mt-0.5 text-xs text-ink-subtle">It reads live data. Anything it changes waits for your OK. Hindi, English or Hinglish.</p>
            <div className={cn('mt-4 flex flex-wrap gap-1.5', compact ? 'justify-start' : 'justify-center')}>
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" disabled={sending || notReady} onClick={() => send(s)}
                  className="rounded-md border border-line px-2.5 py-1 text-left text-xs text-ink-muted transition-colors duration-100 hover:border-line-strong hover:text-ink focus-ring disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className={cn('flex flex-col gap-3', !compact && 'mx-auto max-w-3xl gap-4')}>
            {shown.map((m) => m.role === 'user' ? (
              <div key={m.id} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-brand-600 px-3 py-2 text-[13px] text-white">{m.text}</p>
              </div>
            ) : (
              <div key={m.id} className="flex gap-2.5">
                <Sparkles size={15} className="mt-1 shrink-0 text-brand-700" aria-hidden="true" />
                <div className="min-w-0 flex-1 text-[13px] text-ink">
                  {(m.tools?.length ?? 0) > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-1">
                      {m.tools!.map((t, i) => (
                        <span key={i} className={cn('inline-flex items-center gap-1 rounded-sm px-1.5 py-px text-2xs', t.failed ? 'bg-danger-50 text-danger-700' : 'bg-surface-muted text-ink-subtle')}>
                          <Search size={9} />{t.label}{t.failed ? ' (failed)' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.text && <RichText text={m.text} />}
                </div>
              </div>
            ))}
            {sending && !chat?.pending && (
              <div className="flex items-center gap-2 pl-6 text-xs text-ink-subtle"><Loader2 size={13} className="animate-spin" /> Working on it…</div>
            )}
            {chat?.pending && (
              <div className="rounded-lg border border-warning-100 bg-warning-50 p-3" role="group" aria-label="Approve a change">
                <p className="text-[13px] font-semibold text-ink">It wants to make {chat.pending.length === 1 ? 'a change' : `${chat.pending.length} changes`}</p>
                <ul className="mt-1 list-disc pl-5 text-[13px] text-ink">{chat.pending.map((p) => <li key={p.id}>{p.summary}</li>)}</ul>
                <div className="mt-2.5 flex gap-2">
                  <Button size="sm" leftIcon={<Check size={13} />} onClick={() => decide(true)} isLoading={sending}>Approve</Button>
                  <Button variant="outline" size="sm" leftIcon={<X size={13} />} onClick={() => decide(false)} disabled={sending}>Don’t do it</Button>
                </div>
              </div>
            )}
            <div ref={bottom} />
          </div>
        )}
      </div>

      <form className={cn('border-t border-line', compact ? 'p-2.5' : 'p-3 sm:p-4')} onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <div className={cn('flex items-end gap-2', !compact && 'mx-auto max-w-3xl')}>
          <textarea
            ref={input} aria-label="Message the assistant" rows={1} value={draft} disabled={!!chat?.pending || notReady}
            placeholder={chat?.pending ? 'Approve or decline the change first' : 'Ask something, or tell it what to do…'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); } }}
            className="max-h-32 min-h-[2.25rem] flex-1 resize-none rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-[13px] text-ink placeholder:text-ink-faint focus-ring disabled:bg-surface-subtle"
          />
          <Button type="submit" size="icon" aria-label="Send" disabled={!draft.trim() || sending || !!chat?.pending || notReady}><SendHorizontal size={15} /></Button>
        </div>
      </form>
    </div>
  );
}
