import { useState } from 'react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { getBulkPriceableUnits, bulkUpdateUnitPricing } from '../../services/projectService';
import { refProjects } from '../../data/referenceData';
import { formatCurrency } from '../../utils/format';

const PROJECT_OPTIONS = [{ value: '', label: 'Select a project' }, ...refProjects.map((p) => ({ value: p.id, label: p.projectName }))];

export function BulkPriceUpdate() {
  const { toast } = useToast();
  const [projectId, setProjectId] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [edits, setEdits] = useState<Record<string, { totalInvestmentAmount: number; perAreaAmount: number }>>({});
  const [saving, setSaving] = useState(false);

  const { data: units, isLoading } = useAsync(
    () => (projectId ? getBulkPriceableUnits(projectId) : Promise.resolve([])),
    [projectId, reloadKey]
  );

  const updateEdit = (unitId: string, patch: Partial<{ totalInvestmentAmount: number; perAreaAmount: number }>) => {
    setEdits((prev) => ({ ...prev, [unitId]: { ...prev[unitId], ...patch } }));
  };

  const handleSave = async () => {
    const rows = Object.entries(edits).map(([unitId, values]) => ({ unitId, ...values }));
    if (rows.length === 0) return;
    setSaving(true);
    try {
      const count = await bulkUpdateUnitPricing(rows);
      toast({ title: 'Prices updated', description: `${count} propert${count === 1 ? 'y' : 'ies'} repriced.`, variant: 'success' });
      setEdits({});
      setReloadKey((k) => k + 1);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Bulk Price Update"
        description="Reprice several properties in a project at once. Only active, unbooked properties can be changed."
        actions={
          <Button variant="primary" onClick={handleSave} isLoading={saving} disabled={Object.keys(edits).length === 0}>
            Save Changes
          </Button>
        }
      />

      <Card>
        <Select label="Project" value={projectId} onChange={(e) => { setProjectId(e.target.value); setEdits({}); }} options={PROJECT_OPTIONS} wrapperClassName="max-w-sm" />
      </Card>

      {projectId && (
        <Card className="mt-5" padded={false}>
          {isLoading ? (
            <p className="p-5 text-sm text-ink-muted">Loading properties…</p>
          ) : !units || units.length === 0 ? (
            <EmptyState title="No eligible properties" description="This project has no unbooked, active properties to reprice." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-ink-faint">
                    <th className="px-4 py-3">Property</th>
                    <th className="px-4 py-3">Current Total</th>
                    <th className="px-4 py-3">New Total Deposit Amount (₹)</th>
                    <th className="px-4 py-3">New Per-area Amount (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((u) => {
                    const edit = edits[u.id];
                    return (
                      <tr key={u.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-ink">{u.propertyNumber}</p>
                          <p className="text-xs text-ink-faint">{u.propertyTitle}</p>
                        </td>
                        <td className="px-4 py-2.5 text-ink-muted">{formatCurrency(u.totalInvestmentAmount)}</td>
                        <td className="px-4 py-2.5">
                          <input
                            type="number"
                            min={0}
                            defaultValue={u.totalInvestmentAmount}
                            onChange={(e) => updateEdit(u.id, { totalInvestmentAmount: Number(e.target.value), perAreaAmount: edit?.perAreaAmount ?? u.perAreaAmount })}
                            className="w-36 rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-sm focus-ring"
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <input
                            type="number"
                            min={0}
                            defaultValue={u.perAreaAmount}
                            onChange={(e) => updateEdit(u.id, { perAreaAmount: Number(e.target.value), totalInvestmentAmount: edit?.totalInvestmentAmount ?? u.totalInvestmentAmount })}
                            className="w-32 rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-sm focus-ring"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
