import { useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { decideChange, deleteChat, getChat, sendChat, type Chat, type ChatMessage } from '../../services/assistantService';

/**
 * One conversation with the panel assistant: what has been said, what is being sent, and any
 * change it is waiting for approval on. Shared by the Assistant page and the floating widget.
 */
export function useAssistantChat() {
  const { toast } = useToast();
  const [chat, setChat] = useState<Chat | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState<string | null>(null);
  /** Bumped whenever the list of saved chats may have changed. */
  const [revision, setRevision] = useState(0);

  const fail = (title: string) => (e: unknown) => toast({ title, description: (e as Error).message, variant: 'error' });

  const open = async (id: string) => {
    try { setChat(await getChat(id)); } catch (e) { fail('Could not open that chat')(e); }
  };

  const fresh = () => { setChat(null); setDraft(''); };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true); setWaiting(message); setDraft('');
    try { setChat(await sendChat(message, chat?.id)); setRevision((r) => r + 1); }
    catch (e) { setDraft(message); fail('The assistant could not answer')(e); }
    finally { setSending(false); setWaiting(null); }
  };

  const decide = async (approve: boolean) => {
    if (!chat || sending) return;
    setSending(true);
    try { setChat(await decideChange(chat.id, approve)); setRevision((r) => r + 1); }
    catch (e) { fail('That did not work')(e); }
    finally { setSending(false); }
  };

  const remove = async (id: string) => {
    try { await deleteChat(id); if (chat?.id === id) fresh(); setRevision((r) => r + 1); }
    catch (e) { fail('Could not delete it')(e); }
  };

  const shown: ChatMessage[] = [
    ...(chat?.messages ?? []),
    ...(waiting ? [{ id: 'waiting', role: 'user' as const, text: waiting, at: new Date().toISOString() }] : []),
  ];

  return { chat, draft, setDraft, sending, shown, revision, open, fresh, send, decide, remove };
}

export type AssistantChatState = ReturnType<typeof useAssistantChat>;
