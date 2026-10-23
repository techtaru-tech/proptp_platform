// ============================================================================
// Core enums & shared primitives
// ============================================================================

/** Existing ShreeRam Partner role IDs — preserved as-is, do not invent new roles. */
export const RoleId = {
  Agent: 0,
  Admin: 1,
  Employee: 2,
  Leader: 3,
  /** Ours, not the real system's: sits between a Leader and the Employees under them. */
  TeamLeader: 4,
} as const;
export type RoleId = (typeof RoleId)[keyof typeof RoleId];

export type RoleName = 'Agent' | 'Admin' | 'Employee' | 'Leader' | 'Team Leader';

export const ROLE_NAME_BY_ID: Record<RoleId, RoleName> = {
  [RoleId.Agent]: 'Agent',
  [RoleId.Admin]: 'Admin',
  [RoleId.Employee]: 'Employee',
  [RoleId.Leader]: 'Leader',
  [RoleId.TeamLeader]: 'Team Leader',
};

export type AccountStatus = 'active' | 'inactive' | 'suspended';

/** `User.role` as the API spells it. Distinct from the numeric `RoleId` the older screens use. */
export type AccountRole = 'admin' | 'employee' | 'leader' | 'team_leader' | 'channel_partner';

/**
 * Real `funds` table (`Admin\PaymentLogController`) — manual wallet-deposit requests that need
 * admin approval. Automated gateways (PayTM/RazorPay/PayUmoney) auto-confirm via webhook and
 * never reach `status=2`; only manual methods (e.g. Bank Transfer) sit in this queue. Status
 * codes kept exactly as in the real system for fidelity: 2=pending, 1=approved, 3=rejected.
 */
export type FundStatus = 2 | 1 | 3;

/**
 * Real `incentive_reqs` table (`ManagePropertyController::incentiverequest/incentivereqchange`).
 * The real handler is intentionally thin — it only flips `status`, with no balance/Transaction
 * side effect in that action itself (the actual payout, if any, happens elsewhere) — modeled
 * here exactly that thin, to stay faithful rather than inventing a payout mechanism.
 */
export type IncentiveRequestStatus = 0 | 1 | 2; // 0 = pending, 1 = accepted, 2 = rejected

// ============================================================================
// Referral commission configuration — real `Admin\ReferralCommissionController` +
// `Admin\BadgeController`. Distinct from the per-payout `referralBonus`/`commission`
// numbers already tracked on PayoutRequest — this is the CONFIGURATION admins set up
// (level→percent tables, team-volume incentive ladder, badge/rank thresholds), not the
// resulting ledger entries.
// ============================================================================

export type CommissionType = 'deposit' | 'investment' | 'profit';

/** Real global on/off toggles, persisted into `config/basic.php` in the real system. */
export interface ReferralCommissionToggles {
  depositCommission: boolean;
  investmentCommission: boolean;
  profitCommission: boolean;
}

/** Real `referrals` table — level → percent, one table per commission type. */
export interface ReferralLevelRule {
  commissionType: CommissionType;
  level: number;
  percent: number;
}

/** Real `plan_levels` table — a team-volume-range → incentive % ladder (validated to not overlap). */
export interface PlanLevel {
  id: string;
  levelTitle: string;
  rangeFrom: number;
  rangeTo: number;
  incentive: number;
}

/** Real `badges` (+ `badge_details`) table — rank thresholds and bonus, admin-configurable and sortable; real-world promotion is cron-driven (`UpdateBadgeCron`), not a manual admin action. */
export interface Badge {
  id: string;
  rankName: string;
  rankLevel: number;
  description?: string;
  minInvest: number;
  minDeposit: number;
  minEarning: number;
  bonus: number;
  status: 1 | 0;
  sortOrder: number;
}

/** Real `manage_times` table — master data for investment return/maturity duration options (e.g. "12 Months"), managed via `ManagePropertyController::scheduleManage/storeSchedule/updateSchedule`. */
export type ManageTimeType = 'Days' | 'Months' | 'Years';

export interface ManageTime {
  id: string;
  time: number;
  timeType: ManageTimeType;
  status: 1 | 0;
}

export interface IncentiveRequest {
  id: string;
  userId: string;
  propertyId: string;
  status: IncentiveRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export interface FundRequest {
  id: string;
  userId: string;
  amount: number;
  gatewayName: string; // e.g. "Bank Transfer" — the manual method used
  trxId: string;
  status: FundStatus;
  feedback?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Real `bookings.paymant_mode` (sic, real column is misspelled) column comment:
 * 0=Bank Transfer, 1=Cash, 2=Cheque, 3=Other. The real Property module's admin booking flow
 * has no gateway mode, but the partner app's booking screen does — so 4=Online exists only
 * for bookings that came in through the app.
 */
export type PaymentMode = 0 | 1 | 2 | 3 | 4;
export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  0: 'Bank Transfer',
  1: 'Cash',
  2: 'Cheque',
  3: 'Other',
  4: 'Online',
};

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DateRange {
  from: string; // ISO date
  to: string; // ISO date
}

export interface AuditEntry {
  id: string;
  userId: string;
  userName: string;
  action: string;
  module: string;
  recordId: string;
  recordLabel: string;
  timestamp: string;
  description: string;
  /** Field-by-field what changed, where the database layer saw it. */
  changes?: { model: string; id: string; field: string; from: string | null; to: string | null }[];
}

// ============================================================================
// Projects / Properties
//
// Ported from the real Laravel "ShreeRam Partner" app at Developer/Laravel/Shreeram —
// NOT a simple flat-booking system. `Project` is a scheme/grouping (e.g. a plot yojana);
// `PropertyUnit` (real table `manage_properties`) is the actual sellable/investable unit,
// and it supports PARTIAL INVESTMENT with profit/loss %, installment plans and a
// capital-back option — not just a single lump-sum purchase. Field names below mirror
// the real DB columns (camelCased) so a future real API integration needs no reshaping.
// ============================================================================

/** Real `projects.status`: 1 = Active, 0 = Deactive. */
export type ProjectStatus = 1 | 0;

/** Real `jda_certificates` / `rera_certificates` / `construction_photo_graphs` — each just one `file` per row, many rows per project. */
export interface ProjectCertificateFile {
  id: string;
  file: string;
  /** Only meaningful for construction photographs, which the app reads as its progress feed. */
  capturedOn?: string;
  caption?: string;
  isVideo?: boolean;
}

/** The partner app's closed 3-value category, which the free-text `projectType` cannot express. */
export type ProjectCategory = 'residential' | 'commercial' | 'agricultural';

export interface Project {
  id: string;
  projectName: string;
  projectType?: string; // free text on the real column, e.g. "Plots", "Farm Land" — not an enum/FK
  category: ProjectCategory;
  projectLocation: string;
  landArea: string; // varchar on the real column, e.g. "5000 sq yard"
  projectPrice?: string; // varchar display price, e.g. "Starting ₹45 L"
  projectDescription: string;
  status: ProjectStatus;
  sortOrder: number;
  /** Why a deactivated project is on hold. Shown to partners in the app alongside the status. */
  holdReason?: string;

  banner?: string;
  thumbnail?: string; // real `pro_img`
  map?: string; // site map image
  googleLocation?: string; // real `google_location` — a maps link/embed, not lat/lng columns
  /** Real coordinates, so the app can drop a pin instead of falling back to a text search. */
  latitude?: number;
  longitude?: number;
  layoutPlanUrl?: string;
  /** Extra image URLs beyond banner/thumbnail/map — the app's project gallery. */
  gallery: string[];
  distanceMap?: string;
  d3ViewLink?: string;
  d3ViewFile?: string;
  d3WalkthroughLink?: string;
  d3WalkthroughFile?: string;

  /** Real `amenity_id` — a JSON array of Amenity IDs stored directly on the project row (no pivot table). */
  amenityIds: string[];
  jdaCertificates: ProjectCertificateFile[];
  reraCertificates: ProjectCertificateFile[];
  constructionPhotographs: ProjectCertificateFile[];
  /** Derived plot tallies, counted in the same query as the project row. */
  unitCounts?: { total: number; available: number; booked: number; soldOut: number };

