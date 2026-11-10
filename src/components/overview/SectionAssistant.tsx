import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, History, Loader2, Plus, SendHorizontal, Sparkles, Square, Trash2, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { RichText } from '../../pages/assistant/RichText';
import { usePermissions } from '../../app/usePermissions';
import { useToast } from '../../context/ToastContext';
import { cn } from '../../utils/cn';
import { formatRelativeTime } from '../../utils/format';
import {
  SECTION_SUGGESTIONS, askSectionAgent, deleteSectionAgentChat, getSectionAgentChat, getSectionAgentStatus, listSectionAgentChats,
  type SectionAgentChatSummary, type SectionKey,
} from '../../services/sectionService';

interface Step { id: string; label: string; state: 'running' | 'ok' | 'failed'; note?: string }
interface Turn { id: string; role: 'user' | 'assistant'; text: string; steps: Step[]; progress?: string; notices: string[]; live?: boolean }

/**
 * A section's own assistant, as a card on its Overview. It answers about that section only (the
 * HRMS one does HRMS), streams each lookup and then the answer, and keeps past chats. `question`
 * lets the page hand it a question from elsewhere, e.g. a "needs attention" row.
 */
export function SectionAssistant({ section, label, question, onQuestionTaken }: { section: SectionKey; label: string; question?: string; onQuestionTaken?: () => void }) {
  const { toast } = useToast();
  const { isFullAccess } = usePermissions();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [chats, setChats] = useState<SectionAgentChatSummary[]>([]);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // A different section is a different assistant: start clean.
  useEffect(() => {
    setConfigured(null); setConversationId(undefined); setTurns([]); setDraft(''); setShowHistory(false);
    getSectionAgentStatus(section).then((s) => setConfigured(s.configured)).catch(() => setConfigured(false));
  }, [section]);
  // Scroll the conversation, not the page.
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [turns]);
  useEffect(() => () => abort.current?.abort(), []);

  const update = (id: string, fn: (t: Turn) => Turn) => setTurns((all) => all.map((t) => (t.id === id ? fn(t) : t)));

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setDraft('');
    const answerId = `a${Date.now()}`;
    setTurns((all) => [...all, { id: `u${Date.now()}`, role: 'user', text: message, steps: [], notices: [] }, { id: answerId, role: 'assistant', text: '', steps: [], notices: [], live: true }]);
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      await askSectionAgent(section, { message, conversationId }, (e) => {
        switch (e.type) {
          case 'conversation': setConversationId(e.id); break;
          case 'step': update(answerId, (t) => ({ ...t, steps: [...t.steps, { id: e.id, label: e.label, state: 'running' }] })); break;
          case 'step_done': update(answerId, (t) => ({ ...t, steps: t.steps.map((s) => (s.id === e.id ? { ...s, state: e.ok ? 'ok' : 'failed', note: e.note } : s)) })); break;
          case 'progress': update(answerId, (t) => ({ ...t, progress: e.text })); break;
          case 'text': update(answerId, (t) => ({ ...t, text: t.text + e.delta, progress: undefined })); break;
          case 'notice': update(answerId, (t) => ({ ...t, notices: [...t.notices, e.text] })); break;
          case 'error': update(answerId, (t) => ({ ...t, notices: [...t.notices, e.message] })); break;
          case 'done': break;
        }
      }, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) update(answerId, (t) => ({ ...t, notices: [...t.notices, (err as Error).message] }));
    } finally {
      update(answerId, (t) => ({ ...t, live: false, progress: undefined, steps: t.steps.map((s) => (s.state === 'running' ? { ...s, state: controller.signal.aborted ? 'failed' : 'ok' } : s)) }));
      if (controller.signal.aborted) update(answerId, (t) => ({ ...t, notices: [...t.notices, 'Stopped.'] }));
      setBusy(false);
      abort.current = null;
    }
  };

  useEffect(() => {
    if (question && configured && !busy) { send(question); onQuestionTaken?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, configured]);

  const fresh = () => { if (busy) return; setConversationId(undefined); setTurns([]); setDraft(''); setShowHistory(false); input.current?.focus(); };
  const openHistory = async () => {
    setShowHistory((v) => !v);
    try { setChats(await listSectionAgentChats(section)); } catch (e) { toast({ title: 'Could not load past chats', description: (e as Error).message, variant: 'error' }); }
  };
  const openChat = async (id: string) => {
    try {
      const chat = await getSectionAgentChat(section, id);
      setConversationId(chat.id);
      setTurns(chat.messages.map((m) => ({ id: m.id, role: m.role, text: m.text, notices: [], steps: m.steps.map((s, i) => ({ id: `${m.id}-${i}`, label: s.label, state: s.failed ? 'failed' : 'ok' })) })));
      setShowHistory(false);
    } catch (e) { toast({ title: 'Could not open that chat', description: (e as Error).message, variant: 'error' }); }
  };
  const removeChat = async (id: string) => {
    try { await deleteSectionAgentChat(section, id); setChats((c) => c.filter((x) => x.id !== id)); if (id === conversationId) fresh(); }
    catch (e) { toast({ title: 'Could not delete it', description: (e as Error).message, variant: 'error' }); }
  };

  const suggestions = SECTION_SUGGESTIONS[section];

  return (
    <section aria-label={`${label} assistant`} className="flex h-[560px] flex-col overflow-hidden rounded-xl border border-brand-200 bg-gradient-to-b from-brand-50 to-surface to-40%">
      <header className="flex items-center gap-2 border-b border-brand-100 px-4 py-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white" aria-hidden="true"><Sparkles size={16} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{label} Assistant</p>
          <p className="truncate text-2xs text-ink-subtle">Answers about {label} only · live data · read-only</p>
        </div>
        <button type="button" onClick={openHistory} aria-pressed={showHistory} title="Past chats" aria-label="Past chats" className={cn('rounded-md p-1.5 hover:bg-surface-muted hover:text-ink focus-ring', showHistory ? 'bg-surface-muted text-ink' : 'text-ink-subtle')}><History size={15} /></button>
        <button type="button" onClick={fresh} disabled={busy} title="New chat" aria-label="New chat" className="rounded-md p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-ink disabled:opacity-40 focus-ring"><Plus size={15} /></button>
      </header>

      {showHistory && (
        <div className="max-h-56 overflow-y-auto border-b border-line bg-surface">
          {chats.length === 0 ? <p className="px-4 py-3 text-xs text-ink-subtle">No past chats yet.</p> : (
            <ul className="divide-y divide-line">
              {chats.map((c) => (
                <li key={c.id} className="group flex items-center gap-2 px-4 py-2 hover:bg-surface-subtle">
                  <button type="button" onClick={() => openChat(c.id)} className="min-w-0 flex-1 rounded text-left focus-ring">
                    <span className="block truncate text-[13px] text-ink">{c.title}</span>
                    <span className="text-2xs text-ink-faint">{formatRelativeTime(c.updatedAt)}</span>
                  </button>
                  <button type="button" onClick={() => removeChat(c.id)} aria-label={`Delete chat ${c.title}`} className="rounded p-1 text-ink-faint opacity-0 hover:text-danger-600 focus-ring group-hover:opacity-100"><Trash2 size={13} /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {configured === false ? (
          <div className="mx-auto mt-8 max-w-xs text-center">
            <Sparkles size={20} className="mx-auto text-brand-700" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-ink">Add an Anthropic API key to switch the assistant on</p>
            {isFullAccess
              ? <Link to="/settings/ai-assistant" className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline">Open Settings › AI Assistant</Link>
              : <p className="mt-3 text-xs text-ink-subtle">Ask an administrator to add it in Settings › AI Assistant.</p>}
          </div>
        ) : turns.length === 0 ? (
          <div>
            <p className="text-xs text-ink-subtle">Ask about {label} in Hindi, English or Hinglish. It reads the same data you can see and suggests what to do next — you make every change yourself.</p>
            <div className="mt-3 flex flex-col gap-1.5">
              {suggestions.map((s) => (
                <button key={s} type="button" disabled={!configured || busy} onClick={() => send(s)} className="rounded-md border border-brand-100 bg-surface px-3 py-2 text-left text-[13px] text-ink-muted transition-colors duration-100 hover:border-brand-300 hover:bg-brand-50 hover:text-ink disabled:opacity-50 focus-ring">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {turns.map((t) => t.role === 'user' ? (
              <div key={t.id} className="flex justify-end"><p className="max-w-[88%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-brand-600 px-3 py-2 text-[13px] text-white">{t.text}</p></div>
            ) : (
              <div key={t.id} className="flex gap-2">
                <Sparkles size={14} className="mt-1 shrink-0 text-brand-700" aria-hidden="true" />
                <div className="min-w-0 flex-1 text-[13px] text-ink">
                  {t.steps.length > 0 && (
                    <ul className="mb-2 space-y-0.5 rounded-md border border-line bg-surface-subtle px-2.5 py-1.5">
                      {t.steps.map((s) => (
                        <li key={s.id} className="flex items-center gap-1.5 text-xs text-ink-subtle" title={s.note}>
                          {s.state === 'running' ? <Loader2 size={11} className="animate-spin" /> : s.state === 'ok' ? <Check size={11} className="text-brand-600" /> : <X size={11} className="text-danger-600" />}
                          <span className={cn(s.state === 'failed' && 'text-danger-700')}>{s.label}{s.state === 'failed' && s.note ? ` — ${s.note}` : ''}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {t.live && !t.text && (
                    <p className="flex items-center gap-2 text-xs italic text-ink-subtle"><Loader2 size={12} className="animate-spin" />{t.progress ?? (t.steps.length ? 'Working through the numbers…' : 'Reading your question…')}</p>
                  )}
                  {t.text && <RichText text={t.text} />}
                  {t.notices.map((n, i) => <p key={i} className="mt-2 rounded-md border border-warning-100 bg-warning-50 px-2.5 py-1.5 text-xs text-warning-700">{n}</p>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <form className="border-t border-line bg-surface p-3" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <div className="flex items-end gap-2">
          <textarea
            ref={input} rows={2} value={draft} disabled={!configured} aria-label={`Ask the ${label} assistant`}
            placeholder={configured === false ? 'Add an API key first' : `Ask about ${label}…`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); } }}
            className="max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-[13px] text-ink placeholder:text-ink-faint focus-ring disabled:bg-surface-subtle"
          />
          {busy
            ? <Button type="button" variant="outline" size="icon" aria-label="Stop" title="Stop" onClick={() => abort.current?.abort()}><Square size={13} /></Button>
            : <Button type="submit" size="icon" aria-label="Send" disabled={!draft.trim() || !configured}><SendHorizontal size={15} /></Button>}
        </div>
      </form>
    </section>
  );
}
