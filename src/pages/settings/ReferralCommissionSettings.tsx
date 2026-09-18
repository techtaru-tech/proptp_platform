import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  getReferralToggles,
  updateReferralToggles,
  getReferralLevelRules,
  saveReferralLevelRules,
  listPlanLevels,
  savePlanLevels,
} from '../../services/referralConfigService';
import type { CommissionType, PlanLevel } from '../../types';

const COMMISSION_TYPE_OPTIONS: { value: CommissionType; label: string }[] = [
  { value: 'deposit', label: 'Deposit Commission' },
  { value: 'investment', label: 'Investment Commission' },
  { value: 'profit', label: 'Profit Commission' },
];

export function ReferralCommissionSettings() {
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const { data: toggles } = useAsync(() => getReferralToggles(), [reloadKey]);
  const [commissionType, setCommissionType] = useState<CommissionType>('deposit');
  const { data: levelRules } = useAsync(() => getReferralLevelRules(commissionType), [commissionType, reloadKey]);
  const { data: planLevels } = useAsync(() => listPlanLevels(), [reloadKey]);

  const [percents, setPercents] = useState<number[]>([]);
  const [savingLevels, setSavingLevels] = useState(false);

  const [levels, setLevels] = useState<Omit<PlanLevel, 'id'>[]>([]);
  const [planError, setPlanError] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);

  useEffect(() => {
    if (levelRules) setPercents(levelRules.map((r) => r.percent));
  }, [levelRules]);

  useEffect(() => {
    if (planLevels) setLevels(planLevels.map(({ id: _id, ...rest }) => rest));
  }, [planLevels]);

  const toggleGlobal = async (key: 'depositCommission' | 'investmentCommission' | 'profitCommission') => {
    if (!toggles) return;
    await updateReferralToggles({ [key]: !toggles[key] });
    setReloadKey((k) => k + 1);
  };

  const handleSaveLevels = async () => {
    setSavingLevels(true);
    try {
      await saveReferralLevelRules(commissionType, percents);
      toast({ title: 'Commission levels saved', variant: 'success' });
      setReloadKey((k) => k + 1);
    } finally {
      setSavingLevels(false);
    }
  };

  const handleSavePlanLevels = async () => {
    setSavingPlan(true);
    setPlanError('');
    try {
      const result = await savePlanLevels(levels);
      if (result.error) {
        setPlanError(result.error);
        return;
      }
      toast({ title: 'Team incentive ladder saved', variant: 'success' });
      setReloadKey((k) => k + 1);
    } finally {
      setSavingPlan(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Referral Commission"
        description="Configure the referral level tables, team-volume incentive ladder, and global commission toggles."
        breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'Referral Commission' }]}
      />

      <Card>
        <CardHeader title="Global Toggles" subtitle="Enable or disable each commission type platform-wide." />
        {toggles && (
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {(['depositCommission', 'investmentCommission', 'profitCommission'] as const).map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm text-ink-muted">
                <input type="checkbox" checked={toggles[key]} onChange={() => toggleGlobal(key)} className="h-4 w-4 rounded border-line-strong text-brand-600 focus-ring" />
                {key === 'depositCommission' ? 'Deposit Commission' : key === 'investmentCommission' ? 'Investment Commission' : 'Profit Commission'}
              </label>
            ))}
          </div>
        )}
      </Card>

      <Card className="mt-5">
        <CardHeader title="Referral Level Percentages" subtitle="Percent paid at each referral level, per commission type." />
        <Select label="Commission type" value={commissionType} onChange={(e) => setCommissionType(e.target.value as CommissionType)} options={COMMISSION_TYPE_OPTIONS} wrapperClassName="mb-4 max-w-xs" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {percents.map((pct, i) => (
            <Input
              key={i}
              label={`Level ${i + 1} (%)`}
              type="number"
              min={0}
              step="0.1"
              value={pct}
              onChange={(e) => setPercents((prev) => prev.map((p, idx) => (idx === i ? Number(e.target.value) : p)))}
            />
          ))}
        </div>
        <div className="mt-4 flex gap-2.5">
          <Button variant="outline" size="sm" leftIcon={<Plus size={13} />} onClick={() => setPercents((prev) => [...prev, 0])}>
            Add Level
          </Button>
          {percents.length > 1 && (
            <Button variant="outline" size="sm" leftIcon={<Trash2 size={13} />} onClick={() => setPercents((prev) => prev.slice(0, -1))}>
              Remove Last Level
            </Button>
          )}
        </div>
        <div className="mt-4">
          <Button variant="primary" onClick={handleSaveLevels} isLoading={savingLevels}>
            Save Levels
          </Button>
        </div>
      </Card>

      <Card className="mt-5">
        <CardHeader title="Team Incentive Ladder" subtitle="Team-volume range → incentive % (ranges must not overlap)." />
        <div className="space-y-3">
          {levels.map((level, i) => (
            <div key={i} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end">
              <Input label="Level title" value={level.levelTitle} onChange={(e) => setLevels((prev) => prev.map((l, idx) => (idx === i ? { ...l, levelTitle: e.target.value } : l)))} />
              <Input label="Range from" type="number" min={0} value={level.rangeFrom} onChange={(e) => setLevels((prev) => prev.map((l, idx) => (idx === i ? { ...l, rangeFrom: Number(e.target.value) } : l)))} />
              <Input label="Range to" type="number" min={0} value={level.rangeTo} onChange={(e) => setLevels((prev) => prev.map((l, idx) => (idx === i ? { ...l, rangeTo: Number(e.target.value) } : l)))} />
              <Input label="Incentive (%)" type="number" min={0} step="0.1" value={level.incentive} onChange={(e) => setLevels((prev) => prev.map((l, idx) => (idx === i ? { ...l, incentive: Number(e.target.value) } : l)))} />
              <Button variant="ghost" size="icon" aria-label="Remove level" onClick={() => setLevels((prev) => prev.filter((_, idx) => idx !== i))} className="text-danger-600 hover:bg-danger-50">
                <Trash2 size={15} />
              </Button>
            </div>
          ))}
        </div>
        {planError && <p className="mt-3 text-xs text-danger-600">{planError}</p>}
        <div className="mt-4 flex gap-2.5">
          <Button variant="outline" size="sm" leftIcon={<Plus size={13} />} onClick={() => setLevels((prev) => [...prev, { levelTitle: '', rangeFrom: 0, rangeTo: 0, incentive: 0 }])}>
            Add Level
          </Button>
          <Button variant="primary" onClick={handleSavePlanLevels} isLoading={savingPlan}>
            Save Ladder
          </Button>
        </div>
      </Card>
    </div>
  );
}
