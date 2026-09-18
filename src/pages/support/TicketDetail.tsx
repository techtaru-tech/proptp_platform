import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Paperclip, Send, X } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Avatar } from '../../components/ui/Avatar';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { getTicket, replyToTicket, updateTicketStatus } from '../../services/supportService';
import { ACCEPT_MEDIA } from '../../components/ui/FileUpload';
import { fileUrl, uploadFiles } from '../../services/apiClient';
import { formatDateTime, formatRelativeTime } from '../../utils/format';
import { cn } from '../../utils/cn';
import type { TicketStatus } from '../../types';

const STATUS_OPTIONS: { value: TicketStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

export function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [attaching, setAttaching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: ticket, isLoading, error } = useAsync(() => getTicket(id ?? ''), [id, reloadKey]);

  const handleAttach = async (files: FileList | null) => {
    const picked = Array.from(files ?? []);
    if (picked.length === 0) return;
    setAttaching(true);
    try {
      const urls = await uploadFiles(picked);
      setAttachments((current) => [...current, ...urls]);
    } catch (err) {
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSend = async () => {
    if (!ticket || (!message.trim() && attachments.length === 0)) return;
    setSending(true);
    try {
      await replyToTicket(ticket.id, message.trim(), attachments);
      setMessage('');
      setAttachments([]);
      toast({ title: 'Reply sent', description: `Your reply to ${ticket.userName} has been posted.`, variant: 'success' });
      setReloadKey((k) => k + 1);
    } finally {
      setSending(false);
    }
  };

  const handleStatusChange = async (status: TicketStatus) => {
    if (!ticket) return;
    await updateTicketStatus(ticket.id, status);
    toast({ title: 'Status updated', description: `Ticket ${ticket.id} is now ${status}.`, variant: 'success' });
    setReloadKey((k) => k + 1);
  };

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Support Ticket" breadcrumb={[{ label: 'Support', to: '/support' }, { label: id ?? '' }]} />
        <CardSkeleton />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div>
        <PageHeader title="Support Ticket" breadcrumb={[{ label: 'Support', to: '/support' }, { label: id ?? '' }]} />
        <Card>
          {error ? (
            <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
          ) : (
            <EmptyState
              title="Ticket not found"
              description="This support ticket does not exist."
              action={
                <Button variant="outline" onClick={() => navigate('/support')}>
                  Back to Tickets
                </Button>
              }
            />
          )}
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={ticket.subject}
        description={`Raised by ${ticket.userName} · Ticket ${ticket.id}`}
        breadcrumb={[{ label: 'Support', to: '/support' }, { label: ticket.id }]}
        actions={
          <Select
            value={ticket.status}
            onChange={(e) => handleStatusChange(e.target.value as TicketStatus)}
            options={STATUS_OPTIONS}
            wrapperClassName="w-36"
            aria-label="Change ticket status"
          />
        }
      />

      <Card padded={false}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <Avatar name={ticket.userName} size="sm" />
            <div>
              <p className="text-sm font-medium text-ink">{ticket.userName}</p>
              <p className="text-xs text-ink-faint">Opened {formatDateTime(ticket.createdAt)}</p>
            </div>
          </div>
          <StatusBadge kind="ticket" status={ticket.status} />
        </div>

        <div className="max-h-[28rem] space-y-4 overflow-y-auto p-5">
          {ticket.messages.map((m) => {
            const isAdmin = m.authorRole === 'admin';
            return (
              <div key={m.id} className={cn('flex', isAdmin ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[75%]', isAdmin && 'text-right')}>
                  <div
                    className={cn(
                      'rounded-2xl px-4 py-2.5 text-sm',
                      isAdmin ? 'bg-brand-600 text-white' : 'bg-surface-muted text-ink'
                    )}
                  >
                    {m.message}
                  </div>
                  {m.attachments && m.attachments.length > 0 && (
                    <div className={cn('mt-1.5 flex flex-wrap gap-1.5', isAdmin && 'justify-end')}>
                      {m.attachments.map((url, i) => (
                        <a
                          key={url}
                          href={fileUrl(url)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-[11px] text-ink-muted hover:border-ink-faint focus-ring"
                        >
                          <Paperclip size={11} /> Attachment {i + 1}
                        </a>
                      ))}
                    </div>
                  )}
                  <p className="mt-1 text-[11px] text-ink-faint">
                    {m.authorName} · {formatRelativeTime(m.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-line p-4">
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((url, i) => (
                <span key={url} className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-subtle px-2 py-1 text-[11px] text-ink-muted">
                  <Paperclip size={11} /> Attachment {i + 1}
                  <button
                    type="button"
                    aria-label="Remove attachment"
                    onClick={() => setAttachments((current) => current.filter((_, idx) => idx !== i))}
                    className="text-danger-600 hover:text-danger-700 focus-ring"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2.5">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type a reply..."
              rows={2}
              className="flex-1 resize-none rounded-lg border border-line-strong bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-ring"
            />
            <input ref={fileInputRef} type="file" accept={ACCEPT_MEDIA} multiple className="sr-only" onChange={(e) => handleAttach(e.target.files)} />
            <Button
              variant="outline"
              size="icon"
              aria-label="Attach file"
              title="Attach a file from your computer"
              isLoading={attaching}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={15} />
            </Button>
            <Button
              variant="primary"
              leftIcon={<Send size={14} />}
              onClick={handleSend}
              isLoading={sending}
              disabled={!message.trim() && attachments.length === 0}
            >
              Send
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
