import { Fragment, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Check, CheckCheck, Clock3, Info, MessageSquare, Send, User,
} from 'lucide-react';
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
import { Skeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  getConversation, listConversations, listMessages, listWhatsAppAccounts, markConversationRead,
  sendWhatsAppMessage, updateConversation, CONVERSATION_TABS, formatWindowLeft,
  type ConversationTab,
} from '../../services/whatsappService';
import { getLead } from '../../services/leadService';
import { assignableUsers } from '../../data/referenceData';
import { formatDate, formatTime } from '../../utils/format';
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

/** Calendar-day difference between `iso` and today, in local time. */
function daysAgo(iso: string): number {
  const d = new Date(iso);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((start(today) - start(d)) / 86_400_000);
}

/** Inbox-style stamp: a time today, "Yesterday", a weekday this week, then a date. */
function listTime(iso: string): string {
  const days = daysAgo(iso);
  if (days <= 0) return formatTime(iso);
  if (days === 1) return 'Yesterday';
  if (days < 7) return new Date(iso).toLocaleDateString('en-IN', { weekday: 'short' });
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function dayLabel(iso: string): string {
  const days = daysAgo(iso);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return formatDate(iso);
}

export function Conversations() {
  const navigate = useNavigate();
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
              <Button variant="primary" onClick={() => navigate('/settings/whatsapp')}>
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
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <p>
            <strong className="font-semibold">{account.label} is erroring.</strong> {account.lastError}
          </p>
        </div>
      )}

      {/* One frame, three panes split by hairlines — list, thread, lead. */}
      <div
        className={cn(
          'grid grid-cols-1 overflow-hidden rounded-xl border border-line bg-surface',
          'lg:h-[calc(100vh-11rem)] lg:min-h-[32rem] lg:grid-cols-[18rem_minmax(0,1fr)_15rem] xl:grid-cols-[20rem_minmax(0,1fr)_17rem]'
        )}
      >
        <ConversationList
          conversations={conversations ?? []}
          isLoading={isLoading}
          selectedId={selectedId}
          hiddenOnMobile={!!selectedId}
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
            <Thread conversationId={selectedId} onSent={refresh} onBack={() => setSelectedId(null)} toast={toast} />
            <LeadPanel conversationId={selectedId} onChanged={refresh} />
          </>
        ) : (
          <div className="hidden flex-col items-center justify-center bg-surface-subtle lg:col-span-2 lg:flex">
            <EmptyState
              icon={MessageSquare}
              title="Pick a conversation"
              description="Choose a thread on the left to read it, reply, and see the lead behind it."
            />
            {account && (
              <p className="-mt-4 text-2xs tabular-nums text-ink-faint">
                {account.label} · {account.displayPhone} — {account.conversationCount} conversation
                {account.conversationCount === 1 ? '' : 's'}, {account.unreadCount} unread
              </p>
            )}
          </div>
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
  /** Below `lg` the list and the open thread take turns on screen. */
  hiddenOnMobile: boolean;
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
  conversations, isLoading, selectedId, hiddenOnMobile, onSelect,
  tab, onTab, search, onSearch, assignee, onAssignee, leadStatus, onLeadStatus,
}: ListProps) {
  const unreadThreads = conversations.filter((c) => c.unreadCount > 0).length;

  return (
    <section
      aria-label="Conversations"
      className={cn(
        'min-h-0 flex-col border-b border-line lg:border-b-0 lg:border-r',
        hiddenOnMobile ? 'hidden lg:flex' : 'flex'
      )}
    >
      <div className="space-y-2 border-b border-line p-3">
        <SearchInput value={search} onChange={onSearch} placeholder="Search lead(s)" />
        <div className="grid grid-cols-2 gap-2">
          <Select
            aria-label="Assignee"
            value={assignee}
            onChange={(e) => onAssignee(e.target.value)}
            options={[{ value: 'all', label: 'Assignee' }, ...assignableUsers().map((u) => ({ value: u.id, label: u.name }))]}
          />
          <Select
            aria-label="Lead status"
            value={leadStatus}
            onChange={(e) => onLeadStatus(e.target.value as LeadStatus | 'all')}
            options={LEAD_STATUS_OPTIONS}
          />
        </div>
        <div role="tablist" aria-label="Conversation filter" className="flex rounded-lg border border-line bg-surface-subtle p-0.5">
          {CONVERSATION_TABS.map((t) => {
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => onTab(t.key)}
                className={cn(
                  'h-6 flex-1 rounded-md text-xs font-medium transition-colors duration-100 focus-ring',
                  on ? 'border border-line bg-surface text-ink' : 'text-ink-subtle hover:text-ink'
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {!isLoading && conversations.length > 0 && (
        <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-2xs tabular-nums text-ink-faint">
          <span>
            {conversations.length} thread{conversations.length === 1 ? '' : 's'}
          </span>
          {unreadThreads > 0 && <span className="font-medium text-brand-700">{unreadThreads} unread</span>}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="divide-y divide-line">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2.5 px-3 py-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-2.5 w-1/2" />
                  <Skeleton className="h-2.5 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <MessageSquare size={16} className="mx-auto text-ink-faint" aria-hidden="true" />
            <p className="mt-2 text-xs text-ink-subtle">
              {search.trim() || assignee !== 'all' || leadStatus !== 'all'
                ? 'No threads match these filters.'
                : tab === 'pending'
                  ? 'Nothing is waiting on a reply.'
                  : tab === 'intervened'
                    ? 'Nobody has replied to a thread yet.'
                    : 'No conversations on this number yet.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {conversations.map((c) => {
              const name = c.leadName || c.contactName || c.contactPhone;
              const selected = selectedId === c.id;
              const unread = c.unreadCount > 0;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c)}
                    aria-current={selected ? 'true' : undefined}
                    className={cn(
                      'relative flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors duration-100 focus-ring',
                      selected ? 'bg-brand-50' : 'hover:bg-surface-subtle'
                    )}
                  >
                    {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-brand-600" aria-hidden="true" />}
                    <Avatar name={name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <p className={cn('min-w-0 flex-1 truncate text-[13px] text-ink', unread ? 'font-semibold' : 'font-medium')}>
                          {name}
                        </p>
                        {c.lastMessageAt && (
                          <time
                            dateTime={c.lastMessageAt}
                            className={cn('shrink-0 text-2xs tabular-nums', unread ? 'font-medium text-brand-700' : 'text-ink-faint')}
                          >
                            {listTime(c.lastMessageAt)}
                          </time>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <p className={cn('min-w-0 flex-1 truncate text-xs', unread ? 'text-ink-muted' : 'text-ink-subtle')}>
                          {c.lastMessagePreview ?? 'No messages yet'}
                        </p>
                        {unread && (
                          <span
                            className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-brand-600 px-1 text-2xs font-semibold tabular-nums text-white"
                            aria-label={`${c.unreadCount} unread`}
                          >
                            {c.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Middle — the chat thread
// ---------------------------------------------------------------------------

const TICK_LABEL: Record<string, string> = { read: 'Read', delivered: 'Delivered', failed: 'Failed', sent: 'Sent', queued: 'Queued' };

function TickIcon({ status }: { status: string }) {
  const label = TICK_LABEL[status] ?? status;
  if (status === 'read') return <CheckCheck size={12} className="text-white" aria-label={label} />;
  if (status === 'delivered') return <CheckCheck size={12} aria-label={label} />;
  if (status === 'failed') return <AlertTriangle size={12} aria-label={label} />;
  return <Check size={12} aria-label={label} />;
}

function Thread({
  conversationId, onSent, onBack, toast,
}: {
  conversationId: string;
  onSent: () => void;
  onBack: () => void;
  toast: ReturnType<typeof useToast>['toast'];
}) {
  const navigate = useNavigate();
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: conversation } = useAsync(() => getConversation(conversationId), [conversationId, reloadKey]);
  const { data: messages, isLoading } = useAsync(() => listMessages(conversationId), [conversationId, reloadKey]);

  // Scroll the message pane itself, not the page, to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
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
  const list = messages ?? [];

  return (
    <section aria-label="Thread" className="flex min-h-0 min-w-0 flex-col">
      <div className="flex items-center gap-2.5 border-b border-line px-3 py-2.5">
        <Button variant="ghost" size="icon" className="-ml-1 h-7 w-7 lg:hidden" aria-label="Back to conversations" onClick={onBack}>
          <ArrowLeft size={15} />
        </Button>
        <Avatar name={name || '?'} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-[13px] font-semibold text-ink">{name}</p>
            {conversation?.leadStatus && (
              <span className="hidden shrink-0 sm:inline-flex">
                <StatusBadge kind="leadStatus" status={conversation.leadStatus} />
              </span>
            )}
          </div>
          <p className="truncate text-2xs tabular-nums text-ink-faint">
            {conversation?.contactPhone}
            {conversation?.intervened && ' · The team has replied here'}
          </p>
        </div>
        {conversation && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-px text-2xs font-medium tabular-nums',
              conversation.canReply ? 'bg-success-50 text-success-700' : 'bg-warning-50 text-warning-700'
            )}
            title="WhatsApp only allows a freeform reply within 24 hours of the customer's last message."
          >
            <Clock3 size={11} />
            {conversation.canReply ? `${formatWindowLeft(conversation.windowMinutesLeft)} left` : 'Window closed'}
          </span>
        )}
        {conversation?.leadId && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            aria-label="Open lead"
            leftIcon={<User size={13} />}
            onClick={() => navigate(`/crm/leads/${conversation.leadId}`)}
          >
            <span className="hidden sm:inline">Open lead</span>
          </Button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="min-h-[18rem] flex-1 overflow-y-auto bg-surface-subtle px-4 py-3 max-lg:max-h-[60vh] lg:min-h-0"
      >
        {isLoading ? (
          <p className="py-6 text-center text-xs text-ink-faint">Loading messages…</p>
        ) : list.length === 0 ? (
          <p className="py-6 text-center text-xs text-ink-faint">No messages in this thread yet.</p>
        ) : (
          <div className="space-y-1.5">
            {list.map((m: WhatsAppMessage, i) => {
              const outbound = m.direction === 'outbound';
              const day = dayLabel(m.sentAt);
              const newDay = i === 0 || dayLabel(list[i - 1].sentAt) !== day;
              return (
                <Fragment key={m.id}>
                  {newDay && (
                    <div className="flex justify-center py-2">
                      <span className="rounded-sm border border-line bg-surface px-2 py-px text-2xs font-medium text-ink-subtle">{day}</span>
                    </div>
                  )}
                  <div className={cn('flex', outbound ? 'justify-end' : 'justify-start')}>
                    <div className={cn('flex max-w-[78%] flex-col', outbound ? 'items-end' : 'items-start')}>
                      <div
                        className={cn(
                          'rounded-xl px-3 py-1.5 text-[13px] leading-5',
                          outbound ? 'rounded-br-sm bg-brand-600 text-white' : 'rounded-bl-sm border border-line bg-surface text-ink'
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.body || `[${m.type}]`}</p>
                        <p
                          className={cn(
                            'mt-0.5 flex items-center justify-end gap-1 text-2xs tabular-nums',
                            outbound ? 'text-white/70' : 'text-ink-faint'
                          )}
                        >
                          {formatTime(m.sentAt)}
                          {outbound && <TickIcon status={m.status} />}
                        </p>
                      </div>
                      {m.error && (
                        <p className="mt-1 flex items-start gap-1 text-2xs text-danger-600">
                          <AlertTriangle size={11} className="mt-px shrink-0" />
                          {m.error}
                        </p>
                      )}
                    </div>
                  </div>
                </Fragment>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-line p-3">
        {conversation && !conversation.canReply ? (
          <div className="space-y-2">
            <p className="flex items-start gap-1.5 rounded-lg bg-warning-50 px-2.5 py-1.5 text-xs text-warning-700">
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
          </div>
        ) : (
          <div className="rounded-lg border border-line-strong bg-surface transition-colors duration-100 focus-within:border-brand-600">
            <textarea
              aria-label="Message"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Type a WhatsApp message"
              rows={2}
              className="block w-full resize-none bg-transparent px-3 pt-2 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2 pb-1.5 pl-3 pr-1.5">
              <span className="hidden text-2xs text-ink-faint sm:inline">Enter to send · Shift + Enter for a new line</span>
              <Button
                variant="primary"
                size="sm"
                className="ml-auto"
                leftIcon={<Send size={13} />}
                isLoading={sending}
                onClick={send}
                disabled={!draft.trim()}
              >
                Send
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
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

  return (
    <aside aria-label="Lead" className="min-h-0 overflow-y-auto border-t border-line lg:border-l lg:border-t-0">
      {!conversation ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      ) : (
        <>
          <div className="border-b border-line px-4 py-3">
            <p className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">{conversation.leadId ? 'Lead' : 'Contact'}</p>
            {conversation.leadId ? (
              <button
                type="button"
                onClick={() => navigate(`/crm/leads/${conversation.leadId}`)}
                className="mt-1 block max-w-full truncate rounded text-left text-[13px] font-semibold text-ink hover:text-brand-700 focus-ring"
              >
                {conversation.leadName ?? conversation.contactName ?? 'Unknown contact'}
              </button>
            ) : (
              <p className="mt-1 truncate text-[13px] font-semibold text-ink">{conversation.contactName ?? 'Unknown contact'}</p>
            )}
            {(conversation.leadStatus || conversation.intervened) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {conversation.leadStatus && <StatusBadge kind="leadStatus" status={conversation.leadStatus} />}
                {conversation.intervened && <Badge tone="info">Intervened</Badge>}
              </div>
            )}
          </div>

          <dl className="divide-y divide-line px-4 text-xs">
            <Field label="Phone" value={conversation.contactPhone} />
            {lead?.email && <Field label="Email" value={lead.email} />}
            {lead?.city && <Field label="City" value={lead.city} />}
            {lead?.company && <Field label="Company" value={lead.company} />}
            {lead?.source && <Field label="Source" value={lead.source} />}
          </dl>

          <div className="space-y-1 border-t border-line px-4 py-3">
            <label htmlFor="conv-assignee" className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
              Assignee
            </label>
            <Select
              id="conv-assignee"
              value={conversation.assignedUserId ?? ''}
              onChange={async (e) => {
                await updateConversation(conversation.id, { assignedUserId: e.target.value });
                setReloadKey((k) => k + 1);
                onChanged();
              }}
              options={[{ value: '', label: 'Unassigned' }, ...assignableUsers().map((u) => ({ value: u.id, label: u.name }))]}
            />
          </div>

          {lead?.notes && (
            <div className="border-t border-line px-4 py-3">
              <p className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">Notes</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-xs text-ink-muted">{lead.notes}</p>
            </div>
          )}

          {!conversation.leadId && (
            <p className="mx-4 my-3 flex items-start gap-1.5 rounded-lg bg-surface-subtle px-2.5 py-2 text-xs text-ink-subtle">
              <Info size={12} className="mt-0.5 shrink-0" />
              This thread is not linked to a lead. Turn on "Create a lead from an unknown number" for this WhatsApp number
              in Settings → WhatsApp.
            </p>
          )}

          {conversation.intervened && (
            <p className="mx-4 my-3 text-2xs text-ink-faint">Someone from the team has replied in this thread.</p>
          )}
        </>
      )}
    </aside>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <dt className="shrink-0 text-ink-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium tabular-nums text-ink">{value}</dd>
    </div>
  );
}
