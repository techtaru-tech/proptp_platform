import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Copy, DownloadCloud, Edit2, KeyRound, Link2, Play, Plus, RefreshCw, ShieldCheck, ExternalLink, Info, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Input } from '../../components/ui/Input';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Tabs } from '../../components/ui/Tabs';
import { Modal } from '../../components/ui/Modal';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { Toggle } from '../../components/ui/Toggle';
import { FilterChips } from '../../components/ui/FilterChips';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { LeadSourceBadge } from '../../components/leads/LeadSourceBadge';
import {
  ConnectionBasicFields, ConnectionCredentialFields, ConnectionFieldMappingSection, supportsFieldMapping,
  type ConnectionFormValues,
} from './ConnectionForm';
import { WebhookTestModal } from './WebhookTestModal';
import { MetaPageLinker } from './MetaPageLinker';
import { MetaFieldMapping } from './MetaFieldMapping';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  listConnections, toggleConnectionActive, testConnection, updateConnection, deleteConnection,
  listIntegrationActivity, rotateWebhookToken, backfillMetaLeads, type ActivityListParams,
} from '../../services/integrationService';
import { formatDateTime, formatRelativeTime } from '../../utils/format';
import { OAUTH_CAPABLE_SOURCES, type IntegrationActivityEntry, type LeadSourceConnection } from '../../types';

const STATUS_CHIPS: { key: IntegrationActivityEntry['status'] | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'processed', label: 'Processed' },
  { key: 'pending', label: 'Pending' },
  { key: 'failed', label: 'Failed' },
  { key: 'invalid_signature', label: 'Invalid signature' },
];

/** How many of the newest webhook receipts the cards' 30-day lead counts are summed from. */
const RECEIPT_WINDOW = 500;

/** One label/value line on a connection card. */
function Fact({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-ink-subtle">{label}</dt>
      <dd className="min-w-0 truncate text-right text-ink" title={title}>{children}</dd>
    </div>
  );
}

function connectionToEditValues(c: LeadSourceConnection): ConnectionFormValues {
  return {
    name: c.name,
    source: c.source,
    active: c.active,
    credentials: {},
    fieldMapping: c.fieldMapping ? Object.entries(c.fieldMapping).map(([key, value]) => ({ key, value })) : [],
  };
}

