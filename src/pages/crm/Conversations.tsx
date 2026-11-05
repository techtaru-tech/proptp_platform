import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, CheckCheck, Clock3, Info, MessageSquare, Send, User } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Select } from '../../components/ui/Select';
import { Input } from '../../components/ui/Input';
import { Avatar } from '../../components/ui/Avatar';
import { SearchInput } from '../../components/ui/SearchInput';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { EmptyState } from '../../components/ui/EmptyState';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  getConversation, listConversations, listMessages, listWhatsAppAccounts, markConversationRead,
  sendWhatsAppMessage, updateConversation, CONVERSATION_TABS, formatWindowLeft,
  type ConversationTab,
} from '../../services/whatsappService';
import { getLead } from '../../services/leadService';
import { assignableUsers, userDisplayName } from '../../data/referenceData';
import { formatDateTime, formatRelativeTime } from '../../utils/format';
import { cn } from '../../utils/cn';
import type { LeadStatus, WhatsAppConversation, WhatsAppMessage } from '../../types';

const LEAD_STATUS_OPTIONS: { value: LeadStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Lead Status' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

export function Conversations() {
  const { toast } = useToast();
  const [accountId, setAccountId] = useState('');
  const [tab, setTab] = useState<ConversationTab>('all');
  const [search, setSearch] = useState('');
  const [assignee, setAssignee] = useState('all');
  const [leadStatus, setLeadStatus] = useState<LeadStatus | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const { data: accounts, isLoading: accountsLoading } = useAsync(() => listWhatsAppAccounts(), [reloadKey]);

  // Default to the first linked number so the page is never blank on arrival. Derived
  // rather than copied in by an effect, so there is no render where nothing is selected.
  const activeAccountId = accountId || accounts?.[0]?.id || '';

  const params = {
    accountId: activeAccountId || undefined,
    tab,
    search: search.trim() || undefined,
    assignedUserId: assignee,
    leadStatus,
  };
  const { data: conversations, isLoading } = useAsync(
    () => (activeAccountId ? listConversations(params) : Promise.resolve([])),
    [JSON.stringify(params), reloadKey]
  );

  const account = accounts?.find((a) => a.id === activeAccountId);
  const refresh = () => setReloadKey((k) => k + 1);

  if (!accountsLoading && (accounts ?? []).length === 0) {
    return (
      <div>
        <PageHeader title="Conversations" breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Conversations' }]} />
        <Card>
          <EmptyState
            icon={MessageSquare}
            title="No WhatsApp number linked"
            description="Link a WhatsApp Business number under Settings → WhatsApp. Once Meta starts posting to its webhook, every conversation lands here."
            action={
              <Button variant="primary" onClick={() => (window.location.href = '/settings/whatsapp')}>
                Link a number
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Conversations"
        description="Every WhatsApp thread on your linked business numbers, with the lead it belongs to."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Conversations' }]}
        actions={
          <Select
            aria-label="WhatsApp number"
            value={activeAccountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              setSelectedId(null);
            }}
            options={(accounts ?? []).map((a) => ({
              value: a.id,
              label: `${a.label} · ${a.displayPhone}${a.unreadCount > 0 ? ` (${a.unreadCount})` : ''}`,
            }))}
          />
        }
      />

      {account && account.status === 'error' && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p>
            <strong>{account.label} is erroring.</strong> {account.lastError}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22rem_1fr_20rem]">
        <ConversationList
          conversations={conversations ?? []}
          isLoading={isLoading}
          selectedId={selectedId}
          onSelect={async (conversation) => {
            setSelectedId(conversation.id);
            if (conversation.unreadCount > 0) {
              await markConversationRead(conversation.id);
              refresh();
            }
          }}
          tab={tab}
          onTab={setTab}
          search={search}
          onSearch={setSearch}
          assignee={assignee}
          onAssignee={setAssignee}
          leadStatus={leadStatus}
          onLeadStatus={setLeadStatus}
        />

        {selectedId ? (
          <>
            <Thread conversationId={selectedId} onSent={refresh} toast={toast} />
            <LeadPanel conversationId={selectedId} onChanged={refresh} />
          </>
        ) : (
          <Card className="lg:col-span-2">
            <EmptyState
              icon={MessageSquare}
              title="Pick a conversation"
              description="Choose a thread on the left to read it, reply, and see the lead behind it."
            />
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left — the thread list
// ---------------------------------------------------------------------------

interface ListProps {
  conversations: WhatsAppConversation[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (conversation: WhatsAppConversation) => void;
  tab: ConversationTab;
  onTab: (tab: ConversationTab) => void;
  search: string;
  onSearch: (value: string) => void;
  assignee: string;
  onAssignee: (value: string) => void;
  leadStatus: LeadStatus | 'all';
  onLeadStatus: (value: LeadStatus | 'all') => void;
}

function ConversationList({
  conversations, isLoading, selectedId, onSelect,
  tab, onTab, search, onSearch, assignee, onAssignee, leadStatus, onLeadStatus,
}: ListProps) {
  return (
    <Card padded={false} className="flex max-h-[calc(100vh-13rem)] flex-col">
      <div className="space-y-2.5 border-b border-line p-3">
        <SearchInput value={search} onChange={onSearch} placeholder="Search lead(s)" />
        <div className="flex gap-2">
          <Select
            aria-label="Assignee"
            value={assignee}
            onChange={(e) => onAssignee(e.target.value)}
            options={[{ value: 'all', label: 'Assignee' }, ...assignableUsers().map((u) => ({ value: u.id, label: u.name }))]}
            wrapperClassName="flex-1"
          />
          <Select
            aria-label="Lead status"
            value={leadStatus}
            onChange={(e) => onLeadStatus(e.target.value as LeadStatus | 'all')}
            options={LEAD_STATUS_OPTIONS}
            wrapperClassName="flex-1"
          />
        </div>
        <div className="flex rounded-lg bg-surface-muted p-0.5">
          {CONVERSATION_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onTab(t.key)}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-ring',
                tab === t.key ? 'bg-surface text-ink shadow-card' : 'text-ink-muted hover:text-ink'
              )}
            >
              {t.label}
              {t.key === 'all' && conversations.length > 0 && tab === 'all' && ` (${conversations.length})`}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="p-4 text-sm text-ink-faint">Loading conversations...</p>
        ) : conversations.length === 0 ? (
          <p className="p-4 text-sm text-ink-faint">
            {tab === 'pending'
              ? 'Nothing is waiting on a reply.'
              : tab === 'intervened'
                ? 'Nobody has replied to a thread yet.'
                : 'No conversations on this number yet.'}
          </p>
        ) : (
          conversations.map((c) => {
            const name = c.leadName || c.contactName || c.contactPhone;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c)}
                className={cn(
                  'flex w-full items-start gap-3 border-b border-line px-3 py-3 text-left transition-colors hover:bg-surface-subtle focus-ring',
                  selectedId === c.id && 'bg-surface-subtle'
                )}
              >
                <Avatar name={name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-medium text-ink">{name}</p>
                    <span className="shrink-0 text-[11px] text-ink-faint">
                      {c.lastMessageAt ? formatRelativeTime(c.lastMessageAt) : ''}
                    </span>
                  </div>
                  <p className="truncate text-xs text-ink-muted">{c.lastMessagePreview ?? 'No messages yet'}</p>
                </div>
                {c.unreadCount > 0 && (
                  <span className="mt-1 shrink-0 rounded-full bg-success-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {c.unreadCount}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Middle — the chat thread
// ---------------------------------------------------------------------------

function TickIcon({ status }: { status: string }) {
  if (status === 'read') return <CheckCheck size={12} className="text-info-500" />;
  if (status === 'delivered') return <CheckCheck size={12} />;
  if (status === 'failed') return <AlertTriangle size={12} className="text-danger-500" />;
  return <Check size={12} />;
}

function Thread({
  conversationId, onSent, toast,
}: { conversationId: string; onSent: () => void; toast: ReturnType<typeof useToast>['toast'] }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: conversation } = useAsync(() => getConversation(conversationId), [conversationId, reloadKey]);
  const { data: messages, isLoading } = useAsync(() => listMessages(conversationId), [conversationId, reloadKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const send = async () => {
    if (!conversation) return;
    const usingTemplate = !conversation.canReply;
    if (usingTemplate ? !templateName.trim() : !draft.trim()) return;
    setSending(true);
    try {
      await sendWhatsAppMessage(conversationId, usingTemplate ? { templateName: templateName.trim() } : { body: draft.trim() });
      setDraft('');
      setTemplateName('');
      setReloadKey((k) => k + 1);
      onSent();
    } catch (err) {
      toast({ title: 'Could not send', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setSending(false);
    }
  };

  const name = conversation?.leadName || conversation?.contactName || conversation?.contactPhone || '';

  return (
    <Card padded={false} className="flex max-h-[calc(100vh-13rem)] flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line p-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={name} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{name}</p>
            <p className="text-xs text-ink-faint">{conversation?.contactPhone}</p>
          </div>
        </div>
        {conversation && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
              conversation.canReply ? 'bg-success-50 text-success-700' : 'bg-warning-50 text-warning-700'
            )}
            title="WhatsApp only allows a freeform reply within 24 hours of the customer's last message."
          >
            <Clock3 size={11} />
            {formatWindowLeft(conversation.windowMinutesLeft)}
          </span>
        )}
      </div>

      <div className="flex-1 space-y-2.5 overflow-y-auto bg-surface-subtle p-4">
        {isLoading ? (
          <p className="text-sm text-ink-faint">Loading messages...</p>
        ) : (messages ?? []).length === 0 ? (
          <p className="text-sm text-ink-faint">No messages in this thread yet.</p>
        ) : (
          (messages ?? []).map((m: WhatsAppMessage) => {
            const outbound = m.direction === 'outbound';
            return (
              <div key={m.id} className={cn('flex', outbound ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm',
                    outbound ? 'bg-brand-600 text-white' : 'bg-surface text-ink shadow-card'
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{m.body || `[${m.type}]`}</p>
                  <p
                    className={cn(
                      'mt-1 flex items-center justify-end gap-1 text-[10px]',
                      outbound ? 'text-white/70' : 'text-ink-faint'
                    )}
                  >
                    {formatDateTime(m.sentAt).split(', ')[1] ?? formatDateTime(m.sentAt)}
                    {outbound && <TickIcon status={m.status} />}
                  </p>
                  {m.error && <p className="mt-1 text-[10px] text-danger-200">{m.error}</p>}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-line p-3">
        {conversation && !conversation.canReply ? (
          <>
            <p className="mb-2 flex items-start gap-1.5 text-xs text-warning-700">
              <Info size={13} className="mt-0.5 shrink-0" />
              The 24-hour window has closed. WhatsApp only allows an approved template until the customer writes again.
            </p>
            <div className="flex items-end gap-2">
              <Input
                aria-label="Template name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="approved_template_name"
                wrapperClassName="flex-1"
              />
              <Button variant="primary" leftIcon={<Send size={14} />} isLoading={sending} onClick={send} disabled={!templateName.trim()}>
                Send Template
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Type a message"
              rows={2}
              className="flex-1 resize-none rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-ring"
            />
            <Button variant="primary" size="icon" aria-label="Send" isLoading={sending} onClick={send} disabled={!draft.trim()}>
              <Send size={15} />
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Right — the lead behind the thread
// ---------------------------------------------------------------------------

function LeadPanel({ conversationId, onChanged }: { conversationId: string; onChanged: () => void }) {
  const navigate = useNavigate();
  const [reloadKey, setReloadKey] = useState(0);
  const { data: conversation } = useAsync(() => getConversation(conversationId), [conversationId, reloadKey]);
  const { data: lead } = useAsync(
    () => (conversation?.leadId ? getLead(conversation.leadId) : Promise.resolve(undefined)),
    [conversation?.leadId]
  );

  if (!conversation) return <Card><p className="text-sm text-ink-faint">Loading...</p></Card>;

  return (
    <Card className="max-h-[calc(100vh-13rem)] overflow-y-auto">
      <div className="mb-4">
        <p className="text-base font-semibold text-ink">{conversation.leadName ?? conversation.contactName ?? 'Unknown contact'}</p>
        {conversation.leadStatus && (
          <div className="mt-1.5">
            <StatusBadge kind="leadStatus" status={conversation.leadStatus} />
          </div>
        )}
      </div>

      <dl className="space-y-3 text-sm">
        <Field label="Phone" value={conversation.contactPhone} />
        {lead?.email && <Field label="Email" value={lead.email} />}
        {lead?.city && <Field label="City" value={lead.city} />}
        {lead?.company && <Field label="Company" value={lead.company} />}
        {lead?.source && <Field label="Source" value={lead.source} />}
        <div className="flex flex-col gap-1.5 border-b border-line pb-2.5">
          <dt className="text-ink-muted">Assignee</dt>
          <Select
            aria-label="Assignee"
            value={conversation.assignedUserId ?? ''}
            onChange={async (e) => {
              await updateConversation(conversation.id, { assignedUserId: e.target.value });
              setReloadKey((k) => k + 1);
              onChanged();
            }}
            options={[{ value: '', label: 'Unassigned' }, ...assignableUsers().map((u) => ({ value: u.id, label: u.name }))]}
          />
        </div>
        {conversation.assignedUserId && (
          <Field label="Owner" value={userDisplayName(conversation.assignedUserId)} />
        )}
        {lead?.notes && <Field label="Notes" value={lead.notes} />}
      </dl>

      {conversation.leadId && (
        <Button
          variant="outline"
          size="sm"
          className="mt-4 w-full"
          leftIcon={<User size={13} />}
          onClick={() => navigate(`/crm/leads/${conversation.leadId}`)}
        >
          Open full lead
        </Button>
      )}

      {!conversation.leadId && (
        <p className="mt-4 flex items-start gap-1.5 text-xs text-ink-faint">
          <Info size={12} className="mt-0.5 shrink-0" />
          This thread is not linked to a lead. Turn on "Create a lead from an unknown number" for this WhatsApp number
          in Settings → WhatsApp.
        </p>
      )}

      {conversation.intervened && (
        <p className="mt-3 text-xs text-ink-faint">
          <Badge tone="info">Intervened</Badge> — someone from the team has replied here.
        </p>
      )}
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line pb-2.5">
      <dt className="shrink-0 text-ink-muted">{label}</dt>
      <dd className="break-words text-right font-medium text-ink">{value}</dd>
    </div>
  );
}
