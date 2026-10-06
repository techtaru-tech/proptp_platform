import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { listSmsTemplates, previewSms, sendSms } from '../../services/smsService';

/** Sends one approved (DLT) message, to a lead or to a number typed in as a test. */
export function SendSmsModal({ leadId, onClose, onSent }: { leadId?: string; onClose: () => void; onSent?: () => void }) {
  const { toast } = useToast();
  const { data: templates } = useAsync(() => listSmsTemplates(), []);
  const active = (templates ?? []).filter((t) => t.active);
  const [name, setName] = useState('');
  const [to, setTo] = useState('');
  const [values, setValues] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const t = active.find((x) => x.name === name);

  useEffect(() => { if (!name && active[0]) setName(active[0].name); }, [active, name]);
  useEffect(() => { setValues(Array.from({ length: t?.slots ?? 0 }, () => '')); }, [name, t?.slots]);
  useEffect(() => { if (name) previewSms(name, values).then((r) => setText(r.text)).catch(() => setText('')); }, [name, values]);

  const go = async () => {
    setSaving(true);
    try { await sendSms({ templateName: name, params: values, ...(leadId ? { leadId } : { to }) }); toast({ title: 'SMS sent', variant: 'success' }); onSent?.(); onClose(); }
    catch (e) { toast({ title: 'Could not send it', description: (e as Error).message, variant: 'error' }); }
    finally { setSaving(false); }
  };
  const ready = !!t && (leadId || to.replace(/\D/g, '').length >= 10) && values.every((v) => v.trim());

  return (
    <Modal isOpen onClose={onClose} title="Send an SMS" footer={<><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={go} isLoading={saving} disabled={!ready}>Send</Button></>}>
      {active.length === 0 ? <p className="text-sm text-ink-muted">No approved template yet. Add one under Settings → SMS (DLT).</p> : (
        <div className="flex flex-col gap-4">
          <Select label="Template" name="smsTemplate" value={name} onChange={(e) => setName(e.target.value)} options={active.map((x) => ({ value: x.name, label: x.name }))} />
          {!leadId && <Input label="Mobile number" name="smsTo" inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} />}
          {values.map((v, i) => <Input key={i} label={`Value ${i + 1}`} name={`smsVar${i}`} value={v} onChange={(e) => setValues((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} />)}
          <p className="rounded-lg bg-surface-subtle px-3 py-2.5 text-sm text-ink-muted">{text}</p>
        </div>
      )}
    </Modal>
  );
}