export function Integrations() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [backfillingId, setBackfillingId] = useState<string | null>(null);
  const [connectionFilter, setConnectionFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<IntegrationActivityEntry['status'] | 'all'>('all');

  const { data: connections, isLoading } = useAsync(() => listConnections(), [reloadKey]);
  const metaConnection = connections?.find((c) => c.source === 'meta');

  const activityParams: ActivityListParams = { page: 1, pageSize: 30, connectionId: connectionFilter, status: statusFilter, sortBy: 'receivedAt', sortDir: 'desc' };
  const { data: activity, isLoading: activityLoading } = useAsync(() => listIntegrationActivity(activityParams), [JSON.stringify(activityParams), reloadKey]);

  /*
   * Leads each connection brought in over the last 30 days, summed from its webhook receipts.
   * Read from the newest receipts; if those run out before reaching 30 days back, the figure is
   * a floor and is shown with a "+".
   */
  const { data: receipts } = useAsync(
    () => listIntegrationActivity({ page: 1, pageSize: RECEIPT_WINDOW, connectionId: 'all', status: 'all', sortBy: 'receivedAt', sortDir: 'desc' }),
    [reloadKey]
  );
  const leads30 = useMemo(() => {
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const byConnection = new Map<string, number>();
    for (const r of receipts?.items ?? []) {
      if (new Date(r.receivedAt).getTime() < since) continue;
      byConnection.set(r.connectionId, (byConnection.get(r.connectionId) ?? 0) + (r.leadsCreated ?? 0));
    }
    const oldest = receipts?.items[receipts.items.length - 1];
    const complete = !!receipts && (receipts.total <= receipts.items.length || (!!oldest && new Date(oldest.receivedAt).getTime() < since));
    return { byConnection, complete, loaded: !!receipts };
  }, [receipts]);

  const [editTarget, setEditTarget] = useState<LeadSourceConnection | null>(null);
  const [editValues, setEditValues] = useState<ConnectionFormValues | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LeadSourceConnection | null>(null);
  const [testPayloadTarget, setTestPayloadTarget] = useState<LeadSourceConnection | null>(null);
  const [rotateTarget, setRotateTarget] = useState<LeadSourceConnection | null>(null);

  const handleToggleActive = async (id: string) => {
    await toggleConnectionActive(id);
    setReloadKey((k) => k + 1);
  };

  const handleRotateToken = async () => {
    if (!rotateTarget) return;
    const updated = await rotateWebhookToken(rotateTarget.id);
    toast({
      title: 'Webhook URL rotated',
      description: 'Update the URL in the source platform — the previous one no longer works.',
      variant: 'success',
    });
    setRotateTarget(null);
    // Keep the edit modal in step with the new URL if it happens to be open.
    setEditTarget((current) => (current && current.id === updated.id ? updated : current));
    setReloadKey((k) => k + 1);
  };

  const handleBackfill = async (connection: LeadSourceConnection) => {
    setBackfillingId(connection.id);
    try {
      const result = await backfillMetaLeads(connection.id);
      toast({ title: 'Import started', description: result.message, variant: 'success' });
    } catch (err) {
      toast({ title: 'Could not start the import', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setBackfillingId(null);
    }
  };

  const handleTest = async (connection: LeadSourceConnection) => {
    setTestingId(connection.id);
    try {
      const result = await testConnection(connection.id);
      toast({ title: result.success ? 'Connection OK' : 'Connection test failed', description: result.message, variant: result.success ? 'success' : 'error' });
    } finally {
      setTestingId(null);
    }
  };

  const openEdit = (connection: LeadSourceConnection) => {
    setEditTarget(connection);
    setEditValues(connectionToEditValues(connection));
  };

  const handleSaveEdit = async () => {
    if (!editTarget || !editValues) return;
    setSavingEdit(true);
    try {
      const fieldMapping = editValues.fieldMapping.filter((m) => m.key.trim() && m.value.trim());
      await updateConnection(editTarget.id, {
        name: editValues.name.trim(),
        active: editValues.active,
        credentials: editValues.credentials,
        fieldMapping: fieldMapping.length > 0 ? Object.fromEntries(fieldMapping.map((m) => [m.key.trim(), m.value.trim()])) : undefined,
      });
      toast({ title: 'Connection updated', variant: 'success' });
      setEditTarget(null);
      setReloadKey((k) => k + 1);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteConnection(deleteTarget.id);
    toast({ title: 'Connection deleted', variant: 'success' });
    setReloadKey((k) => k + 1);
  };

  const handleCopyWebhookUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'Webhook URL copied', variant: 'success' });
    } catch {
      toast({ title: 'Could not copy', description: 'Copy the URL manually.', variant: 'error' });
    }
  };

  const connectionName = (id: string) => connections?.find((c) => c.id === id)?.name;
  const activityColumns: DataTableColumn<IntegrationActivityEntry>[] = [
    {
      key: 'receivedAt',
      header: 'Received',
      render: (a) => <span className="whitespace-nowrap tabular-nums text-ink-muted" title={formatDateTime(a.receivedAt)}>{formatRelativeTime(a.receivedAt)}</span>,
    },
    {
      key: 'source',
      header: 'Connection',
      render: (a) => (
        <span className="flex items-center gap-2">
          <LeadSourceBadge source={a.source} />
          {connectionName(a.connectionId) && <span className="truncate text-xs text-ink-subtle">{connectionName(a.connectionId)}</span>}
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (a) => <StatusBadge kind="integrationActivity" status={a.status} /> },
    {
      key: 'leadsCreated',
      header: 'Leads',
      align: 'right',
      render: (a) =>
        a.leadId && a.leadsCreated > 0 ? (
          <Link to={`/crm/leads/${a.leadId}`} className="rounded font-medium tabular-nums text-brand-700 hover:underline focus-ring">
            {a.leadsCreated}
          </Link>
        ) : (
          <span className={a.leadsCreated ? 'font-medium tabular-nums' : 'tabular-nums text-ink-faint'}>{a.leadsCreated}</span>
        ),
    },
    {
      key: 'error',
      header: 'Error',
      render: (a) => (a.errorMessage ? <span className="text-xs text-danger-700">{a.errorMessage}</span> : <span className="text-ink-faint">—</span>),
    },
    {
      key: 'processedAt',
      header: 'Processed',
      render: (a) =>
        a.processedAt ? <span className="whitespace-nowrap tabular-nums text-ink-muted">{formatDateTime(a.processedAt)}</span> : <span className="text-ink-faint">—</span>,
    },
  ];

  const activeCount = (connections ?? []).filter((c) => c.active).length;
  const attentionCount = (connections ?? []).filter((c) => c.status === 'error' || !!c.lastError).length;

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Lead source connections that automatically bring leads into the CRM via webhook."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Integrations' }]}
        actions={
          <Button variant="primary" leftIcon={<Plus size={15} />} onClick={() => navigate('/crm/integrations/new')}>
            Add Connection
          </Button>
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-surface-subtle px-3 py-2 text-xs leading-5 text-ink-muted">
        <Info size={13} className="mt-[3px] shrink-0 text-info-600" aria-hidden="true" />
        <p>
          Credentials and tokens are stored encrypted and never shown here. Meta verifies against the Graph API and receives at{' '}
          <code className="text-ink">/api/webhook/meta</code>; every other source posts to its own webhook URL. Copy it from a card, paste it into
          the platform, then run <span className="font-medium text-ink">Test payload</span> to check the fields map correctly.
        </p>
      </div>

      <Tabs
        items={[
          { key: 'connections', label: 'Connections', badge: connections?.length },
          // Only worth a tab once there is a Meta connection whose forms can be mapped.
          ...(metaConnection ? [{ key: 'mapping', label: 'Field Mapping' }] : []),
          { key: 'activity', label: 'Activity Log', badge: activity?.total },
        ]}
      >
        {(activeKey) => (
          <>
            {activeKey === 'mapping' && metaConnection && <MetaFieldMapping connectionId={metaConnection.id} />}
            {activeKey === 'connections' &&
              (isLoading ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <CardSkeleton key={i} />
                  ))}
                </div>
              ) : !connections || connections.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={Link2}
                    title="No connections configured"
                    description="Add a lead source connection to start receiving leads automatically."
                    action={
                      <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => navigate('/crm/integrations/new')}>
                        Add Connection
                      </Button>
                    }
                  />
                </Card>
              ) : (
                <>
                <p className="mb-2.5 text-xs tabular-nums text-ink-subtle">
                  {activeCount} of {connections.length} active
                  {attentionCount > 0 && <span className="text-danger-700"> · {attentionCount} {attentionCount === 1 ? 'needs' : 'need'} attention</span>}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {connections.map((connection) => {
                    const oauthCapable = OAUTH_CAPABLE_SOURCES.includes(connection.source);
                    return (
                      <Card key={connection.id} className="flex h-full flex-col">
                        <div className="mb-3 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-semibold text-ink" title={connection.name}>{connection.name}</p>
                            <div className="mt-1">
                              <LeadSourceBadge source={connection.source} />
                            </div>
                          </div>
                          <StatusBadge kind="integrationStatus" status={connection.status} />
                        </div>

                        <dl className="space-y-1.5 text-[13px]">
                          {connection.connectedAccountLabel && (
                            <Fact label="Account" title={connection.connectedAccountLabel}>{connection.connectedAccountLabel}</Fact>
                          )}
                          {leads30.loaded && (
                            <Fact label="Leads, last 30 days">
                              <span className="font-medium tabular-nums">
                                {leads30.byConnection.get(connection.id) ?? 0}
                                {!leads30.complete && '+'}
                              </span>
                            </Fact>
                          )}
                          <Fact label="Last received" title={connection.lastReceivedAt ? formatDateTime(connection.lastReceivedAt) : undefined}>
                            {connection.lastReceivedAt ? formatRelativeTime(connection.lastReceivedAt) : <span className="text-ink-faint">Never</span>}
                          </Fact>
                          <div className="flex items-center justify-between gap-3">
                            <dt className="shrink-0 text-ink-subtle">Webhook</dt>
                            <dd className="flex min-w-0 items-center gap-0.5">
                              <span className="truncate font-mono text-xs text-ink-faint">{connection.webhookTokenMasked}</span>
                              <button
                                type="button"
                                onClick={() => handleCopyWebhookUrl(connection.webhookUrl)}
                                aria-label={`Copy the webhook URL for ${connection.name}`}
                                title="Copy webhook URL"
                                className="rounded p-1 text-ink-faint transition-colors duration-100 hover:bg-surface-muted hover:text-ink focus-ring"
                              >
                                <Copy size={12} />
                              </button>
                            </dd>
                          </div>
                        </dl>

                        {connection.lastError && (
                          <p className="mt-3 flex items-start gap-1.5 rounded-md bg-danger-50 px-2.5 py-1.5 text-xs text-danger-700">
                            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                            <span>{connection.lastError}</span>
                          </p>
                        )}

                        {/* Controls sit at the foot of every card, so a row of cards lines up. */}
                        <div className="mt-auto pt-4">
                        <div className="flex items-center gap-2 border-t border-line pt-3">
                          <Toggle
                            checked={connection.active}
                            onChange={() => handleToggleActive(connection.id)}
                            label={`${connection.name} active`}
                            showLabel={false}
                          />
                          <span className="text-xs text-ink-muted">{connection.active ? 'Active' : 'Inactive'}</span>
                          <Button variant="ghost" size="sm" leftIcon={<Edit2 size={12} />} className="ml-auto" onClick={() => openEdit(connection)}>
                            Edit
                          </Button>
                          <Button variant="ghost" size="sm" leftIcon={<Trash2 size={12} />} className="text-danger-600" onClick={() => setDeleteTarget(connection)}>
                            Delete
                          </Button>
                        </div>
                        <div className="mt-2.5 flex flex-wrap items-center gap-1">
                          <Button variant="outline" size="sm" leftIcon={<ShieldCheck size={12} />} onClick={() => handleTest(connection)} isLoading={testingId === connection.id}>
                            Test
                          </Button>
                          {connection.source !== 'meta' && connection.source !== 'manual' && (
                            <Button variant="ghost" size="sm" leftIcon={<Play size={12} />} onClick={() => setTestPayloadTarget(connection)}>
                              Test payload
                            </Button>
                          )}
                          {oauthCapable && (
                            <Button
                              variant="ghost"
                              size="sm"
                              leftIcon={<ExternalLink size={12} />}
                              title="Re-link the Facebook Page with a fresh token"
                              onClick={() => openEdit(connection)}
                            >
                              Reconnect
                            </Button>
                          )}
                          {connection.source === 'meta' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              leftIcon={<DownloadCloud size={12} />}
                              isLoading={backfillingId === connection.id}
                              title="Import the leads these forms already hold — the webhook only delivers new ones"
                              onClick={() => handleBackfill(connection)}
                            >
                              Import Past Leads
                            </Button>
                          )}
                        </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
                </>
              ))}

            {activeKey === 'activity' && (
              <Card padded={false}>
                <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-2.5">
                  <div className="min-w-0">
                    <h3 className="text-[13px] font-semibold text-ink">Webhook activity</h3>
                    <p className="mt-0.5 text-xs text-ink-subtle">Every inbound webhook receipt across all connections. Failed receipts are not retried.</p>
                  </div>
                  <Button variant="ghost" size="sm" leftIcon={<RefreshCw size={13} />} onClick={() => setReloadKey((k) => k + 1)}>
                    Refresh
                  </Button>
                </div>
                <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5 lg:flex-row lg:items-center">
                  <Select
                    aria-label="Connection"
                    value={connectionFilter}
                    onChange={(e) => setConnectionFilter(e.target.value)}
                    options={[{ value: 'all', label: 'All Connections' }, ...(connections ?? []).map((c) => ({ value: c.id, label: c.name }))]}
                    wrapperClassName="w-full sm:w-56"
                  />
                  <FilterChips
                    label="Receipt status"
                    items={STATUS_CHIPS}
                    value={statusFilter}
                    onChange={(k) => setStatusFilter(k as IntegrationActivityEntry['status'] | 'all')}
                  />
                  {activity && (
                    <span className="text-xs tabular-nums text-ink-faint lg:ml-auto">
                      {activity.total > activity.items.length ? `Latest ${activity.items.length} of ${activity.total}` : `${activity.total} ${activity.total === 1 ? 'receipt' : 'receipts'}`}
                    </span>
                  )}
                </div>
                <DataTable
                  columns={activityColumns}
                  rows={activity?.items ?? []}
                  rowKey={(a) => a.id}
                  isLoading={activityLoading}
                  emptyTitle="No activity found"
                  emptyDescription="No webhook receipts match these filters."
                />
              </Card>
            )}
          </>
        )}
      </Tabs>

      {editTarget && editValues && (
        <Modal
          isOpen={!!editTarget}
          onClose={() => setEditTarget(null)}
          title={`Edit ${editTarget.name}`}
          size="lg"
          footer={
            <>
              <Button variant="outline" onClick={() => setEditTarget(null)} disabled={savingEdit}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSaveEdit} isLoading={savingEdit}>
                Save Changes
              </Button>
            </>
          }
        >
          <div className="space-y-5">
            <ConnectionBasicFields values={editValues} errors={{}} onChange={(p) => setEditValues((v) => (v ? { ...v, ...p } : v))} isEditing />

            <div>
              <span className="mb-1.5 block text-sm font-medium text-ink">Webhook URL</span>
              <div className="flex items-center gap-2">
                <Input value={editTarget.webhookUrl} readOnly wrapperClassName="flex-1" className="font-mono text-xs" />
                <Button type="button" variant="outline" size="icon" aria-label="Copy webhook URL" onClick={() => handleCopyWebhookUrl(editTarget.webhookUrl)}>
                  <Copy size={14} />
                </Button>
              </div>
              <p className="mt-1 text-xs text-ink-faint">
                {editTarget.source === 'meta'
                  ? "Paste this as the Callback URL in your Meta app's Webhooks configuration."
                  : 'Paste this into the source platform. The token in the URL is what authenticates it, so treat it like a password.'}
              </p>
              {editTarget.source !== 'meta' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  leftIcon={<KeyRound size={12} />}
                  className="mt-1.5"
                  onClick={() => setRotateTarget(editTarget)}
                >
                  Rotate URL
                </Button>
              )}
            </div>

            {(editTarget.source === 'meta' || editTarget.source === 'instagram') && editTarget.connectedAccountLabel && (
              <div className="rounded-lg border border-line bg-surface-subtle px-3.5 py-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Connected Page</p>
                <p className="text-sm font-medium text-ink">{editTarget.connectedAccountLabel}</p>
                <p className="mt-0.5 text-xs text-ink-faint">Populated automatically once OAuth authorization completes.</p>
              </div>
            )}

            <div className="border-t border-line pt-4">
              <p className="mb-3 text-sm font-medium text-ink">API Credentials</p>
              <p className="mb-3 text-xs text-ink-faint">Leave blank to keep the currently stored credentials unchanged.</p>
              {editTarget?.source === 'meta' && (
              <MetaPageLinker
                connectionId={editTarget.id}
                onLinked={() => {
                  setEditTarget(null);
                  setReloadKey((k) => k + 1);
                }}
              />
            )}
            <ConnectionCredentialFields
                values={editValues}
                errors={{}}
                onChange={(p) => setEditValues((v) => (v ? { ...v, ...p } : v))}
                storedKeys={editTarget.credentialKeys ?? []}
              />
            </div>

            {supportsFieldMapping(editValues.source) && (
              <div className="border-t border-line pt-4">
                <ConnectionFieldMappingSection values={editValues} onChange={(p) => setEditValues((v) => (v ? { ...v, ...p } : v))} />
              </div>
            )}

            <label className="flex items-center gap-2 border-t border-line pt-4 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={editValues.active}
                onChange={(e) => setEditValues((v) => (v ? { ...v, active: e.target.checked } : v))}
                className="h-4 w-4 rounded border-line-strong text-brand-600 focus-ring"
              />
              Active
            </label>
          </div>
        </Modal>
      )}

      {testPayloadTarget && (
        <WebhookTestModal connection={testPayloadTarget} onClose={() => setTestPayloadTarget(null)} />
      )}

      <ConfirmationDialog
        isOpen={!!rotateTarget}
        onClose={() => setRotateTarget(null)}
        onConfirm={handleRotateToken}
        title="Rotate this webhook URL?"
        description={`The current URL for "${rotateTarget?.name}" stops working immediately. Any platform still posting to it will start failing until you paste in the new URL.`}
        confirmLabel="Rotate URL"
        variant="danger"
      />

      <ConfirmationDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete connection"
        description={`This will permanently delete "${deleteTarget?.name}". Leads already ingested through it are not affected.`}
        confirmLabel="Delete"
        variant="danger"
        audited
      />
    </div>
  );
}
