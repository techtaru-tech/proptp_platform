import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useAsync } from '../../hooks/useAsync';
import { formatRelativeTime } from '../../utils/format';
import { getAssistantStatus, listChats } from '../../services/assistantService';
import { useAssistantChat } from '../../components/assistant/useAssistantChat';
import { ChatThread } from '../../components/assistant/ChatThread';

/** Chat with the assistant: it looks things up live and, when asked, proposes changes you approve. */
export function Assistant() {
  const state = useAssistantChat();
  const status = useAsync(() => getAssistantStatus(), []);
  const chats = useAsync(() => listChats(), [state.revision]);
  const [params] = useSearchParams();

  // The corner widget's "open full page" hands over the chat it was in.
  const handedOver = params.get('chat');
  useEffect(() => {
    if (handedOver) state.open(handedOver);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handedOver]);

  const notReady = !!status.data && !status.data.configured;

  return (
    <div>
      <PageHeader title="Assistant" description="Ask about leads, collections or a project, or have a lead assigned. It looks things up live. Anything it wants to change waits for your approval." breadcrumb={[{ label: 'Assistant' }]}
        actions={<Button variant="outline" leftIcon={<Plus size={14} />} onClick={state.fresh}>New chat</Button>} />

      <div className="grid h-[calc(100vh-12rem)] min-h-[28rem] grid-cols-1 gap-4 lg:grid-cols-[16rem_1fr]">
        <Card padded={false} className="hidden overflow-hidden lg:flex lg:flex-col">
          <p className="border-b border-line px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-ink-subtle">Chats</p>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {(chats.data ?? []).length === 0 && <li className="px-3 py-3 text-xs text-ink-subtle">No chats yet.</li>}
            {(chats.data ?? []).map((c) => (
              <li key={c.id} className={`group flex items-center justify-between gap-2 border-b border-line px-3 py-2 text-[13px] ${state.chat?.id === c.id ? 'bg-brand-50' : 'hover:bg-surface-subtle'}`}>
                <button type="button" className="min-w-0 flex-1 rounded text-left focus-ring" onClick={() => state.open(c.id)}>
                  <span className="block truncate font-medium text-ink">{c.title}</span>
                  <span className="text-xs text-ink-faint">{formatRelativeTime(c.updatedAt)}</span>
                </button>
                <button type="button" aria-label={`Delete chat ${c.title}`} className="rounded p-1 text-ink-faint opacity-0 hover:text-danger-600 focus-ring group-hover:opacity-100" onClick={() => state.remove(c.id)}><Trash2 size={13} /></button>
              </li>))}
          </ul>
        </Card>

        <Card padded={false} className="flex min-h-0 flex-col overflow-hidden">
          <ChatThread state={state} notReady={notReady} />
        </Card>
      </div>
    </div>
  );
}