  createdAt: string;
  updatedAt: string;
}

/** Real lookup table `property_type` (id/name only) — used as a Select source when creating a unit, though the unit itself stores the choice as free text (no FK), matching the real system's actual (inconsistent) behavior. */
export interface PropertyTypeOption {
  id: string;
  name: string;
}

/** Real lookup table `addresses` (+ `address_details` for the per-language name) — an area/locality picker, e.g. "Vesu", "Adajan". Verified against the real admin/property create & edit forms. */
export interface AddressOption {
  id: string;
  name: string;
}

/** Real `manage_properties.status`: 1 = active, 0 = deactive — the UNIT record's own active flag, independent of its booking state. */
export type UnitActiveStatus = 1 | 0;

/** Real `manage_properties.booking_status`: 0 = Available, 1 = Booked, 2 = Sold Out. */
export type UnitBookingStatus = 0 | 1 | 2;

/** Real `plot_facings` table (`pro_id`, `key`, `value`) — a free-form key/value repeater on the unit form (e.g. "Facing" → "North", "Road Width" → "40 ft"). */
export interface PlotFacing {
  key: string;
  value: string;
}

/**
 * Verified directly against the real admin `resources/views/admin/property/create.blade.php` +
 * `edit.blade.php` + `ManagePropertyController@propertyStore/propertyUpdate`. The real
 * `manage_properties` table also carries `is_invest_type`/`is_return_type`/`is_installment`/
 * `minimum_amount`/`maximum_amount`/`total_installments`/`installment_*`/`loss`/`is_capital_back`
 * columns, but NONE of them have any admin form field in the real system (dead/vestigial columns
 * left over from a different investment-product template) — they are intentionally NOT modeled
 * here since there is no real admin functionality to replicate. `bhk` is a form field in the real
 * create view but is never read by the controller — also intentionally omitted.
 */
export interface PropertyUnit {
  id: string;
  projectId: string;
  addressId?: string; // real `address_id` — an area/locality picker, set on the first-language tab only

  // Real `manage_property_details` (per-language row, flattened here to one language)
  propertyTitle: string;
  propertyNumber: string;
  propertyType: string; // free text — real data is inconsistent (a name or a loose numeric string)
  propertyArea: string; // varchar, e.g. "138.88"
  propertyMeasurement: string; // e.g. "Sq yard", "Sq feet"
  width?: string;
  length?: string;
  details?: string;
  faq: { title: string; details: string }[]; // storage exists server-side but the real admin UI has no way to create these — always empty in practice

  status: UnitActiveStatus;
  bookingStatus: UnitBookingStatus;
  isCorner: boolean;
  isFeatured: boolean;
  isVerified: boolean;
  location?: string; // free-text embed URL, per the real form's own label
  thumbnail?: string;
  sitePlan?: string;
  /** Real polymorphic `images` table (imageable_type/imageable_id) — a proper multi-image gallery, unlike the project's single-file media columns. */
  images: string[];
  amenityIds: string[];
  plotFacings: PlotFacing[];

  constructedArea?: string;
  /** Real `per_area_amount` rate — the form auto-computes `totalInvestmentAmount = perAreaAmount * propertyArea` (bidirectionally editable, matching the real JS). */
  perAreaAmount: number;
  /** Real `per_area_profit` rate — the form auto-computes `profit = perAreaProfit * propertyArea`. Despite the column name, `profit` here is a currency AMOUNT ("Total Commission" in the real UI), not a percentage. */
  perAreaProfit: number;
  totalInvestmentAmount: number;
  profit: number;

  /**
   * The amounts the partner app's booking screen adds on top of the base price, and the
   * token a customer pays to book. `charges + gstAndRegistration + totalInvestmentAmount`
   * is the grand total the app shows; the admin's "remaining balance" still measures
   * against `totalInvestmentAmount` alone, exactly as the real system does.
   */
  charges: number;
  gstAndRegistration: number;
  tokenAmount: number;

  bookedBy?: string; // userId of the booking partner/agent, mirrors real `booked_by`

  createdAt: string;
  updatedAt: string;
}

/** Real `plot_holds` — a short, time-boxed hold on a unit, independent of `bookingStatus`. An admin can release it early. */
export interface PlotHold {
  id: string;
  unitId: string;
  userId?: string;
  holdStart: string;
  holdEnd: string;
  /** 1 = active hold, 0 = released/expired. */
  status: 1 | 0;
}

// ============================================================================
// Bookings
//
// Real `bookings` table: no direct `project_id` (only reachable via unit -> project),
// and no single stored paid/remaining amount — a unit can have MANY booking rows
// (an initial booking plus later deposit/installment payments, distinguished by
// `isDeposit`), and "remaining" is derived as unit.totalInvestmentAmount minus the
// sum of that unit's non-deposit-distinct booking amounts. See bookingService.ts.
// ============================================================================

/**
 * Real `bookings.status` — 0/1 used in code as pending/confirmed, not documented as a named
 * enum in the real system either. 2=Part-Paid and 3=Cancelled are additions the partner app
 * needs (it exposes the full four-state list) and only ever appear on app-created bookings.
 */
export type BookingStatus = 0 | 1 | 2 | 3;
export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  0: 'Pending',
  1: 'Confirmed',
  2: 'Part-Paid',
  3: 'Cancelled',
};

// ============================================================================
// Investments — real `investments` table (`InvestmentController`).
//
// Confirmed via real controller code to be a GENUINELY SEPARATE ledger row from
// Booking: a Booking row records who booked/paid and how (KYC, payment mode);
// an Investment row records the money placed against the plot as an investment,
// carrying its own profit/loss model, activation lifecycle and return schedule.
// One Investment is created per deposit (sibling to the Booking row that
// triggered it), via the real `InvestmentService::forAllInvest()`.
// ============================================================================

/** 0 = flat currency amount, 1 = percentage — same convention as `ManageProperty.profit_type`. */
export type ProfitLossType = 0 | 1;

/** Real `investments.is_active` — an admin can deactivate an investment (always with a reason). */
export type InvestmentActiveState = 1 | 0;

export interface Investment {
  id: string;
  userId: string; // the investor (partner/agent) — real `user_id`
  propertyId: string; // FK -> PropertyUnit.id — real `property_id`
  bookingId: string; // the originating Booking/deposit row — real `trx`
  amount: number;
  profit: number;
  profitType: ProfitLossType;
  netProfit: number;
  loss: number;
  lossType: ProfitLossType;
  isActive: InvestmentActiveState;
  deactiveReason?: string; // required by the real system whenever isActive is set to 0
  returnDate?: string; // next profit/return disbursement due date
  lastReturnDate?: string; // when a return was last actually paid out
  createdAt: string;
  updatedAt: string;
}

/**
 * The real admin list ("Deposits") is filtered into these four buckets, but none of them
 * are stored fields — they're computed from `isActive` + the linked unit's `bookingStatus`/
 * `isVerified` + `returnDate`, exactly mirroring the real `InvestmentController::investments()`
 * query logic ("completed" = unit booking_status=2, "running" = booking_status=1 && is_verified).
 */
export type InvestmentBucket = 'running' | 'due' | 'expired' | 'completed';

export interface Booking {
  id: string;
  /** Server-generated and unique, e.g. "BKG-20501" — never accepted from a client. */
  reference: string;
  propertyId: string; // FK -> PropertyUnit.id (matches real column name `property_id`)
  bookingName: string;
  phone: string;
  userId?: string; // partner/agent who made the booking, real `user_id`
  /** A downline member credited alongside the booking partner (partner app only). */
  involvedMemberId?: string;
  /** Server-computed from the plot's commission rate — never accepted from a client. */
  commission: number;
  /** Required when paymentMode is Other — how the payment was actually made. */
  note?: string;
  amount: number; // real column is a free-form `longtext`; kept numeric here for display/aggregation
  paymentMode: PaymentMode;
  chequeImage?: string;
  aadhaarNumber?: string;
  aadhaarImage?: string;
  aadhaarBack?: string;
  /** 0 = initial booking payment, 1 = a later deposit/installment payment against the same unit. */
  isDeposit: 0 | 1;
  status: BookingStatus;
  createdAt: string;
  updatedAt: string;
}


