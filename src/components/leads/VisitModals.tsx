import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { listAssignableUsers, listProjectOptions } from '../../services/leadService';
import { OUTCOME_LABEL, cancelVisit, completeVisit, rescheduleVisit, scheduleVisit, type SiteVisit, type VisitOutcome } from '../../services/siteVisitService';
import type { LeadTemperature } from '../../types';

/** `datetime-local` wants "YYYY-MM-DDTHH:mm" in local time. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const tomorrow11 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(11, 0, 0, 0); return localInput(d); };

function useSaver(onDone: () => void, ok: string) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  return { saving, go: async (fn: () => Promise<unknown>) => {
    setSaving(true);
    try { await fn(); toast({ title: ok, variant: 'success' }); onDone(); }
    catch (e) { toast({ title: 'That did not work', description: (e as Error).message, variant: 'error' }); }
    finally { setSaving(false); } } };
}

const Footer = ({ onClose, onSave, saving, disabled, label }: { onClose: () => void; onSave: () => void; saving: boolean; disabled?: boolean; label: string }) =>
  <><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={onSave} isLoading={saving} disabled={disabled}>{label}</Button></>;

/** Schedule a visit for a lead. Used from the lead page and from the visits screen. */
export function ScheduleVisitModal({ leadId, leadName, defaultProjectId, defaultHostId, onClose, onSaved }: { leadId: string; leadName: string; defaultProjectId?: string; defaultHostId?: string; onClose: () => void; onSaved: () => void }) {
  const { data: projects } = useAsync(() => listProjectOptions(), []);
  const hosts = listAssignableUsers();
  const [f, setF] = useState({ projectId: defaultProjectId ?? '', at: tomorrow11(), visitors: '2', hostId: defaultHostId ?? '' });
  const { saving, go } = useSaver(onSaved, 'Site visit scheduled');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal isOpen onClose={onClose} title={`Schedule a site visit — ${leadName}`} footer={<Footer onClose={onClose} saving={saving} label="Schedule" disabled={!f.projectId || !f.at}
      onSave={() => go(() => scheduleVisit({ leadId, projectId: f.projectId, scheduledAt: new Date(f.at).toISOString(), visitorCount: Number(f.visitors) || 1, hostId: f.hostId || undefined }))} />}>
      <div className="flex flex-col gap-4">
        <Select label="Project to visit" name="visitProject" required value={f.projectId} onChange={set('projectId')} options={[{ value: '', label: 'Choose a project' }, ...(projects ?? []).map((p) => ({ value: p.id, label: p.projectName }))]} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Date and time" name="visitAt" type="datetime-local" required value={f.at} onChange={set('at')} />
          <Input label="Number of visitors" name="visitVisitors" type="number" min={1} max={50} value={f.visitors} onChange={set('visitors')} />
        </div>
        <Select label="Sales executive hosting" name="visitHost" value={f.hostId} onChange={set('hostId')} options={[{ value: '', label: 'Lead owner' }, ...hosts.map((u) => ({ value: u.id, label: u.name }))]} />
        <p className="text-xs text-ink-muted">The lead moves to “Site Visit Planned” and the host gets a reminder two hours before.</p>
      </div>
    </Modal>
  );
}

export function RescheduleModal({ visit, onClose, onSaved }: { visit: SiteVisit; onClose: () => void; onSaved: () => void }) {
  const [at, setAt] = useState(localInput(new Date(visit.scheduledAt)));
  const { saving, go } = useSaver(onSaved, 'Visit rescheduled');
  return (
    <Modal isOpen onClose={onClose} title="Reschedule the visit" footer={<Footer onClose={onClose} saving={saving} label="Reschedule" onSave={() => go(() => rescheduleVisit(visit.id, new Date(at).toISOString()))} />}>
      <Input label="New date and time" name="rescheduleAt" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
    </Modal>
  );
}

export function CancelModal({ visit, onClose, onSaved }: { visit: SiteVisit; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState('');
  const { saving, go } = useSaver(onSaved, 'Visit cancelled');
  return (
    <Modal isOpen onClose={onClose} title="Cancel the visit" footer={<Footer onClose={onClose} saving={saving} label="Cancel visit" disabled={!reason.trim()} onSave={() => go(() => cancelVisit(visit.id, reason))} />}>
      <Textarea label="Why is it cancelled" id="cancelVisitReason" value={reason} onChange={setReason} />
    </Modal>
  );
}

/** How the visit went: what they said, how warm they are, what happens next. Completing it schedules the follow-up. */
export function CompleteModal({ visit, onClose, onSaved }: { visit: SiteVisit; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ outcome: '' as VisitOutcome | '', interest: '' as LeadTemperature | '', visitors: String(visit.visitorCount), feedback: '', nextAction: '' });
  const { saving, go } = useSaver(onSaved, 'Visit recorded — follow-up scheduled');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal isOpen onClose={onClose} title={`How did the visit go? — ${visit.leadName}`} footer={<Footer onClose={onClose} saving={saving} label="Save outcome" disabled={!f.outcome}
      onSave={() => go(() => completeVisit(visit.id, { outcome: f.outcome as VisitOutcome, interest: (f.interest || undefined) as LeadTemperature | undefined, feedback: f.feedback || undefined, nextAction: f.nextAction || undefined, visitorCount: Number(f.visitors) || undefined }))} />}>
      <div className="flex flex-col gap-4">
        <Select label="Outcome" name="visitOutcome" required value={f.outcome} onChange={set('outcome')} options={[{ value: '', label: 'Choose…' }, ...Object.entries(OUTCOME_LABEL).map(([value, label]) => ({ value, label }))]} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Interest level" name="visitInterest" value={f.interest} onChange={set('interest')} options={[{ value: '', label: 'Leave as it is' }, { value: 'hot', label: 'Hot' }, { value: 'warm', label: 'Warm' }, { value: 'cold', label: 'Cold' }]} hint="Becomes the lead’s temperature." />
          <Input label="Visitors who came" name="visitCame" type="number" min={1} max={50} value={f.visitors} onChange={set('visitors')} />
        </div>
        <Textarea label="Customer feedback" id="visitFeedback" value={f.feedback} onChange={(v) => setF((x) => ({ ...x, feedback: v }))} />
        <Input label="Next action" name="visitNext" value={f.nextAction} onChange={set('nextAction')} placeholder="e.g. Send the cost sheet" />
        <p className="text-xs text-ink-muted">{f.outcome === 'not_interested' ? 'No follow-up is created when they are not interested.' : 'A follow-up is set for tomorrow morning, and the lead moves to “Site Visit Done”.'}</p>
      </div>
    </Modal>
  );
}
