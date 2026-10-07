import { useState, type FormEvent } from 'react';
import { CalendarDays, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Toggle } from '../../components/ui/Toggle';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { createHoliday, deleteHoliday, listHolidays, updateHoliday, type HolidayInput } from '../../services/hrService';
import type { Holiday } from '../../types';

const THIS_YEAR = new Date().getFullYear();
const YEARS = [THIS_YEAR - 1, THIS_YEAR, THIS_YEAR + 1];

/** The occasions an Indian office actually closes for. Free text underneath, so this is a
 *  starting point rather than a fence. */
const KINDS = [
  { value: 'national', label: 'National' },
  { value: 'festival', label: 'Festival' },
  { value: 'religious', label: 'Religious' },
  { value: 'company', label: 'Company' },
  { value: 'optional', label: 'Optional' },
];

const KIND_TONE: Record<string, 'success' | 'warning' | 'info' | 'neutral'> = {
  national: 'info',
  festival: 'success',
  religious: 'success',
  company: 'neutral',
  optional: 'warning',
};

function emptyForm(): HolidayInput & { multiDay: boolean } {
  return { name: '', kind: 'festival', startDate: '', endDate: '', description: '', multiDay: false };
}

/** "5 Oct 2026", or "5 – 7 Oct 2026" when a holiday runs more than a day. */
function dateRangeLabel(holiday: Holiday): string {
  const fmt = (iso: string, withMonth = true) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
      day: 'numeric',
      ...(withMonth ? { month: 'short', year: 'numeric' } : {}),
    });
  if (holiday.startDate === holiday.endDate) return fmt(holiday.startDate);
  const sameMonth = holiday.startDate.slice(0, 7) === holiday.endDate.slice(0, 7);
  return `${fmt(holiday.startDate, !sameMonth)} – ${fmt(holiday.endDate)}`;
}

export function Holidays() {
  const { toast } = useToast();
  const [year, setYear] = useState(THIS_YEAR);
  const [reloadKey, setReloadKey] = useState(0);
  const { data, isLoading } = useAsync(() => listHolidays(year), [year, reloadKey]);

  const [editing, setEditing] = useState<Holiday | 'new' | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Holiday | null>(null);

  const openCreate = () => {
    setForm(emptyForm());
    setEditing('new');
  };

  const openEdit = (holiday: Holiday) => {
    setForm({
      name: holiday.name,
      kind: holiday.kind,
      startDate: holiday.startDate,
      endDate: holiday.endDate,
      description: holiday.description ?? '',
      multiDay: holiday.startDate !== holiday.endDate,
    });
    setEditing(holiday);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.startDate) return;
    // With the toggle off, the end date IS the start date — a one-day holiday is still a range
    // to everything downstream, which keeps every query one shape.
    const payload: HolidayInput = {
      name: form.name.trim(),
      kind: form.kind,
      startDate: form.startDate,
      endDate: form.multiDay && form.endDate ? form.endDate : form.startDate,
      description: form.description?.trim() || undefined,
    };
    setSaving(true);
    try {
      if (editing === 'new') {
        await createHoliday(payload);
        toast({ title: 'Holiday added', variant: 'success' });
      } else if (editing) {
        await updateHoliday(editing.id, payload);
        toast({ title: 'Holiday updated', variant: 'success' });
      }
      setEditing(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast({
        title: 'Could not save',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setSaving(true);
    try {
      await deleteHoliday(confirmDelete.id);
      toast({ title: 'Holiday deleted', variant: 'success' });
      setConfirmDelete(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast({
        title: 'Could not delete',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const holidays = data?.holidays ?? [];
  const upcoming = holidays.filter((h) => h.upcoming);

  return (
    <div>
      <PageHeader
        title="Holidays"
        description="The days the office is closed. One entry per occasion — Diwali is one holiday that runs three days, not three holidays."
        breadcrumb={[{ label: 'Attendance', to: '/attendance/today' }, { label: 'Holidays' }]}
        actions={
          <Button variant="primary" leftIcon={<Plus size={15} />} onClick={openCreate}>
            Add Holiday
          </Button>
        }
      />

      <Card className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Select
              aria-label="Year"
              value={String(year)}
              onChange={(e) => setYear(Number(e.target.value))}
              options={YEARS.map((y) => ({ value: String(y), label: String(y) }))}
              wrapperClassName="w-32"
            />
            <p className="text-sm text-ink-muted">
              <span className="font-medium text-ink">{holidays.length}</span> holiday(s) ·{' '}
              <span className="font-medium text-ink">{data?.totalDays ?? 0}</span> day(s) off ·{' '}
              <span className="font-medium text-ink">{upcoming.length}</span> still to come
            </p>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <CardSkeleton />
      ) : (
        <Card padded={false}>
          <CardHeader title={`${year} calendar`} subtitle="Oldest first. Everyone in the company sees the same list." />
          {holidays.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-ink-faint">
              Nothing set up for {year}. Add the national holidays first, then the festivals your offices close for.
            </p>
          ) : (
            <div className="divide-y divide-line">
              {holidays.map((holiday) => (
                <div key={holiday.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <CalendarDays size={16} className={holiday.upcoming ? 'text-brand-600' : 'text-ink-faint'} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                      {holiday.name}
                      <Badge tone={KIND_TONE[holiday.kind] ?? 'neutral'}>{holiday.kind}</Badge>
                      {holiday.days > 1 && <Badge tone="info">{holiday.days} days</Badge>}
                      {!holiday.upcoming && <Badge tone="neutral">past</Badge>}
                    </p>
                    <p className="text-xs text-ink-muted">{dateRangeLabel(holiday)}</p>
                    {holiday.description && <p className="mt-0.5 text-xs text-ink-faint">{holiday.description}</p>}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(holiday)}>
                    <Pencil size={14} />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(holiday)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Modal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add Holiday' : 'Edit Holiday'}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} isLoading={saving}>
              Save
            </Button>
          </>
        }
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="Occasion"
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Diwali"
          />
          <Select
            label="Kind"
            value={form.kind}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
            options={KINDS}
          />
          <Toggle
            label="Runs more than one day"
            checked={form.multiDay}
            onChange={(checked) =>
              setForm((f) => ({ ...f, multiDay: checked, endDate: checked ? f.endDate || f.startDate : '' }))
            }
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={form.multiDay ? 'First day' : 'Date'}
              type="date"
              required
              value={form.startDate}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  startDate: e.target.value,
                  // Keep the end date behind the start date from ever being possible to type.
                  endDate: f.multiDay && f.endDate && f.endDate < e.target.value ? e.target.value : f.endDate,
                }))
              }
            />
            {form.multiDay && (
              <Input
                label="Last day"
                type="date"
                required
                min={form.startDate || undefined}
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              />
            )}
          </div>
          <Input
            label="Note"
            value={form.description ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Optional — why the office is shut, if the name does not say it"
          />
        </form>
      </Modal>

      <Modal
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete holiday"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} isLoading={saving}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          Delete <span className="font-medium text-ink">{confirmDelete?.name}</span>? It will disappear from the app's
          holiday list too.
        </p>
      </Modal>
    </div>
  );
}