// ============================================================================
// Enriched list rows
//
// List endpoints return their rows pre-joined with the display names the screens need
// (project name, plot label, partner name). The mock layer faked these with synchronous
// cross-collection lookups; resolving them in the query instead means no screen has to
// hold the whole property catalogue or partner directory in memory to render a table.
// ============================================================================

export interface BookingRow extends Booking {
  projectId?: string;
  projectName: string;
  unitLabel: string;
  plotNumber: string;
  partnerName: string;
}

export interface PlotHoldRow extends PlotHold {
  projectId: string;
  projectName: string;
  unitLabel: string;
  userName: string;
}

export interface InvestmentRow extends Investment {
  bucket: InvestmentBucket;
  projectId: string;
  projectName: string;
  unitLabel: string;
  userName: string;
  bookingReference: string;
}

export interface FundRequestRow extends FundRequest {
  userName: string;
  userPhone: string;
}

export interface IncentiveRequestRow extends IncentiveRequest {
  userName: string;
  projectName: string;
  unitLabel: string;
}

/** A partner's payout destination (real `bank_accounts`). Full account number — the UI masks it. */
export interface BankAccount {
  id: string;
  bankName: string;
  accountNumber: string;
  holderName: string;
  ifsc: string;
  accountType: string;
  state: 'verified' | 'pending' | 'rejected';
  isPrimary: boolean;
}

// ============================================================================
// Partners / Users
// ============================================================================

/** Real `users.adhar_verification`: 0 = pending, 1 = verified, 2 = rejected (rejection also deactivates the account in the real system). */
export type KycStatus = 0 | 1 | 2;

export interface BaseUser {
  id: string;
  name: string;
  phone: string;
  email: string;
  role: RoleId;
  status: AccountStatus;
  avatarUrl?: string;
  referralCode: string;
  /** Server-owned and unique, format SR-<ROLE>-<n>. Equal to `referralCode` for accounts
   *  created by this backend; kept separate because legacy rows can differ. */
  partnerCode: string;
  sponsorId?: string; // referred by
  createdAt: string;
  city?: string;
  address?: string;
  bankAccountMasked?: string;
  bankIfsc?: string;
  panMasked?: string;
  /** Real `users.balance` — spendable wallet balance. */
  walletBalance: number;
  kycStatus: KycStatus;
  /** Who this person reports to in the CRM hierarchy (Leader → Team Leader → Employee → Agent). */
  managerId?: string;
  managerName?: string;
}

export interface Agent extends BaseUser {
  role: typeof RoleId.Agent;
  teamId?: string;
  totalBookings: number;
  totalReferrals: number;
}

export interface Employee extends BaseUser {
  role: typeof RoleId.Employee;
  leaderId?: string;
  teamId?: string;
  designation: string;
  attendanceStatusToday: AttendanceStatus;
}

export interface Leader extends BaseUser {
  role: typeof RoleId.Leader;
  teamId: string;
  teamSize: number;
  employeeCount: number;
  agentCount: number;
  attendanceStatusToday: AttendanceStatus;
}

export interface TeamLeader extends BaseUser {
  role: typeof RoleId.TeamLeader;
  teamId?: string;
  teamSize: number;
  employeeCount: number;
  agentCount: number;
  attendanceStatusToday: AttendanceStatus;
}

export type PartnerUser = Agent | Employee | Leader | TeamLeader;

// ============================================================================
// Teams / Referrals
// ============================================================================

export interface Team {
  id: string;
  name: string;
  leaderId: string;
  memberIds: string[];
  createdAt: string;
}

export interface TeamTreeNode {
  userId: string;
  name: string;
  role: RoleId;
  status: AccountStatus;
  teamSize: number;
  children: TeamTreeNode[];
}

// ============================================================================
// Attendance
// ============================================================================

export type AttendanceStatus =
  | 'not_checked_in'
  | 'checked_in'
  | 'checked_out'
  | 'pending_sync'
  | 'failed';

export type GeoFenceResult = 'inside' | 'outside' | 'unknown';

export interface GeoPoint {
  lat: number;
  lng: number;
  address?: string;
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  userName: string;
  role: typeof RoleId.Employee | typeof RoleId.Leader | typeof RoleId.TeamLeader;
  date: string; // ISO date
  checkInAt?: string;
  checkOutAt?: string;
  workingHours?: number;
  status: AttendanceStatus;
  isLate: boolean;
  isEarlyDeparture: boolean;
  checkInLocation?: GeoPoint;
  checkOutLocation?: GeoPoint;
  geoFenceResult: GeoFenceResult;
  distanceFromOfficeMeters?: number;
  syncStatus: 'synced' | 'pending' | 'failed';
  failureReason?: string;
  correctionRequested?: boolean;
  correctionReason?: string;
  correctionStatus?: 'pending' | 'approved' | 'rejected';
}

export interface AttendancePolicy {
  officeLat: number;
  officeLng: number;
  geoFenceRadiusMeters: number;
  workStartTime: string;
  lateAfterMinutes: number;
  standardWorkingHours: number;
}

// ============================================================================
// Payouts / Earnings
// ============================================================================

/**
 * Real `PayoutRecordController` 5-state lifecycle (verified against the real controller):
 * `pending` (request raised) → `confirmed` (admin/gateway confirms, real status=5) → `released`
 * (balance actually debited, real status=2) is a genuine TWO-STEP process, not one "approve".
 * `rejected` (real status=3, only from pending, refunds if already debited) and `failed` (real
 * status=4, an automatic-gateway webhook failure, refunds the balance) are the two terminal
 * failure states.
 */
export type PayoutStatus = 'pending' | 'confirmed' | 'released' | 'rejected' | 'failed';

export interface PayoutRequest {
  id: string;
  userId: string;
  userName: string;
  role: RoleId;
  amount: number;
  requestDate: string;
  status: PayoutStatus;
  processor?: string;
  bankAccountMasked: string;
  bankIfsc: string;
  referralBonus: number;
  commission: number;
  /** Real system distinguishes automatic (gateway-driven) vs manual payout methods — only automatic ones can fail via webhook. */
  isAutomaticMethod: boolean;
  /** Populated only when a `failed` webhook callback provides an error message. */
  lastError?: string;
  statusHistory: { status: PayoutStatus; timestamp: string; note?: string }[];
}

export interface CommissionStatementEntry {
  id: string;
  userId: string;
  userName: string;
  referralUserId?: string;
  referralUserName?: string;
  commission: number;
  bonus: number;
  date: string;
  status: PayoutStatus;
}

// ============================================================================
// Support Tickets
// ============================================================================

export type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed';

export interface TicketMessage {
  id: string;
  ticketId: string;
  authorId: string;
  authorName: string;
  authorRole: 'admin' | 'user';
  message: string;
  attachments?: string[];
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  userId: string;
  userName: string;
  userRole: RoleId;
  subject: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  lastReplyAt?: string;
  messages: TicketMessage[];
}

// ============================================================================
// Notifications
// ============================================================================

export type NotificationAudience = 'all' | 'agents' | 'employees' | 'leaders' | 'custom';
export type NotificationDeliveryStatus = 'draft' | 'scheduled' | 'sent' | 'delivered' | 'failed';

/** Decides the icon/colour the partner app renders, so it is stored rather than guessed. */
export type NotificationType = 'booking' | 'payout' | 'team' | 'system';

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  type: NotificationType;
  audience: NotificationAudience;
  createdAt: string;
  deliveryStatus: NotificationDeliveryStatus;
  /** Set only while it is still waiting to go out. */
  scheduledFor?: string;
  sentAt?: string;
  recipientCount: number;
  deliveredCount: number;
  failedCount: number;
}

