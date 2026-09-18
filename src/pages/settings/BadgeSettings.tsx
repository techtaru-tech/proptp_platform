import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Badge as BadgeChip } from '../../components/ui/Badge';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { listBadges, createBadge, updateBadge, reorderBadges } from '../../services/referralConfigService';
import { formatCurrency } from '../../utils/format';
import type { Badge } from '../../types';

function defaultForm() {
  return { rankName: '', rankLevel: 1, description: '', minInvest: 0, minDeposit: 0, minEarning: 0, bonus: 0, status: 1 as 1 | 0 };
}

export function BadgeSettings() {
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const { data: badges, isLoading } = useAsync(() => listBadges(), [reloadKey]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm());
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditingId(null);
    setForm(defaultForm());
    setModalOpen(true);
  };

  const openEdit = (badge: Badge) => {
    setEditingId(badge.id);
    setForm({
      rankName: badge.rankName,
      rankLevel: badge.rankLevel,
      description: badge.description ?? '',
      minInvest: badge.minInvest,
      minDeposit: badge.minDeposit,
      minEarning: badge.minEarning,
      bonus: badge.bonus,
      status: badge.status,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.rankName.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await updateBadge(editingId, form);
        toast({ title: 'Badge updated', variant: 'success' });
      } else {
        await createBadge(form);
        toast({ title: 'Badge created', variant: 'success' });
      }
      setModalOpen(false);
      setReloadKey((k) => k + 1);
    } finally {
      setSaving(false);
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    if (!badges) return;
    const next = [...badges];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await reorderBadges(next.map((b) => b.id));
    setReloadKey((k) => k + 1);
  };

  const toggleStatus = async (badge: Badge) => {
    await updateBadge(badge.id, { status: badge.status === 1 ? 0 : 1 });
    setReloadKey((k) => k + 1);
  };

  return (
    <div>
      <PageHeader
        title="Badges / Ranks"
        description="Configure agent rank thresholds and bonus. Real-world promotion is cron-driven based on these thresholds, not a manual admin action."
        breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'Badges' }]}
        actions={
          <Button variant="primary" leftIcon={<Plus size={14} />} onClick={openCreate}>
            Add Badge
          </Button>
        }
      />

      <Card padded={false}>
        {isLoading ? (
          <p className="p-5 text-sm text-ink-muted">Loading…</p>
        ) : (
          <div className="divide-y divide-line">
            {(badges ?? []).map((badge, i) => (
              <div key={badge.id} className="flex items-center gap-4 px-5 py-4">
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => move(i, -1)} disabled={i === 0} className="text-ink-faint hover:text-ink disabled:opacity-30">
                    <ArrowUp size={14} />
                  </button>
                  <button onClick={() => move(i, 1)} disabled={i === (badges?.length ?? 0) - 1} className="text-ink-faint hover:text-ink disabled:opacity-30">
                    <ArrowDown size={14} />
                  </button>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-ink">{badge.rankName}</p>
                    <BadgeChip tone={badge.status === 1 ? 'success' : 'neutral'}>{badge.status === 1 ? 'Active' : 'Inactive'}</BadgeChip>
                  </div>
                  <p className="text-xs text-ink-faint">{badge.description}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    Min invest {formatCurrency(badge.minInvest)} · Min deposit {formatCurrency(badge.minDeposit)} · Min earning {formatCurrency(badge.minEarning)} · Bonus {formatCurrency(badge.bonus)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(badge)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => toggleStatus(badge)}>
                    {badge.status === 1 ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Edit Badge' : 'Add Badge'}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} isLoading={saving}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Rank name" required value={form.rankName} onChange={(e) => setForm((f) => ({ ...f, rankName: e.target.value }))} />
          <Input label="Rank level" type="number" min={1} value={form.rankLevel} onChange={(e) => setForm((f) => ({ ...f, rankLevel: Number(e.target.value) }))} />
          <Input label="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Min invest (₹)" type="number" min={0} value={form.minInvest} onChange={(e) => setForm((f) => ({ ...f, minInvest: Number(e.target.value) }))} />
            <Input label="Min deposit (₹)" type="number" min={0} value={form.minDeposit} onChange={(e) => setForm((f) => ({ ...f, minDeposit: Number(e.target.value) }))} />
            <Input label="Min earning (₹)" type="number" min={0} value={form.minEarning} onChange={(e) => setForm((f) => ({ ...f, minEarning: Number(e.target.value) }))} />
            <Input label="Bonus (₹)" type="number" min={0} value={form.bonus} onChange={(e) => setForm((f) => ({ ...f, bonus: Number(e.target.value) }))} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
