import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Image as ImageIcon, FileText, Plus, RefreshCw, Trash2, Video } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { Select } from '../../components/ui/Select';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useToast } from '../../context/ToastContext';
import { listManagedTemplates, removeTemplate } from '../../services/whatsappTemplateService';
import type { ManagedWhatsAppTemplate } from '../../types';

const STATUS_TONE: Record<string, BadgeTone> = { APPROVED: 'success', PENDING: 'warning', REJECTED: 'danger' };
const STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'PENDING', label: 'Pending review' },
  { value: 'REJECTED', label: 'Rejected' },
];

const HEADER_ICON = { IMAGE: ImageIcon, VIDEO: Video, DOCUMENT: FileText } as const;

/** Every template on the number with the status Meta gives it right now. Creating and sending live on their own pages. */
export function WhatsAppTemplateList() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<ManagedWhatsAppTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [toDelete, setToDelete] = useState<ManagedWhatsAppTemplate | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setTemplates(await listManagedTemplates());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read templates from Meta.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmDelete = async () => {
    if (!toDelete) return;
    const name = toDelete.name;
    setToDelete(null);
    try {
      await removeTemplate(name);
      toast({ title: `Deleted ${name}`, variant: 'success' });
      await load();
    } catch (err) {
      toast({ title: 'Could not delete', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    }
  };

  const shown = (templates ?? []).filter((t) => filter === 'all' || t.status === filter);

  return (
    <div>
      <PageHeader
        title="WhatsApp Templates"
        description="Every template on your WhatsApp number and where it stands with Meta's review."
        breadcrumb={[{ label: 'Notifications', to: '/notifications' }, { label: 'WhatsApp Templates' }]}
        actions={
          <>
            <Button variant="outline" leftIcon={<RefreshCw size={14} />} isLoading={refreshing} onClick={() => void load()}>
              Refresh status
            </Button>
            <Link to="/notifications/whatsapp/templates/new">
              <Button variant="primary" leftIcon={<Plus size={14} />}>Create template</Button>
            </Link>
          </>
        }
      />

      {error ? (
        <Card>
          <p className="text-sm font-medium text-danger-600">{error}</p>
          <p className="mt-1 text-sm text-ink-muted">
            Templates are read live from Meta — this needs a linked number with a working access token and WABA ID in{' '}
            <a className="underline" href="/settings/whatsapp">Settings → WhatsApp</a>.
          </p>
        </Card>
      ) : templates === null ? (
        <CardSkeleton />
      ) : (
        <>
          <div className="mb-4 max-w-xs">
            <Select label="Show" value={filter} onChange={(e) => setFilter(e.target.value)} options={STATUS_FILTERS} />
          </div>

          {shown.length === 0 ? (
            <Card>
              <p className="text-sm text-ink-faint">
                {templates.length === 0 ? 'No templates yet.' : 'No templates with that status.'}{' '}
                <Link className="underline" to="/notifications/whatsapp/templates/new">Create one</Link>.
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {shown.map((t) => {
                const Icon = HEADER_ICON[t.headerFormat as keyof typeof HEADER_ICON];
                return (
                  <Card key={`${t.name}-${t.language}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{t.name}</p>
                        <p className="text-xs text-ink-faint">{t.category} · {t.language}</p>
                      </div>
                      <Badge tone={STATUS_TONE[t.status] ?? 'neutral'}>{t.status.charAt(0) + t.status.slice(1).toLowerCase()}</Badge>
                    </div>

                    {Icon && (
                      <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-ink-muted">
                        <Icon size={14} /> {t.headerFormat!.charAt(0) + t.headerFormat!.slice(1).toLowerCase()} header — file is chosen when you send
                      </p>
                    )}
                    {t.headerFormat === 'TEXT' && t.header && <p className="mt-3 text-sm font-semibold text-ink">{t.header}</p>}
                    <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">{t.body}</p>
                    {t.footer && <p className="mt-2 text-xs text-ink-faint">{t.footer}</p>}
                    {t.buttons.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {t.buttons.map((b, i) => (
                          <Badge key={i} tone="info">{b.text}</Badge>
                        ))}
                      </div>
                    )}
                    {t.rejectedReason && <p className="mt-3 text-xs text-danger-600">Rejected: {t.rejectedReason}</p>}

                    <div className="mt-3 flex justify-end gap-2 border-t border-line pt-3">
                      {t.status === 'APPROVED' && (
                        <Link to="/notifications/whatsapp"><Button variant="outline" size="sm">Send</Button></Link>
                      )}
                      <Button variant="ghost" size="sm" className="text-danger-600" leftIcon={<Trash2 size={13} />} onClick={() => setToDelete(t)}>
                        Delete
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      <ConfirmationDialog
        isOpen={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        title={`Delete "${toDelete?.name}"?`}
        description="It is removed from WhatsApp for every language. A deleted name cannot be reused for about a month."
        confirmLabel="Delete template"
        variant="danger"
      />
    </div>
  );
}