// ============================================================================
// CRM / Leads
//
// Ported from the existing Laravel 13 + Filament 4 CRM's `leads` module.
// Field names, enum values, pipeline/stage shape and activity types below are
// taken from the actual Lead model/migrations/enums, not just the functional
// spec doc — where the two disagreed, the code won. Scope is deliberately the
// "minimum viable set" the spec itself calls out: leads, activities, notes,
// tasks (follow-ups), stage/assignment history, tags. Webhooks, CSV import
// wizards, automations, quotes/invoices/deal-items and email/SMS sequencing
// are backend-only concerns and are not modeled here.
// ============================================================================

/** Matches `App\Enums\LeadStatus`. Distinct from pipeline stage — every lead has both. */
export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'won' | 'lost';

/** Matches `App\Enums\LeadPriority`. */
export type LeadPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * Matches `App\Enums\LeadSource`. Sources are NOT a closed set in the real system —
 * `source` is a plain string column and the Filament form merges these enum options
 * with any custom source values already in use. `otherSource` carries that free text.
 */
export type LeadSource =
  | 'meta'
  | 'instagram'
  | 'tiktok'
  | 'linkedin'
  | 'whatsapp'
  | 'viber'
  | 'telegram'
  | 'twitter'
  | 'snapchat'
  | 'pinterest'
  | 'google_ads'
  | 'youtube'
  | 'microsoft_ads'
  | 'email'
  | 'typeform'
  | 'jotform'
  | 'calendly'
  | 'web_form'
  | 'walk_in'
  | 'referral'
  | 'portal'
  | 'channel_partner'
  | 'direct_enquiry'
  | 'dlt_sms'
  | 'manual'
  | 'other';

/** How warm the buyer is, as the sales team reads it. Separate from `priority`, which is how urgent the lead is to work. */
export type LeadTemperature = 'hot' | 'warm' | 'cold';

/** Matches `App\Enums\FollowUpStatus` on `lead_tasks`. */
export type FollowUpStatus = 'pending' | 'completed' | 'missed' | 'rescheduled';

export interface LeadTag {
  id: string;
  name: string;
  color: string;
}

export interface Pipeline {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
}

export interface PipelineStage {
  id: string;
  pipelineId: string;
  name: string;
  color: string;
  sortOrder: number;
  isWon: boolean;
  isLost: boolean;
  winProbability?: number;
  expectedDurationDays?: number;
}

export interface Lead {
  /** Answers to fields the CRM does not ship with — detail response only. */
  customFields?: LeadCustomValue[];
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone: string;
  city?: string;
  company?: string;
  jobTitle?: string;

  /** What the buyer is after. Free text, offered as dropdowns on the form. */
  purpose?: string;
  propertyType?: string;
  budgetRange?: string;
  /** A buyer can be after more than one area. */
  preferredLocations?: string[];

  /** Which Meta ad produced this lead. Only on Meta leads ingested after this was added. */
  adDetail?: {
    /** The Meta lead form's name — the most specific attribution this token can read. */
    formName?: string | null;
    campaignId?: string | null;
    campaignName?: string | null;
    adsetId?: string | null;
    adsetName?: string | null;
    adId?: string | null;
    adName?: string | null;
    formId?: string | null;
  } | null;
  country?: string;

  source: LeadSource;
  otherSource?: string;
  /** External lead ID from the source platform (e.g. Meta's leadgen_id) — used by the real system's dedupe short-circuit on (tenant, source, source_id). */
  externalLeadId?: string;
  /** Which configured LeadSourceConnection ingested this lead, when it arrived via a webhook rather than manual entry. */
  sourceConnectionId?: string;

  /** Attribution — populated only for webhook/form-sourced leads, never editable via the form (matches the real system's disabled+dehydrated(false) UTM fields). */
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  landingPage?: string;
  referrerUrl?: string;

  /** The channel that first earned the lead. Fixed for life; `source` is the working source and may change. */
  originalSource?: string;
  interestedProjectId?: string;
  temperature?: LeadTemperature | null;
  status: LeadStatus;
  priority: LeadPriority;
  leadScore: number;
  isStarred: boolean;
  isDuplicate: boolean;
  /** Set when this lead arrived while Settings > Business Hours marked the office closed. Informational only. */
  receivedOutsideBusinessHours: boolean;

  pipelineId?: string;
  pipelineStageId?: string;
  stageEnteredAt?: string;

  dealValue?: number;
  dealCurrency?: string;
  expectedCloseDate?: string;
  wonValue?: number;
  wonAt?: string;
  lostReason?: string;
  lostAt?: string;

  /** Real FK owner. Prefer this over `assignedTo` when both are present. */
  assignedUserId?: string;
  assignedTeamId?: string;
  /** Free-text owner name — only populated when a CSV import names someone not yet in the system. */
  assignedTo?: string;

  tagIds: string[];

  notes?: string;
  contactedAt?: string;
  /** Derived server-side from the earliest open follow-up task — never set directly from a form. */
  nextFollowUpAt?: string;

  /** The newest row from the lead's activity trail, for the list's "Last Activity" column. */
  lastActivity?: { type: string; description: string; at: string } | null;

  createdAt: string;
  updatedAt: string;
}

/**
 * Exhaustive set of activity types actually written by `LeadActivityService` in the
 * real system. `message_sent`/`message_received`/`call_inbound`/`call_outbound` are
 * referenced by the "waiting on" query but never written anywhere in the codebase —
 * left out here as genuinely unimplemented rather than modeled as real states.
 */
export type LeadActivityType =
  | 'created'
  | 'imported'
  | 'status_changed'
  | 'stage_moved'
  | 'assigned'
  | 'score_changed'
  | 'note_added'
  | 'call_logged'
  | 'email_sent'
  | 'email_received'
  | 'tag_applied'
  | 'tag_removed'
  | 'meeting_scheduled'
  | 'meeting_rescheduled'
  | 'meeting_cancelled';

export interface LeadActivity {
  id: string;
  leadId: string;
  type: LeadActivityType;
  description: string;
  metadata?: Record<string, unknown>;
  userId?: string;
  userName?: string;
  createdAt: string;
}

export interface LeadNote {
  id: string;
  leadId: string;
  userId: string;
  userName: string;
  body: string;
  createdAt: string;
}

/** Matches `lead_tasks` — the real system's "follow-up". */
export interface LeadFollowUp {
  id: string;
  leadId: string;
  title: string;
  description?: string;
  dueAt: string;
  reminderAt?: string;
  priority: LeadPriority;
  status: FollowUpStatus;
  assignedUserId?: string;
  completed: boolean;
  completedAt?: string;
  createdAt: string;
}

export interface LeadStageHistoryEntry {
  id: string;
  leadId: string;
  fromStageName?: string;
  toStageName: string;
  actorId?: string;
  actorName?: string;
  createdAt: string;
}

export interface LeadAssignmentHistoryEntry {
  id: string;
  leadId: string;
  fromUserName?: string;
  toUserName?: string;
  actorId?: string;
  actorName?: string;
  createdAt: string;
}

// ============================================================================
// CRM / Lead Source Integrations & Assignment Automation
//
// Ported from the Laravel CRM's `LeadSourceConnection` model (per-tenant,
// per-source webhook connections with OAuth for some sources) and its generic
// `Automation`/`AutomationStep`/`AutomationRun` engine — specifically the
// `assign_lead` action (modes: specific/round_robin/team), which is how
// automatic lead assignment actually works there (there is no separate
// "assignment rules" table). Only sources with a real, working ingestion path
// are modeled: Meta (genuine Graph API + signature verification) and Google
// Ads / LinkedIn / Instagram / Typeform / Web Form (generic webhook receiver —
// real per-tenant connection + credentials, but no authenticated platform API
// polling behind it). Credentials/tokens are never represented here.
// ============================================================================

export type IntegrationStatus = 'connected' | 'disconnected' | 'error';

/** Sources with a real Filament "Authorize via OAuth" flow in the actual system. */
export const OAUTH_CAPABLE_SOURCES: LeadSource[] = ['meta', 'instagram', 'tiktok', 'linkedin', 'google_ads', 'microsoft_ads'];

