import { Badge, type BadgeTone } from './Badge';

type StatusMap = Record<string, { label: string; tone: BadgeTone }>;

const PROJECT_STATUS: StatusMap = {
  '1': { label: 'Active', tone: 'success' },
  '0': { label: 'Deactive', tone: 'neutral' },
};

/** Unit `booking_status`: 0=Available, 1=Booked, 2=Sold Out. */
const UNIT_STATUS: StatusMap = {
  '0': { label: 'Available', tone: 'success' },
  '1': { label: 'Booked', tone: 'info' },
  '2': { label: 'Sold Out', tone: 'shell' },
};

/** Unit `status` (active/deactive flag), distinct from booking_status. */
const UNIT_ACTIVE_STATUS: StatusMap = {
  '1': { label: 'Active', tone: 'success' },
  '0': { label: 'Deactive', tone: 'neutral' },
};

/** Booking `status`: 0=Pending, 1=Confirmed. */
const BOOKING_STATUS: StatusMap = {
  '0': { label: 'Pending', tone: 'warning' },
  '1': { label: 'Confirmed', tone: 'success' },
};

/** Booking `is_deposit`: 0=Initial payment, 1=Installment/deposit payment. */
const DEPOSIT_TYPE: StatusMap = {
  '0': { label: 'Initial Payment', tone: 'shell' },
  '1': { label: 'Installment', tone: 'accent' },
};

const ACCOUNT_STATUS: StatusMap = {
  active: { label: 'Active', tone: 'success' },
  inactive: { label: 'Inactive', tone: 'neutral' },
  suspended: { label: 'Suspended', tone: 'danger' },
};

const ATTENDANCE_STATUS: StatusMap = {
  not_checked_in: { label: 'Not Checked In', tone: 'neutral' },
  checked_in: { label: 'Checked In', tone: 'info' },
  checked_out: { label: 'Checked Out', tone: 'success' },
  pending_sync: { label: 'Pending Sync', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
};

const GEO_STATUS: StatusMap = {
  inside: { label: 'Inside Geo-fence', tone: 'success' },
  outside: { label: 'Outside Geo-fence', tone: 'danger' },
  unknown: { label: 'Unknown', tone: 'neutral' },
};

const SYNC_STATUS: StatusMap = {
  synced: { label: 'Synced', tone: 'success' },
  pending: { label: 'Pending', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
};

const PAYOUT_STATUS: StatusMap = {
  pending: { label: 'Pending', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'info' },
  released: { label: 'Released', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  failed: { label: 'Failed', tone: 'danger' },
};

const TICKET_STATUS: StatusMap = {
  open: { label: 'Open', tone: 'accent' },
  pending: { label: 'Pending', tone: 'warning' },
  resolved: { label: 'Resolved', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
};

/** Booking `paymant_mode` (real column, misspelled): 0=Bank Transfer, 1=Cash, 2=Cheque, 3=Other. */
const PAYMENT_MODE: StatusMap = {
  '0': { label: 'Bank Transfer', tone: 'shell' },
  '1': { label: 'Cash', tone: 'neutral' },
  '2': { label: 'Cheque', tone: 'info' },
  '3': { label: 'Other', tone: 'neutral' },
};

const CORRECTION_STATUS: StatusMap = {
  pending: { label: 'Pending Review', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

const NOTIFICATION_STATUS: StatusMap = {
  draft: { label: 'Draft', tone: 'neutral' },
  scheduled: { label: 'Scheduled', tone: 'warning' },
  sent: { label: 'Sent', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

const LEAD_STATUS: StatusMap = {
  new: { label: 'New', tone: 'neutral' },
  contacted: { label: 'Contacted', tone: 'info' },
  qualified: { label: 'Qualified', tone: 'warning' },
  won: { label: 'Won', tone: 'success' },
  lost: { label: 'Lost', tone: 'danger' },
};

const LEAD_PRIORITY: StatusMap = {
  low: { label: 'Low', tone: 'neutral' },
  normal: { label: 'Normal', tone: 'info' },
  high: { label: 'High', tone: 'warning' },
  urgent: { label: 'Urgent', tone: 'danger' },
};

const FOLLOW_UP_STATUS: StatusMap = {
  pending: { label: 'Pending', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  missed: { label: 'Missed', tone: 'danger' },
  rescheduled: { label: 'Rescheduled', tone: 'info' },
};

const INTEGRATION_STATUS: StatusMap = {
  connected: { label: 'Connected', tone: 'success' },
  disconnected: { label: 'Disconnected', tone: 'neutral' },
  error: { label: 'Error', tone: 'danger' },
};

const INTEGRATION_ACTIVITY_STATUS: StatusMap = {
  pending: { label: 'Pending', tone: 'warning' },
  processed: { label: 'Processed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  invalid_signature: { label: 'Invalid Signature', tone: 'danger' },
};

const AUTOMATION_RUN_STATUS: StatusMap = {
  success: { label: 'Success', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};

const MAPS = {
  project: PROJECT_STATUS,
  unit: UNIT_STATUS,
  unitActive: UNIT_ACTIVE_STATUS,
  booking: BOOKING_STATUS,
  depositType: DEPOSIT_TYPE,
  account: ACCOUNT_STATUS,
  attendance: ATTENDANCE_STATUS,
  geo: GEO_STATUS,
  sync: SYNC_STATUS,
  payout: PAYOUT_STATUS,
  ticket: TICKET_STATUS,
  paymentMode: PAYMENT_MODE,
  correction: CORRECTION_STATUS,
  notification: NOTIFICATION_STATUS,
  leadStatus: LEAD_STATUS,
  leadPriority: LEAD_PRIORITY,
  followUpStatus: FOLLOW_UP_STATUS,
  integrationStatus: INTEGRATION_STATUS,
  integrationActivity: INTEGRATION_ACTIVITY_STATUS,
  automationRun: AUTOMATION_RUN_STATUS,
} satisfies Record<string, StatusMap>;

export type StatusKind = keyof typeof MAPS;

interface StatusBadgeProps {
  kind: StatusKind;
  status: string | number;
  dot?: boolean;
  className?: string;
}

export function StatusBadge({ kind, status, dot = true, className }: StatusBadgeProps) {
  const key = String(status);
  const entry = MAPS[kind][key] ?? { label: key, tone: 'neutral' as const };
  return (
    <Badge tone={entry.tone} dot={dot} className={className}>
      {entry.label}
    </Badge>
  );
}
