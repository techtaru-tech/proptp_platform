import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Info } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { Select } from '../../components/ui/Select';
import { Toggle } from '../../components/ui/Toggle';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  createSdrAgent, getSdrAgent, getSdrCapabilities, updateSdrAgent,
  SDR_CHANNEL_OPTIONS, SDR_GOAL_OPTIONS,
} from '../../services/aiSdrService';
import { listAssignableUsers } from '../../services/leadService';
import type { AiSdrAgent, AiSdrAgentInput, SdrChannel, SdrGoal } from '../../types';

function initialValues(existing?: AiSdrAgent): AiSdrAgentInput {
  return {
    name: existing?.name ?? '',
    active: existing?.active ?? true,
    goal: existing?.goal ?? 'qualify_lead',
    channel: existing?.channel ?? 'email',
    persona: existing?.persona ?? '',
    offerContext: existing?.offerContext ?? '',
    maxFollowUps: existing?.maxFollowUps ?? 4,
    minHoursBetweenFollowUps: existing?.minHoursBetweenFollowUps ?? 24,
    respectBusinessHours: existing?.respectBusinessHours ?? true,
    handoffUserId: existing?.handoffUserId ?? '',
    meetingType: existing?.meetingType ?? '',
  };
}

export function AiSdrAgentBuilder() {
  const { id } = useParams<{ id: string }>();
  const [resetKey, setResetKey] = useState(0);
  const { data, isLoading, error } = useAsync(() => (id ? getSdrAgent(id) : Promise.resolve(undefined)), [id]);

  if (id && isLoading) return <CardSkeleton />;
  if (id && (error || !data)) {
    return <ErrorState title="Agent not found" description={error?.message ?? 'This agent may have been deleted.'} />;
  }

  return <AgentEditor key={`${id ?? 'new'}-${resetKey}`} existing={data} onCreatedAnother={() => setResetKey((k) => k + 1)} />;
}

