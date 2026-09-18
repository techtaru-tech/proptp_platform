import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Pagination } from '../../components/ui/Pagination';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { FilterBar } from '../../components/tables/FilterBar';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../context/ToastContext';
import { listForms, deleteForm, type FormListParams } from '../../services/formService';
import { formatDateTime } from '../../utils/format';
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
        <div>
          <p className="font-medium text-ink">{form.name}</p>
          {form.displayTitle && <p className="text-xs text-ink-faint">{form.displayTitle}</p>}
        </div>
      ),
    },
    { key: 'slug', header: 'Slug', sortable: true, render: (form) => <code className="text-xs text-ink-muted">/f/{form.slug}</code> },
    {
      key: 'isActive',
      header: 'Active',
      align: 'center',
      render: (form) => <Badge tone={form.isActive ? 'success' : 'neutral'}>{form.isActive ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      key: 'isMultiStep',
      header: 'Multi-step',
      align: 'center',
      render: (form) => (form.isMultiStep ? <Badge tone="info">Yes</Badge> : <span className="text-ink-faint">—</span>),
    },
    { key: 'submissionCount', header: 'Submissions', align: 'center', render: (form) => form.submissionCount ?? 0 },
    { key: 'createdAt', header: 'Created', sortable: true, render: (form) => formatDateTime(form.createdAt) },
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
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-line bg-white p-4 text-sm text-ink-muted shadow-card">
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
