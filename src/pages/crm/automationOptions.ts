import type {
  AssignmentMode, AutomationActionType, AutomationConditionType, AutomationStepType, AutomationTriggerType,
} from '../../types';

export const TRIGGER_OPTIONS: { value: AutomationTriggerType; label: string; hasConfig?: boolean }[] = [
  { value: 'lead_created', label: 'Lead Created' },
  { value: 'lead_stage_changed', label: 'Lead Stage Changed', hasConfig: true },
  { value: 'lead_assigned', label: 'Lead Assigned' },
  { value: 'lead_score_threshold', label: 'Lead Score Threshold', hasConfig: true },
  { value: 'tag_added', label: 'Tag Added', hasConfig: true },
  { value: 'form_submitted', label: 'Form Submitted', hasConfig: true },
  { value: 'no_activity', label: 'No Activity', hasConfig: true },
  { value: 'manual', label: 'Manual' },
];

export const STEP_TYPE_OPTIONS: { value: AutomationStepType; label: string }[] = [
  { value: 'condition', label: 'Condition' },
  { value: 'action', label: 'Action' },
  { value: 'delay', label: 'Delay' },
];

export const CONDITION_OPTIONS: { value: AutomationConditionType; label: string }[] = [
  { value: 'source_is', label: 'Lead Source Is' },
  { value: 'source_is_not', label: 'Lead Source Is Not' },
  { value: 'ad_form_is', label: 'Meta Ad Form Is One Of' },
  { value: 'ad_form_is_not', label: 'Meta Ad Form Is None Of' },
  { value: 'has_tag', label: 'Has Tag' },
  { value: 'not_has_tag', label: 'Does Not Have Tag' },
  { value: 'field_equals', label: 'Lead Field Equals' },
  { value: 'field_contains', label: 'Lead Field Contains' },
  { value: 'field_is_empty', label: 'Lead Field Is Empty' },
  { value: 'score_gt', label: 'Score Greater Than' },
  { value: 'score_lt', label: 'Score Less Than' },
  { value: 'assigned_to', label: 'Assigned To' },
  { value: 'unassigned', label: 'Is Unassigned' },
];

export const ACTION_OPTIONS: { value: AutomationActionType; label: string }[] = [
  { value: 'assign_lead', label: 'Assign Lead' },
  { value: 'add_tag', label: 'Add Tag' },
  { value: 'remove_tag', label: 'Remove Tag' },
  { value: 'change_stage', label: 'Move To Pipeline Stage' },
  { value: 'update_field', label: 'Update Lead Field' },
  { value: 'create_followup', label: 'Create Follow-up Task' },
  { value: 'send_email', label: 'Send Email to Lead' },
  { value: 'enroll_in_sdr_agent', label: 'Enroll in AI SDR Agent' },
  { value: 'enroll_in_sequence', label: 'Enroll in Email Sequence' },
];

export const ASSIGN_MODE_OPTIONS: { value: AssignmentMode; label: string }[] = [
  { value: 'specific', label: 'Specific User' },
  { value: 'round_robin', label: 'Round Robin (whoever waited longest)' },
  { value: 'sequence', label: 'Distribution Order (N each, in turn)' },
  { value: 'team', label: 'Team' },
  { value: 'hierarchy', label: "A manager's team (rotates through whoever reports to them)" },
];

export const UPDATE_FIELD_OPTIONS = [
  { value: 'priority', label: 'Priority' },
  { value: 'status', label: 'Status' },
  { value: 'notes', label: 'Notes' },
];

export const DELAY_UNIT_OPTIONS = [
  { value: 'minutes', label: 'Minutes' },
  { value: 'hours', label: 'Hours' },
  { value: 'days', label: 'Days' },
];

/** Field keys the "Lead Field ..." conditions can meaningfully target — the engine also accepts
 * any plain Lead column name, this is just what's offered as a suggestion. */
export const CONDITION_FIELD_SUGGESTIONS = [
  'pipeline_stage.name', 'pipeline.name', 'source', 'priority', 'status', 'city', 'company', 'jobTitle', 'country', 'notes',
];

/** Which condition types need a plain value, a field name + value, or nothing at all. */
export function conditionNeedsField(type: AutomationConditionType): boolean {
  return type === 'field_equals' || type === 'field_contains' || type === 'field_is_empty';
}
export function conditionNeedsValue(type: AutomationConditionType): boolean {
  return type !== 'unassigned' && type !== 'field_is_empty';
}

/** The conditions that match a lead against a chosen set rather than one value. */
export function conditionNeedsValueList(type: AutomationConditionType): boolean {
  return type === 'ad_form_is' || type === 'ad_form_is_not';
}