function AgentEditor({ existing, onCreatedAnother }: { existing?: AiSdrAgent; onCreatedAnother: () => void }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const assignableUsers = listAssignableUsers();
  const { data: capabilities } = useAsync(() => getSdrCapabilities(), []);

  const [values, setValues] = useState<AiSdrAgentInput>(() => initialValues(existing));
  const [isSaving, setIsSaving] = useState(false);

  const patch = (next: Partial<AiSdrAgentInput>) => setValues((prev) => ({ ...prev, ...next }));

  const validate = (): string | null => {
    if (!values.name.trim()) return 'Name is required.';
    if (values.maxFollowUps < 1 || values.maxFollowUps > 20) return 'Max follow-ups must be between 1 and 20.';
    if (values.minHoursBetweenFollowUps < 1 || values.minHoursBetweenFollowUps > 720) {
      return 'Min hours between follow-ups must be between 1 and 720.';
    }
    return null;
  };

  const handleSave = async (createAnother = false) => {
    const problem = validate();
    if (problem) {
      toast({ title: 'Check the agent', description: problem, variant: 'error' });
      return;
    }
    setIsSaving(true);
    try {
      const payload: AiSdrAgentInput = {
        ...values,
        persona: values.persona || undefined,
        offerContext: values.offerContext || undefined,
        handoffUserId: values.handoffUserId || undefined,
        meetingType: values.meetingType || undefined,
      };
      if (existing) {
        await updateSdrAgent(existing.id, payload);
        toast({ title: 'Agent saved', variant: 'success' });
        navigate(`/crm/sdr-agents/${existing.id}`);
      } else {
        const created = await createSdrAgent(payload);
        toast({ title: 'Agent created', variant: 'success' });
        if (createAnother) onCreatedAnother();
        else navigate(`/crm/sdr-agents/${created.id}`);
      }
    } catch (err) {
      toast({ title: 'Could not save the agent', description: (err as Error).message, variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const channelNeedsProvider = values.channel === 'sms' || values.channel === 'whatsapp';

  return (
    <div>
      <PageHeader
        title={existing ? 'Edit AI SDR Agent' : 'Create AI SDR Agent'}
        breadcrumb={[
          { label: 'CRM', to: '/crm' },
          { label: 'AI SDR Agents', to: '/crm/sdr-agents' },
          { label: existing ? 'Edit' : 'Create' },
        ]}
      />

      {capabilities && !capabilities.aiProviderConfigured && (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          <Info size={16} className="mt-0.5 shrink-0" />
          <p>
            <strong>No AI provider is configured yet.</strong> Enrollment, the follow-up cadence, business-hours gating and
            handoff all work — but nothing is written or sent automatically. A due follow-up is surfaced on the agent's
            Enrollments tab for a human to send, and you log what you actually sent to keep the thread accurate.
          </p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Agent" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Name" name="name" required value={values.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Asha — inbound qualifier" />
            <div>
              <Select
                label="Goal"
                name="goal"
                required
                value={values.goal}
                onChange={(e) => patch({ goal: e.target.value as SdrGoal })}
                options={SDR_GOAL_OPTIONS}
              />
              <p className="mt-1.5 text-xs text-ink-muted">
                What the agent is trying to achieve — qualify the lead for a human, or get them to book a meeting.
              </p>
            </div>
            <Toggle label="Active" checked={values.active} onChange={(v) => patch({ active: v })} className="sm:mt-1" />
            <div>
              <Select
                label="Channel"
                name="channel"
                required
                value={values.channel}
                onChange={(e) => patch({ channel: e.target.value as SdrChannel })}
                options={SDR_CHANNEL_OPTIONS}
              />
              <p className="mt-1.5 text-xs text-ink-muted">
                How the agent reaches leads. {values.channel === 'email' ? 'The lead needs an email address.' : 'The lead needs a phone number.'}
                {channelNeedsProvider && ' SMS and WhatsApp also need a messaging provider, which is not configured in this app yet.'}
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Persona & Offer" />
          <div className="flex flex-col gap-4">
            <Textarea
              label="Persona"
              value={values.persona ?? ''}
              onChange={(v) => patch({ persona: v })}
              placeholder='e.g. "a warm, concise real-estate SDR named Asha"'
              hint="How the agent should sound."
              rows={3}
            />
            <Textarea
              label="Offer context"
              value={values.offerContext ?? ''}
              onChange={(v) => patch({ offerContext: v })}
              placeholder="Premium plots in Jaipur with flexible payment plans."
              hint="What you sell and the value proposition — the agent would use this in every message."
              rows={3}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Guardrails" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Max follow-ups"
              name="maxFollowUps"
              required
              type="number"
              min={1}
              max={20}
              value={values.maxFollowUps}
              onChange={(e) => patch({ maxFollowUps: Number(e.target.value) })}
              hint="Hard ceiling on messages before the agent hands off."
            />
            <Input
              label="Min hours between follow-ups"
              name="minHoursBetweenFollowUps"
              required
              type="number"
              min={1}
              max={720}
              value={values.minHoursBetweenFollowUps}
              onChange={(e) => patch({ minHoursBetweenFollowUps: Number(e.target.value) })}
              hint="The same lead is never messaged more often than this."
            />
            <Toggle
              label="Respect business hours"
              description="Only send inside the Settings > Business Hours window."
              checked={values.respectBusinessHours}
              onChange={(v) => patch({ respectBusinessHours: v })}
              className="sm:col-span-2"
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Handoff" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Select
                label="Hand off to"
                name="handoffUserId"
                value={values.handoffUserId ?? ''}
                onChange={(e) => patch({ handoffUserId: e.target.value })}
                options={[{ value: '', label: 'Select an option' }, ...assignableUsers.map((u) => ({ value: u.id, label: u.name }))]}
              />
              <p className="mt-1.5 text-xs text-ink-muted">When the agent qualifies a lead, assign it to this rep.</p>
            </div>
            <div>
              <Input
                label="Meeting type (for booking goal)"
                name="meetingType"
                value={values.meetingType ?? ''}
                onChange={(e) => patch({ meetingType: e.target.value })}
                placeholder="e.g. Site visit (30 min)"
              />
              <p className="mt-1.5 text-xs text-ink-muted">
                Free text for now — this app has no meeting/booking-link feature to point at yet.
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => handleSave(false)} isLoading={isSaving}>
          {existing ? 'Save changes' : 'Create'}
        </Button>
        {!existing && (
          <Button variant="secondary" onClick={() => handleSave(true)} disabled={isSaving}>
            Create &amp; create another
          </Button>
        )}
        <Button variant="ghost" onClick={() => navigate('/crm/sdr-agents')} disabled={isSaving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
