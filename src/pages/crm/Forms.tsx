import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, ExternalLink, Eye, FileText, Inbox, Layers, Pencil, Plus, ToggleRight, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { StatCard } from '../../components/ui/StatCard';
import { Pagination } from '../../components/ui/Pagination';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { FilterBar } from '../../components/tables/FilterBar';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../context/ToastContext';
import { listForms, deleteForm, publicFormUrl, type FormListParams } from '../../services/formService';
import { formatDate, formatDateTime } from '../../utils/format';
import type { LeadForm } from '../../types';

const PAGE_SIZE = 10;

export function Forms() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [reloadKey, setReloadKey] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<LeadForm | null>(null);

  const debouncedSearch = useDebounce(search, 300);
  const params: FormListParams = { page, pageSize: PAGE_SIZE, search: debouncedSearch || undefined, sortBy, sortDir };
  const { data, isLoading, error } = useAsync(() => listForms(params), [JSON.stringify(params), reloadKey]);
  // Every form (not just this page of them) for the totals strip and the submission bars.
  const { data: all } = useAsync(() => listForms({ page: 1, pageSize: 200 }), [reloadKey]);
  const allForms = all?.items ?? [];
  const activeCount = allForms.filter((f) => f.isActive).length;
  const multiStepCount = allForms.filter((f) => f.isMultiStep).length;
  const totalSubmissions = allForms.reduce((sum, f) => sum + (f.submissionCount ?? 0), 0);
  const busiest = allForms.reduce<LeadForm | undefined>((b, f) => (!b || (f.submissionCount ?? 0) > (b.submissionCount ?? 0) ? f : b), undefined);
  const maxSubmissions = Math.max(1, busiest?.submissionCount ?? 0);

  const copyLink = async (form: LeadForm) => {
    try {
      await navigator.clipboard.writeText(publicFormUrl(form.slug));
      toast({ title: 'Link copied', description: publicFormUrl(form.slug), variant: 'success' });
    } catch {
      toast({ title: 'Could not copy the link', description: 'Select the text and copy it manually.', variant: 'error' });
    }
  };

  const handleSort = (key: string) => {
    if (key === sortBy) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(key);
      setSortDir('asc');
    }
    setPage(1);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteForm(deleteTarget.id);
    toast({ title: 'Form deleted', description: `"${deleteTarget.name}" and its submissions were removed.`, variant: 'success' });
    setDeleteTarget(null);
    setReloadKey((k) => k + 1);
  };

  const columns: DataTableColumn<LeadForm>[] = [
    {
      key: 'name',
      header: 'Form Name',
      sortable: true,
      render: (form) => (
        <div className="min-w-0">
          <p className="font-medium text-ink">{form.name}</p>
          {form.displayTitle && <p className="truncate text-xs text-ink-faint">{form.displayTitle}</p>}
        </div>
      ),
    },
    {
      key: 'slug',
      header: 'Public link',
      sortable: true,
      render: (form) => (
        <span className="group/link flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <code className="mr-1 text-xs text-ink-muted" title={publicFormUrl(form.slug)}>/f/{form.slug}</code>
          <button
            type="button"
            onClick={() => copyLink(form)}
            aria-label={`Copy the link to ${form.name}`}
            title="Copy link"
            className="rounded p-1 text-ink-faint transition-colors duration-100 hover:bg-surface-muted hover:text-ink focus-ring"
          >
            <Copy size={12} />
          </button>
          <a
            href={publicFormUrl(form.slug)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${form.name} in a new tab`}
            title="Open form"
            className="rounded p-1 text-ink-faint transition-colors duration-100 hover:bg-surface-muted hover:text-ink focus-ring"
          >
            <ExternalLink size={12} />
          </a>
        </span>
      ),
    },
    {
      key: 'isActive',
      header: 'Status',
      render: (form) => (
        <span className="flex flex-wrap items-center gap-1">
          <Badge tone={form.isActive ? 'success' : 'neutral'} dot>{form.isActive ? 'Active' : 'Inactive'}</Badge>
          {form.isMultiStep && <Badge tone="info">Multi-step</Badge>}
        </span>
      ),
    },
    {
      key: 'submissionCount',
      header: 'Submissions',
      width: '18%',
      render: (form) => {
        const n = form.submissionCount ?? 0;
        return (
          <span className="flex items-center gap-2.5" title={busiest && n > 0 ? `${Math.round((n / maxSubmissions) * 100)}% of the busiest form (${busiest.name})` : undefined}>
            <span className="w-8 shrink-0 text-right font-medium tabular-nums text-ink">{n.toLocaleString('en-IN')}</span>
            <span className="h-1.5 min-w-[3rem] flex-1 overflow-hidden rounded-sm bg-surface-muted">
              <span className="block h-full rounded-sm bg-brand-600" style={{ width: `${(n / maxSubmissions) * 100}%` }} />
            </span>
          </span>
        );
      },
    },
    {
      key: 'createdAt',
      header: 'Created',
      sortable: true,
      render: (form) => <span className="whitespace-nowrap tabular-nums text-ink-muted" title={formatDateTime(form.createdAt)}>{formatDate(form.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (form) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" leftIcon={<Eye size={13} />} onClick={() => navigate(`/crm/forms/${form.id}`)}>
            View
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<Pencil size={13} />} onClick={() => navigate(`/crm/forms/${form.id}/edit`)}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" className="text-danger-600" leftIcon={<Trash2 size={13} />} onClick={() => setDeleteTarget(form)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Forms"
        description="Public lead-capture forms. Every submission lands in the CRM as a new lead."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Forms' }]}
        actions={
          <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => navigate('/crm/forms/new')}>
            New Form
          </Button>
        }
      />

      {all && all.total > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <StatCard label="Forms" value={all.total} icon={Layers} tone="shell" footer={multiStepCount ? `${multiStepCount} multi-step` : 'All single-page'} />
          <StatCard label="Active" value={activeCount} icon={ToggleRight} tone="success" footer={`${all.total - activeCount} not accepting submissions`} />
          <StatCard
            label="Submissions"
            value={totalSubmissions.toLocaleString('en-IN')}
            icon={Inbox}
            tone="info"
            footer={busiest && (busiest.submissionCount ?? 0) > 0 ? `Most from ${busiest.name}` : 'All time'}
          />
        </div>
      )}

      <Card padded={false}>
        <FilterBar
          search={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          searchPlaceholder="Search forms by name or slug"
        />

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(form) => form.id}
          isLoading={isLoading}
          error={error}
          onRetry={() => setReloadKey((k) => k + 1)}
          onRowClick={(form) => navigate(`/crm/forms/${form.id}`)}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={handleSort}
          emptyTitle="No forms yet"
          emptyDescription="Create a form to start capturing leads from your website or ad landing pages."
        />

        {data && data.total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />}
      </Card>

      {data && data.total === 0 && !isLoading && !search && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
          <FileText size={16} className="shrink-0 text-ink-faint" />
          A form gets a public link at <code className="text-ink">/f/your-slug</code> and an embed snippet you can paste into any page.
        </div>
      )}

      <ConfirmationDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete this form?"
        description={
          deleteTarget
            ? `"${deleteTarget.name}" will stop accepting submissions and its ${deleteTarget.submissionCount ?? 0} stored submission(s) will be deleted. Leads already created stay in the CRM.`
            : undefined
        }
        confirmLabel="Delete form"
        variant="danger"
      />
    </div>
  );
}
