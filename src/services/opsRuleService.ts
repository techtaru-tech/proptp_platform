import { api } from './apiClient';

/** Operations rules (server/src/routes/admin/opsRules.ts). */

export type ActionKind = 'notify' | 'create_task' | 'generate_demand_note' | 'create_payment_schedule' | 'release_hold' | 'close_file_mark_sold';
export interface RuleStep {
  delayHours: number;
  repeatEveryHours?: number | null;
  action: {
    kind: ActionKind; recipients?: string[]; channel?: 'in_app' | 'email' | 'whatsapp' | 'sms'; title?: string; message?: string;
    templateName?: string; templateLanguage?: string; templateParams?: string[]; dueInHours?: number;
    schedule?: { name: string; percent: number; offsetDays: number }[];
  };
}
export interface TriggerInfo {
  key: string; label: string; description: string; placeholders: string[]; actions: ActionKind[]; hasBuyer: boolean; hasOwner: boolean; event?: boolean;
  params: { key: string; label: string; default: number; unit: string }[];
}
export interface OpsRuleRow {
  id: string; name: string; trigger: string; enabled: boolean; enabledAt: string | null; config: Record<string, number>; steps: RuleStep[];
  fireCount: number; lastFiredAt: string | null;
}
export interface Catalogue { triggers: TriggerInfo[]; channels: string[]; modules: { key: string; label: string }[]; users: { id: string; name: string; role: string }[] }
export interface Preview {
  enabled: boolean; matching: number; wouldFireNowCount: number;
  wouldFireNow: { subject: string; step: number; action: string }[];
  upcoming: { subject: string; step: number; action: string; at: string }[];
}
export interface FireRow { id: string; subjectLabel: string; stepIndex: number; occurrence: number; status: 'sent' | 'skipped' | 'failed'; detail: string; firedAt: string }

export const ACTION_LABEL: Record<ActionKind, string> = {
  notify: 'Send a message', create_task: 'Create a task', generate_demand_note: 'Generate the demand note', create_payment_schedule: 'Create the payment schedule',
  release_hold: 'Release the plot hold', close_file_mark_sold: 'Close the buyer file and mark the plot sold',
};

export const getRuleCatalogue = () => api.get<Catalogue>('/ops-rules/catalogue');
export const listRules = () => api.get<OpsRuleRow[]>('/ops-rules');
export const saveRule = (id: string | null, body: { name: string; trigger: string; config: Record<string, number>; steps: RuleStep[] }) =>
  id ? api.patch<OpsRuleRow>(`/ops-rules/${id}`, body) : api.post<OpsRuleRow>('/ops-rules', body);
export const toggleRule = (id: string) => api.post<OpsRuleRow>(`/ops-rules/${id}/toggle`);
export const deleteRule = (id: string) => api.delete(`/ops-rules/${id}`);
export const previewRule = (id: string) => api.get<Preview>(`/ops-rules/${id}/preview`);
export const ruleFires = (id: string) => api.get<FireRow[]>(`/ops-rules/${id}/fires`);