export interface LeadSourceConnection {
  id: string;
  source: LeadSource;
  name: string;
  status: IntegrationStatus;
  active: boolean;
  /** e.g. a connected Facebook Page name, or a masked Google Ads customer ID — never a token/secret. */
  connectedAccountLabel?: string;
  lastReceivedAt?: string;
  lastError?: string;
  /** Compact masked form for card/list views — the unmasked token lives inside `webhookUrl`. */
  webhookTokenMasked: string;
  /**
   * Live receiver URL, shown unmasked because the admin has to paste it into the source platform.
   * `POST /api/webhook/<source>/<token>` for every source except Meta, which authenticates by
   * request signature at `/api/webhook/meta` instead. The token is the credential here, so this
   * URL can be rotated from the Integrations page.
   */
  webhookUrl: string;
  /** Source key -> lead field. Optional: common key names are auto-detected by the receiver. */
  fieldMapping?: Record<string, string>;
  /** Which credential fields are stored for this connection. Values never leave the server. */
  credentialKeys?: string[];
}

/**
 * Mirrors the real `webhook_logs` table (source, status, payload, error_message,
 * leads_created, processed_at). 'pending' and 'invalid_signature' are statuses
 * confirmed directly in the webhook receiver code; 'processed' and 'failed' are
 * inferred from the schema's `processed_at`/`leads_created`/`error_message`
 * columns as the natural terminal states, not directly observed in the handler.
 * No retry mechanism was found in the real system, so none is represented here.
 */
export type IntegrationActivityStatus = 'pending' | 'processed' | 'failed' | 'invalid_signature';

export interface IntegrationActivityEntry {
  id: string;
  connectionId: string;
  source: LeadSource;
  status: IntegrationActivityStatus;
  leadId?: string;
  leadsCreated: number;
  errorMessage?: string;
  receivedAt: string;
  processedAt?: string;
}

// ---------------------------------------------------------------------------
// Automation — a trigger plus an ordered list of steps (condition / action / delay),
// executed top-to-bottom for the lead that fired the trigger. See
// server/src/services/automationEngine.ts for how each step type actually runs.
// ---------------------------------------------------------------------------

export type AutomationTriggerType =
  | 'lead_created'
  | 'lead_stage_changed'
  | 'lead_assigned'
  | 'lead_score_threshold'
  | 'tag_added'
  | 'form_submitted'
  | 'no_activity'
  | 'manual';

/** Matches the real `AutomationStep` condition types exactly. */
export type AutomationConditionType =
  | 'source_is'
  | 'source_is_not'
  | 'ad_form_is'
  | 'ad_form_is_not'
  | 'has_tag'
  | 'not_has_tag'
  | 'field_equals'
  | 'field_contains'
  | 'field_is_empty'
  | 'score_gt'
  | 'score_lt'
  | 'assigned_to'
  | 'unassigned';

export type AssignmentMode = 'specific' | 'round_robin' | 'team' | 'sequence' | 'hierarchy';

/** One stop on a distribution rota: this person takes `count` leads before the turn moves on. */
export interface AssignSequenceEntry {
  userId: string;
  count: number;
}

export type AutomationActionType =
  | 'assign_lead'
  | 'add_tag'
  | 'remove_tag'
  | 'change_stage'
  | 'update_field'
  | 'create_followup'
  | 'send_email'
  | 'enroll_in_sdr_agent'
  | 'enroll_in_sequence';

export type AutomationStepType = 'condition' | 'action' | 'delay';

/** `config`'s shape depends on `type` — see the condition/action/delay config interfaces below. */
export interface AutomationStep {
  /** Absent while a step is still only in the builder — rows are (re)created on save. */
  id?: string;
  type: AutomationStepType;
  sortOrder?: number;
  config: Record<string, unknown>;
}

export interface AutomationConditionConfig {
  conditionType: AutomationConditionType;
  fieldName?: string;
  value?: string;
  /** For the conditions that match against a set — the chosen Meta ad forms, for instance. */
  values?: string[];
}

export interface AutomationActionConfig {
  action: AutomationActionType;
  [key: string]: unknown;
}

export interface AutomationDelayConfig {
  amount: number;
  unit: 'minutes' | 'hours' | 'days';
}

/** Trigger-specific filter — shape depends on `triggerType`, every field optional ("any"). */
export interface AutomationTriggerConfig {
  fromStageId?: string;
  toStageId?: string;
  scoreGt?: number;
  tagId?: string;
  formId?: string;
  days?: number;
  [key: string]: unknown;
}

