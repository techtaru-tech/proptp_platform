import { useEffect, useRef, useState } from 'react';
import { Bot, Check, Loader2, Plus, Search, SendHorizontal, Trash2, X } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { formatRelativeTime } from '../../utils/format';
import { decideChange, deleteChat, getAssistantStatus, getChat, listChats, sendChat, type Chat, type ChatMessage } from '../../services/assistantService';
import { RichText } from './RichText';

const SUGGESTIONS = [
  'Overdue follow-ups kaun se hain?',
  'Kaun si instalments overdue hain?',
  'Is hafte ke site visits dikhao',
  'Dashboard ka summary do',
];

/** Chat with the assistant: it looks things up live and, when asked, proposes changes you approve. */
export function Assistant() {
  const { toast } = useToast();
  const [reload, setReload] = useState(0);
  const [chat, setChat] = useState<Chat | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const status = useAsync(() => getAssistantStatus(), []);
  const chats = useAsync(() => listChats(), [reload]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [chat?.messages.length, chat?.pending, waiting]);

  const open = async (id: string) => {
    try { setChat(await getChat(id)); } catch (e) { toast({ title: 'Could not open that chat', description: (e as Error).message, variant: 'error' }); }
  };
  const fresh = () => { setChat(null); setDraft(''); };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true); setWaiting(message); setDraft('');
    try { setChat(await sendChat(message, chat?.id)); setReload((k) => k + 1); }
    catch (e) { setDraft(message); toast({ title: 'The assistant could not answer', description: (e as Error).message, variant: 'error' }); }
    finally { setSending(false); setWaiting(null); }
  };

  const decide = async (approve: boolean) => {
    if (!chat || sending) return;
    setSending(true);
    try { setChat(await decideChange(chat.id, approve)); setReload((k) => k + 1); }
    catch (e) { toast({ title: 'That did not work', description: (e as Error).message, variant: 'error' }); }
    finally { setSending(false); }
  };

  const remove = async (id: string) => {
    try { await deleteChat(id); if (chat?.id === id) fresh(); setReload((k) => k + 1); }
    catch (e) { toast({ title: 'Could not delete it', description: (e as Error).message, variant: 'error' }); }
  };

  const shown: ChatMessage[] = [
    ...(chat?.messages ?? []),
    ...(waiting ? [{ id: 'waiting', role: 'user' as const, text: waiting, at: new Date().toISOString() }] : []),
  ];
  const notReady = status.data && !status.data.configured;

  return (
    <div>
      <PageHeader title="Assistant" description="Ask about leads, collections or a project, or have a lead assigned. It looks things up live. Anything it wants to change waits for your approval." breadcrumb={[{ label: 'Assistant' }]}
        actions={<Button variant="outline" leftIcon={<Plus size={14} />} onClick={fresh}>New chat</Button>} />
      {notReady && <p className="mb-4 rounded-lg bg-warning-50 px-4 py-3 text-sm text-warning-700">The assistant is not set up yet. Add <strong>ANTHROPIC_API_KEY</strong> to the server settings and restart; chats open but cannot be answered until then.</p>}

      <div className="grid h-[calc(100vh-15rem)] min-h-[28rem] grid-cols-1 gap-4 lg:grid-cols-[16rem_1fr]">
        <Card padded={false} className="hidden overflow-hidden lg:flex lg:flex-col">
          <p className="border-b border-line px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-ink-faint">Chats</p>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {(chats.data ?? []).length === 0 && <li className="px-4 py-3 text-sm text-ink-muted">No chats yet.</li>}
            {(chats.data ?? []).map((c) => (
              <li key={c.id} className={`group flex items-center justify-between gap-2 border-b border-line px-4 py-2.5 text-sm ${chat?.id === c.id ? 'bg-brand-50' : 'hover:bg-surface-subtle'}`}>
                <button type="button" className="min-w-0 flex-1 text-left focus-ring rounded" onClick={() => open(c.id)}>
                  <span className="block truncate font-medium text-ink">{c.title}</span>
                  <span className="text-xs text-ink-faint">{formatRelativeTime(c.updatedAt)}</span>
                </button>
                <button type="button" aria-label={`Delete chat ${c.title}`} className="rounded p-1 text-ink-faint opacity-0 hover:text-danger-600 focus-ring group-hover:opacity-100" onClick={() => remove(c.id)}><Trash2 size={13} /></button>
              </li>))}
          </ul>
        </Card>

        <Card padded={false} className="flex min-h-0 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            {shown.length === 0 ? (
              <div className="mx-auto mt-10 max-w-lg text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700"><Bot size={22} /></span>
                <h2 className="mt-3 text-lg font-semibold text-ink">What would you like to know or do?</h2>
                <p className="mt-1 text-sm text-ink-muted">Hindi, English or Hinglish, any is fine.</p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => <button key={s} type="button" disabled={sending || !!notReady} onClick={() => send(s)} className="rounded-full border border-line px-3 py-1.5 text-sm text-ink hover:bg-surface-subtle focus-ring disabled:opacity-50">{s}</button>)}
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-3xl flex-col gap-4">
                {shown.map((m) => m.role === 'user' ? (
                  <div key={m.id} className="flex justify-end"><p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand-600 px-4 py-2.5 text-sm text-white">{m.text}</p></div>
                ) : (
                  <div key={m.id} className="flex gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700"><Bot size={15} /></span>
                    <div className="min-w-0 flex-1 text-sm text-ink">
                      {(m.tools?.length ?? 0) > 0 && (
                        <div className="mb-1.5 flex flex-wrap gap-1.5">
                          {m.tools!.map((t, i) => <span key={i} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${t.failed ? 'bg-danger-50 text-danger-700' : 'bg-surface-muted text-ink-muted'}`}><Search size={10} />{t.label}{t.failed ? ' (failed)' : ''}</span>)}
                        </div>)}
                      {m.text && <RichText text={m.text} />}
                    </div>
                  </div>))}
                {(sending && !chat?.pending) && <div className="flex items-center gap-2 pl-10 text-sm text-ink-muted"><Loader2 size={14} className="animate-spin" /> Working on it…</div>}
                {chat?.pending && (
                  <div className="ml-10 rounded-xl border border-warning-300 bg-warning-50 p-4" role="group" aria-label="Approve a change">
                    <p className="text-sm font-semibold text-ink">The assistant wants to make {chat.pending.length === 1 ? 'a change' : `${chat.pending.length} changes`}</p>
                    <ul className="mt-1.5 list-disc pl-5 text-sm text-ink">{chat.pending.map((p) => <li key={p.id}>{p.summary}</li>)}</ul>
                    <div className="mt-3 flex gap-2">
                      <Button variant="primary" size="sm" leftIcon={<Check size={13} />} onClick={() => decide(true)} isLoading={sending}>Approve</Button>
                      <Button variant="outline" size="sm" leftIcon={<X size={13} />} onClick={() => decide(false)} disabled={sending}>Don’t do it</Button>
                    </div>
                  </div>)}
                <div ref={bottom} />
              </div>)}
          </div>

          <form className="border-t border-line p-3 sm:p-4" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
            <div className="mx-auto flex max-w-3xl items-end gap-2">
              <textarea aria-label="Message the assistant" rows={1} value={draft} disabled={!!chat?.pending || !!notReady}
                placeholder={chat?.pending ? 'Approve or decline the change first' : 'Ask something, or tell it what to do…'}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); } }}
                className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus-ring disabled:bg-surface-subtle" />
              <Button type="submit" variant="primary" aria-label="Send" disabled={!draft.trim() || sending || !!chat?.pending || !!notReady}><SendHorizontal size={15} /></Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