export interface Automation {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  /** Skips firing while Settings > Business Hours marks the office closed. */
  respectBusinessHours: boolean;
  triggerType: AutomationTriggerType;
  triggerConfig?: AutomationTriggerConfig | null;
  steps: AutomationStep[];
  runCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type AutomationRunStatus = 'success' | 'failed' | 'skipped' | 'waiting';

export interface AutomationRunEntry {
  id: string;
  automationId: string;
  automationName: string;
  leadId: string;
  status: AutomationRunStatus;
  message?: string;
  /** Only set while `status === 'waiting'` — where a paused delay step resumes from. */
  nextStepIndex?: number | null;
  resumeAt?: string | null;
  ranAt: string;
  leadName?: string;
}

// ============================================================================
// Auth
// ============================================================================

export interface AdminSession {
  id: string;
  name: string;
  email: string;
  role: 'Admin';
  avatarUrl?: string;
  /** The panel role's name, e.g. "HR Manager". Absent for a legacy admin with no role assigned. */
  roleName?: string;
  /** Full-access users skip every module check and are the only ones who may manage access. */
  isFullAccess?: boolean;
  /** Module keys this user may open — mirrors what the server enforces. */
  modules?: ModuleKey[];
  /** What this account is (`User.role`) — where they sit in the CRM hierarchy. */
  accountRole?: AccountRole;
  managerId?: string | null;
  /** How much CRM data they may see: everything, their own tree, or only their own. */
  scope?: 'all' | 'tree' | 'own';
  /** Whether they may hand leads to others. The server refuses it otherwise; this hides the buttons. */
  canAssign?: boolean;
  token: string;
}

export type ModuleKey =
  | 'dashboard' | 'crm' | 'tasks' | 'projects' | 'construction' | 'vendors' | 'legal' | 'ops_rules' | 'cameras' | 'vendor_portal' | 'properties' | 'bookings' | 'payments' | 'investments'
  | 'partners' | 'teams' | 'attendance' | 'payouts' | 'incentives' | 'support' | 'notifications'
  | 'reports' | 'settings';

export interface PanelRole {
  id: string;
  name: string;
  description?: string | null;
  isFullAccess: boolean;
  isSystem: boolean;
  modules: ModuleKey[];
  userCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PanelUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: AccountStatus;
  avatarUrl?: string;
  panelRoleId: string | null;
  roleName: string;
  /**
   * What this account *is* (`User.role`), as opposed to `roleName`, which is the panel role
   * deciding which modules they see. Task visibility is scoped by this one.
   */
  accountRole: AccountRole;
  isFullAccess: boolean;
  /** The reporting manager, when they have one. */
  managerId?: string | null;
  managerName?: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Public lead-capture forms (CRM -> Forms). A form is published at /f/<slug>,
// can be embedded on any site, and every submission becomes a Lead.
// ---------------------------------------------------------------------------

export type LeadFormFieldType =
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'phone'
  | 'number'
  | 'date'
  | 'dropdown'
  | 'checkbox'
  | 'gdpr_consent';

export interface LeadFormField {
  /** Absent while a field is still only in the builder — rows are (re)created on save. */
  id?: string;
  type: LeadFormFieldType;
  label: string;
  placeholder?: string | null;
  /** Maps the answer onto a Lead column when it matches one; otherwise kept with the submission. */
  fieldKey: string;
  step: number;
  required: boolean;
  /** Only meaningful for `dropdown`. */
  options?: string[] | null;
  sortOrder?: number;
}

export interface LeadForm {
  id: string;
  name: string;
  slug: string;
  displayTitle?: string | null;
  description?: string | null;
  submitLabel: string;
  thankYouMessage?: string | null;
  redirectUrl?: string | null;
  isMultiStep: boolean;
  isActive: boolean;
  pipelineId?: string | null;
  pipelineStageId?: string | null;
  assignedUserId?: string | null;
  accentColor: string;
  layout: 'card' | 'plain';
  recaptchaEnabled: boolean;
  recaptchaSiteKey?: string | null;
  /** The secret key itself never leaves the server — this only says whether one is on file. */
  hasRecaptchaSecret?: boolean;
  fields?: LeadFormField[];
  submissionCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** Create/update payload. `recaptchaSecretKey` is write-only; leave it out to keep the stored one. */
export interface LeadFormInput {
  name: string;
  slug: string;
  displayTitle?: string;
  description?: string;
  submitLabel: string;
  thankYouMessage?: string;
  redirectUrl?: string;
  isMultiStep: boolean;
  isActive: boolean;
  pipelineId?: string;
  pipelineStageId?: string;
  assignedUserId?: string;
  accentColor: string;
  layout: 'card' | 'plain';
  recaptchaEnabled: boolean;
  recaptchaSiteKey?: string;
  recaptchaSecretKey?: string;
  fields: LeadFormField[];
}

export interface LeadFormSubmission {
  id: string;
  formId: string;
  leadId?: string | null;
  data: Record<string, string | number | boolean | null>;
  ipAddress?: string | null;
  userAgent?: string | null;
  pageUrl?: string | null;
  createdAt: string;
  leadName?: string;
  leadPhone?: string;
  leadEmail?: string;
}

/** What a visitor's browser is allowed to know about a form — no pipeline wiring, no owner. */
export interface PublicLeadForm {
  slug: string;
  displayTitle: string;
  description?: string | null;
  submitLabel: string;
  thankYouMessage?: string | null;
  redirectUrl?: string | null;
  isMultiStep: boolean;
  accentColor: string;
  layout: 'card' | 'plain';
  recaptchaEnabled: boolean;
  recaptchaSiteKey?: string | null;
  fields: LeadFormField[];
}

export interface LeadFormAnalytics {
  total: number;
  leadsCreated: number;
  last7Days: number;
  daily: { date: string; count: number }[];
}

// ---------------------------------------------------------------------------
// AI SDR Agents (CRM > AI SDR Agents). The agent config, its per-lead enrollments, and the
// message thread. Enrollment, cadence guardrails, business-hours gating and handoff are real;
// message composition/delivery is not wired up (no LLM or messaging provider) — see
// `SdrCapabilities` and server/src/services/aiSdrEngine.ts.
// ---------------------------------------------------------------------------

export type SdrGoal = 'qualify_lead' | 'book_meeting';
export type SdrChannel = 'email' | 'sms' | 'whatsapp';
export type SdrEnrollmentStatus = 'active' | 'qualified' | 'handed_off' | 'exhausted' | 'stopped';

export interface AiSdrAgent {
  id: string;
  name: string;
  active: boolean;
  goal: SdrGoal;
  channel: SdrChannel;
  persona?: string | null;
  offerContext?: string | null;
  maxFollowUps: number;
  minHoursBetweenFollowUps: number;
  respectBusinessHours: boolean;
  handoffUserId?: string | null;
  meetingType?: string | null;
  enrollmentCount?: number;
  activeEnrollmentCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type AiSdrAgentInput = Omit<AiSdrAgent, 'id' | 'createdAt' | 'updatedAt' | 'enrollmentCount' | 'activeEnrollmentCount'>;

/** Why a due follow-up can or can't go out right now — computed server-side from the guardrails. */
export interface SdrEligibility {
  isDue: boolean;
  reason: string;
  followUpsRemaining: number;
}

export interface AiSdrEnrollment {
  id: string;
  agentId: string;
  leadId: string;
  status: SdrEnrollmentStatus;
  followUpsSent: number;
  lastMessageAt?: string | null;
  nextEligibleAt?: string | null;
  handedOffAt?: string | null;
  handedOffToUserId?: string | null;
  stoppedReason?: string | null;
  leadName: string;
  leadPhone?: string | null;
  leadEmail?: string | null;
  messageCount: number;
  eligibility: SdrEligibility;
  createdAt: string;
}

export interface AiSdrMessage {
  id: string;
  enrollmentId: string;
  direction: 'outbound' | 'inbound';
  channel: SdrChannel;
  body: string;
  author: 'human' | 'agent';
  status: 'logged' | 'sent' | 'failed';
  deliveryNote?: string | null;
  createdAt: string;
}

export interface SdrCapabilities {
  aiProviderConfigured: boolean;
  messagingProviderConfigured: boolean;
  note: string;
}

// ---------------------------------------------------------------------------
// Email templates + email sequences
// ---------------------------------------------------------------------------

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
}

/** Only `active` sends. `draft` and `paused` hold their enrollments where they are. */
export type EmailSequenceStatus = 'draft' | 'active' | 'paused';

export interface EmailSequenceStep {
  id?: string;
  delayDays: number;
  delayHours: number;
  subject: string;
  body: string;
}

export interface EmailSequence {
  id: string;
  name: string;
  description?: string;
  status: EmailSequenceStatus;
  stopOnReply: boolean;
  stopOnWon: boolean;
  stepCount: number;
  activeEnrollments: number;
  completedEnrollments: number;
  stoppedEnrollments: number;
  createdAt: string;
  /** Present on the detail response only. */
  steps?: EmailSequenceStep[];
}

export interface EmailSequenceInput {
  name: string;
  description: string;
  status: EmailSequenceStatus;
  stopOnReply: boolean;
  stopOnWon: boolean;
  steps: EmailSequenceStep[];
}

export type EmailEnrollmentStatus = 'active' | 'completed' | 'stopped';

export interface EmailSequenceEnrollment {
  id: string;
  leadId: string;
  leadName: string;
  leadEmail?: string;
  leadStatus: LeadStatus;
  status: EmailEnrollmentStatus;
  currentStep: number;
  sendCount: number;
  nextSendAt?: string;
  stoppedReason?: string;
  createdAt: string;
}

export interface EmailSequenceSend {
  id: string;
  stepIndex: number;
  subject: string;
  body: string;
  status: 'sent' | 'failed';
  message?: string;
  sentAt: string;
}

// ---------------------------------------------------------------------------
// Telephony — call history, click-to-call, extension status
// ---------------------------------------------------------------------------

export type CallDirection = 'incoming' | 'outgoing';
/** `routing` is a call we have handed to an agent but whose log has not come back yet. */
export type CallStatus = 'routing' | 'answered' | 'missed' | 'off_hour' | 'no_answer' | 'failed';

export interface CallLog {
  id: string;
  uniqueId?: string;
  requestId: string;
  direction: CallDirection;
  status: CallStatus;
  callerNumber: string;
  agentNumber?: string;
  virtualNumber?: string;
  leadId?: string;
  leadName?: string;
  agentUserId?: string;
  agentName?: string;
  durationSeconds: number;
  recordingUrl?: string;
  recordingDurationSeconds: number;
  dtmf?: string;
  feedback?: string;
  startedAt: string;
  endedAt?: string;
  /** Detail response only — the provider's own body, kept verbatim. */
  rawPayload?: Record<string, unknown>;
}

export interface TelephonySettings {
  provider: string;
  enabled: boolean;
  baseUrl: string;
  /** DeepCall's `user_id`. */
  accountId: string;
  /** The DeepCall call flow (with a Click To Call module) click-to-call runs through. */
  clickToCallFlowId: string;
  /** The token itself is never sent to the browser. */
  hasApiToken: boolean;
  virtualNumber: string;
  callLogWebhookUrl: string;
}

export interface TelephonySettingsPatch {
  enabled?: boolean;
  baseUrl?: string;
  accountId?: string;
  clickToCallFlowId?: string;
  apiToken?: string;
  virtualNumber?: string;
}

/** One request the provider made to us, kept verbatim. Read during a live test call. */
export interface TelephonyEvent {
  id: string;
  kind: 'call_log' | 'click_to_call';
  outcome: 'ok' | 'rejected' | 'failed';
  request?: {
    method?: string;
    path?: string;
    tokenTail?: string;
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
    contentType?: string;
  };
  response?: Record<string, unknown>;
  errorMessage?: string;
  callLogId?: string;
  receivedAt: string;
}

/** One row of the extension mapping screen — a staff member and the extension they answer on. */
export interface AgentExtensionRow {
  userId: string;
  name: string;
  phone: string;
  role: string;
  extension: string;
  callCount: number;
}

/** An extension the provider has logged calls against that nobody in the CRM owns yet. */
export interface UnmappedExtension {
  agentNumber: string;
  callCount: number;
}

export interface TelephonyConnectionTest {
  ok: boolean;
  checks: { label: string; ok: boolean; detail: string }[];
  httpStatus?: number;
  providerResponse?: unknown;
}

// ---------------------------------------------------------------------------
// Email delivery
// ---------------------------------------------------------------------------

export interface EmailSettings {
  provider: string;
  enabled: boolean;
  /** The key itself is never sent to the browser. */
  hasApiKey: boolean;
  fromName: string;
  fromEmail: string;
  replyToEmail: string;
  footerText: string;
  inboundWebhookUrl: string;
}

export interface EmailSettingsPatch {
  enabled?: boolean;
  apiKey?: string;
  fromName?: string;
  fromEmail?: string;
  replyToEmail?: string;
  footerText?: string;
}

export interface EmailSuppression {
  id: string;
  email: string;
  /** unsubscribed | bounced | complained | manual */
  reason: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// WhatsApp conversations
// ---------------------------------------------------------------------------

export interface WhatsAppAccount {
  id: string;
  label: string;
  displayPhone: string;
  phoneNumberId: string;
  wabaId?: string;
  /** meta = Meta Cloud API; pinbot = WABA Partners API. */
  provider: 'meta' | 'pinbot';
  active: boolean;
  /** connected | disconnected | error */
  status: string;
  lastError?: string;
  createLeadOnInbound: boolean;
  /** The credentials themselves are never sent to the browser. */
  hasAccessToken: boolean;
  hasAppSecret: boolean;
  verifyToken: string;
  webhookUrl: string;
  conversationCount: number;
  unreadCount: number;
  lastMessageAt?: string;
}

export interface WhatsAppConversation {
  id: string;
  accountId: string;
  contactPhone: string;
  contactName?: string;
  leadId?: string;
  leadName?: string;
  leadStatus?: LeadStatus;
  assignedUserId?: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  unreadCount: number;
  intervened: boolean;
  /** Minutes left in WhatsApp's 24-hour reply window; 0 once closed. */
  windowMinutesLeft: number;
  canReply: boolean;
}

export interface WhatsAppMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  type: string;
  body: string;
  mediaUrl?: string;
  /** queued | sent | delivered | read | failed */
  status: string;
  error?: string;
  sentByUserId?: string;
  sentAt: string;
}

export interface WhatsAppAccountInput {
  label: string;
  displayPhone: string;
  phoneNumberId: string;
  wabaId?: string;
  provider?: 'meta' | 'pinbot';
  accessToken?: string;
  appSecret?: string;
  /** Your own token, or `regenerateVerifyToken` for a random one. Must match what Meta is given. */
  verifyToken?: string;
  regenerateVerifyToken?: boolean;
  active?: boolean;
  createLeadOnInbound?: boolean;
}

// ---------------------------------------------------------------------------
// Custom lead fields + Meta form mapping
// ---------------------------------------------------------------------------

export interface LeadCustomField {
  id: string;
  /** Stable identifier used in mappings — never changes once created. */
  key: string;
  label: string;
  /** text | number | date | dropdown | checkbox */
  type: string;
  options: string[];
  sortOrder: number;
}

export interface MappingTargets {
  builtIn: { value: string; label: string }[];
  custom: LeadCustomField[];
}

export interface MetaForm {
  id: string;
  name: string;
  /** How many of this form's questions already have a target. */
  mappedCount: number;
}

export interface MetaFormQuestion {
  /** What arrives in Meta's `field_data`. */
  name: string;
  label: string;
  type: string;
  options: string[];
}

/** Question name -> `firstName` | `custom:<key>` | `ignore`. */
export type MetaFormMapping = Record<string, string>;

/** Answers stored against a lead for fields the CRM does not ship with. */
export interface LeadCustomValue {
  key: string;
  label: string;
  type: string;
  value: string;
}

// ---------------------------------------------------------------------------
// Broadcasting an approved template to a list, through the linked Cloud API number.
// Reading and replying to the threads it starts is CRM → Conversations.
// ---------------------------------------------------------------------------

export interface ApprovedWhatsAppTemplate {
  name: string;
  language: string;
  category: string;
  /** The approved BODY text, with its {{1}} placeholders still in it. */
  body: string;
  variableCount: number;
  /** A file header (image, video or document): a public https link to it is given with every send. */
  headerFormat?: 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  /** Set when the template needs something this screen cannot supply, such as a header variable. */
  unsupported?: string;
}

export interface WhatsAppBroadcastSource {
  account: { id: string; label: string; displayPhone: string };
  templates: ApprovedWhatsAppTemplate[];
  /** Tokens allowed inside a variable, resolved per recipient. */
  tokens: string[];
}

/** The filters that decide who a broadcast reaches — the same set the Leads table offers. */
export interface BroadcastLeadFilter {
  search?: string;
  status?: string;
  priority?: string;
  source?: string;
  pipelineId?: string;
  stageId?: string;
  assignedUserId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface BroadcastAudience {
  count: number;
  overLimit: boolean;
  limit: number;
  sample: { phone: string; name?: string }[];
}

export interface WhatsAppTemplateSendRow {
  id: string;
  templateName: string;
  destination: string;
  body?: string;
  status: 'sent' | 'failed';
  errorMessage?: string;
  sentAt: string;
}

export interface WhatsAppSendResult {
  sent: number;
  failed: number;
  results: { phone: string; ok: boolean; message: string }[];
}

// ---------------------------------------------------------------------------
// Leave and payroll. Attendance says who turned up; leave says why somebody did
// not, and payroll turns both into money.
// ---------------------------------------------------------------------------

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveType {
  id: string;
  name: string;
  /** Short form on the calendar and the payslip, e.g. "CL". */
  code: string;
  annualQuota: number;
  isPaid: boolean;
  carryForward: boolean;
  active: boolean;
}

export interface LeaveBalanceRow {
  leaveTypeId: string;
  name: string;
  code: string;
  isPaid: boolean;
  allocated: number;
  used: number;
  /** Not yet decided, so not yet spent — but worth seeing before approving more. */
  pending: number;
  remaining: number;
}

export interface LeaveRequest {
  id: string;
  userId: string;
  userName: string;
  leaveTypeId: string;
  typeName: string;
  typeCode: string;
  isPaid: boolean;
  startDate: string;
  endDate: string;
  days: number;
  halfDay: boolean;
  reason: string;
  status: LeaveStatus;
  decisionNote?: string;
  decidedAt?: string;
  createdAt: string;
}

export interface SalaryStructureRow {
  userId: string;
  name: string;
  role: string;
  hasStructure: boolean;
  basic: number;
  hra: number;
  otherAllowance: number;
  pfDeduction: number;
  professionalTax: number;
  otherDeduction: number;
  grossMonthly: number;
  netMonthly: number;
}

export type PayrollRunStatus = 'draft' | 'finalised' | 'paid';

export interface PayrollRun {
  id: string;
  month: number;
  year: number;
  status: PayrollRunStatus;
  notes?: string;
  employees: number;
  grossTotal: number;
  netTotal: number;
  finalisedAt?: string;
  paidAt?: string;
  createdAt: string;
}

export interface Payslip {
  id: string;
  userId: string;
  name: string;
  phone: string;
  workingDays: number;
  presentDays: number;
  paidLeaveDays: number;
  /** Days with neither attendance nor paid leave behind them. */
  lopDays: number;
  basic: number;
  hra: number;
  otherAllowance: number;
  grossEarnings: number;
  pfDeduction: number;
  professionalTax: number;
  otherDeduction: number;
  lopDeduction: number;
  totalDeductions: number;
  netPay: number;
}

export interface PayrollRunDetail extends PayrollRun {
  payslips: Payslip[];
}

// ---------------------------------------------------------------------------
// Task management (server/src/routes/tasks.ts)
// ---------------------------------------------------------------------------

export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * How wide the signed-in user's view of tasks is, as the server resolved it. The panel never
 * decides this for itself — it renders whatever `/tasks/assignable` reports, so the filters
 * and pickers on screen always match what the API would actually accept.
 */
export type TaskScopeKind = 'all' | 'team' | 'own';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  /** Past its due date and still open. Computed server-side so every screen agrees. */
  isOverdue: boolean;
  assigneeId: string;
  assigneeName: string;
  assigneeRole: RoleId | null;
  assigneeAvatarUrl?: string;
  createdById: string;
  createdByName: string;
  commentCount: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskComment {
  id: string;
  taskId: string;
  body: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl?: string;
  createdAt: string;
}

/** One person the signed-in user is allowed to assign work to. */
export interface TaskAssignee {
  id: string;
  name: string;
  role: RoleId;
  avatarUrl?: string;
  teamId: string | null;
}

// ---------------------------------------------------------------------------
// Plot map (server/src/routes/admin/projectMaps.ts)
// ---------------------------------------------------------------------------

/** The four states a plot can be in — derived server-side, never stored on the map. */
export type PlotMapStatus = 'available' | 'onHold' | 'booked' | 'soldOut';

/** A point as [x, y], each 0..1 of the layout image's width and height. */
export type PlotMapPoint = [number, number];

export interface PlotMapPlot {
  shapeId: string;
  /** Null while an outline is drawn but not yet matched to a plot. */
  unitId: string | null;
  points: PlotMapPoint[];
  source: 'manual' | 'detected';
  confirmed: boolean;
  status: PlotMapStatus | null;
  /** The fuller life-cycle stage, derived from the hold, booking and legal file. */
  stage: PlotStage | null;
  label: string;
  plotNumber: string | null;
  area: string | null;
  areaValue: number | null;
  facing: string | null;
  roadWidth: string | null;
  isCorner: boolean;
  price: number;
  holdUntil: string | null;
}

export type PlotStage = 'available' | 'hold' | 'token' | 'booked' | 'agreement' | 'registered' | 'possession';

export interface PlotMapCounts {
  stages: Record<PlotStage, number>;
  available: number;
  onHold: number;
  booked: number;
  soldOut: number;
  unmapped: number;
  total: number;
  value: { available: number; onHold: number; booked: number; soldOut: number; total: number };
}

export interface PlotMapMeta {
  id: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  status: 'draft' | 'live';
  version: number;
  publicEnabled: boolean;
  publicToken: string | null;
  updatedAt: string;
}

export interface PlotMapUnitOption {
  id: string;
  propertyNumber: string;
  area: string;
}

export interface PlotMapBundle {
  project: { id: string; projectName: string; projectLocation: string };
  map: PlotMapMeta | null;
  plots: PlotMapPlot[];
  counts: PlotMapCounts | null;
  unmappedUnits: PlotMapUnitOption[];
}

/** What a customer opening a shared link is allowed to see — no price, no buyer, no holds. */
export interface PublicPlotMapPlot {
  id: string;
  points: PlotMapPoint[];
  label: string;
  area: string | null;
  facing: string | null;
  roadWidth: string | null;
  isCorner: boolean;
  available: boolean;
}

export interface PublicPlotMap {
  project: { name: string; location: string };
  image: { url: string; width: number; height: number };
  plots: PublicPlotMapPlot[];
  summary: { available: number; total: number };
}

/**
 * A company holiday. One row per occasion with an inclusive date range, so Diwali is a single
 * three-day holiday rather than three rows. `upcoming` is decided by the server against IST,
 * because the browser's own clock is not the office's.
 */
export interface Holiday {
  id: string;
  name: string;
  /** national | festival | religious | company | optional — free text, not an enum. */
  kind: string;
  /** `YYYY-MM-DD`, both ends inclusive. */
  startDate: string;
  endDate: string;
  /** Calendar days covered, both ends counted. */
  days: number;
  description: string | null;
  upcoming: boolean;
}

export type WhatsAppTemplateButton =
  | { type: 'QUICK_REPLY'; text: string }
  | { type: 'URL'; text: string; url: string; example?: string }
  | { type: 'PHONE_NUMBER'; text: string; phone: string };

/** A template as Meta holds it — any approval state, not just the sendable ones. */
export interface ManagedWhatsAppTemplate {
  name: string;
  language: string;
  category: string;
  /** APPROVED | PENDING | REJECTED | PAUSED | DISABLED, as Meta reports it. */
  status: string;
  rejectedReason?: string;
  header?: string;
  /** TEXT | IMAGE | VIDEO | DOCUMENT */
  headerFormat?: string;
  body: string;
  footer?: string;
  buttons: WhatsAppTemplateButton[];
}

export type WhatsAppHeaderInput =
  | { format: 'NONE' }
  | { format: 'TEXT'; text: string }
  | { format: 'IMAGE' | 'VIDEO' | 'DOCUMENT'; sampleUrl: string };

export interface NewWhatsAppTemplate {
  name: string;
  category: 'MARKETING' | 'UTILITY';
  language: string;
  header: WhatsAppHeaderInput;
  body: string;
  footer?: string;
  buttons: WhatsAppTemplateButton[];
  samples: string[];
}

// ---------------------------------------------------------------------------
// WhatsApp drip campaigns — server/src/routes/whatsappDrips.ts
// ---------------------------------------------------------------------------

export type WhatsAppDripStatus = 'draft' | 'active' | 'paused';

export interface WhatsAppDripStep {
  id?: string;
  delayDays: number;
  delayHours: number;
  templateName: string;
  language: string;
  /** One value per {{n}}; may carry {first_name}, {last_name}, {full_name}. */
  params: string[];
  headerMediaUrl?: string;
}

export interface WhatsAppDrip {
  id: string;
  name: string;
  description?: string;
  status: WhatsAppDripStatus;
  stopOnReply: boolean;
  stopOnWon: boolean;
  stepCount: number;
  activeEnrollments: number;
  completedEnrollments: number;
  stoppedEnrollments: number;
  createdAt: string;
  /** Present on the detail response only. */
  steps?: WhatsAppDripStep[];
}

export interface WhatsAppDripInput {
  name: string;
  description: string;
  status: WhatsAppDripStatus;
  stopOnReply: boolean;
  stopOnWon: boolean;
  steps: WhatsAppDripStep[];
}

export interface WhatsAppDripEnrollment {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  leadStatus: string;
  status: 'active' | 'completed' | 'stopped';
  currentStep: number;
  sendCount: number;
  nextSendAt?: string;
  stoppedReason?: string;
  createdAt: string;
}

export interface WhatsAppDripSend {
  id: string;
  stepIndex: number;
  templateName: string;
  body: string;
  status: 'sent' | 'failed';
  message?: string;
  sentAt: string;
}

// ---------------------------------------------------------------------------
// WhatsApp auto-reply bots — server/src/routes/whatsappBots.ts
// ---------------------------------------------------------------------------

export interface WhatsAppBotButton {
  title: string;
  type: 'reply' | 'url';
  url?: string;
  /** Key of the message a reply option leads to. */
  nextKey?: string;
}

export interface WhatsAppBotNode {
  key: string;
  label: string;
  body: string;
  headerImageUrl?: string;
  buttons: WhatsAppBotButton[];
  /** Adds a note on the lead that this person is waiting for the team. */
  handoff: boolean;
}

export interface WhatsAppBot {
  id: string;
  name: string;
  status: WhatsAppDripStatus;
  triggerType: 'any' | 'keywords';
  keywords: string[];
  cooldownHours: number;
  startKey: string;
  nodeCount: number;
  createdAt: string;
  /** Present on the detail response only. */
  nodes?: WhatsAppBotNode[];
}

export interface WhatsAppBotInput {
  name: string;
  status: WhatsAppDripStatus;
  triggerType: 'any' | 'keywords';
  keywords: string[];
  cooldownHours: number;
  startKey: string;
  nodes: WhatsAppBotNode[];
}
