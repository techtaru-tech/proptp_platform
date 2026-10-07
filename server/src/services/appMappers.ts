import type {
  AttendanceRecord,
  BankAccount,
  Booking,
  EarningEntry,
  LeaveRequest,
  LeaveType,
  Notification,
  NotificationRecipient,
  PayrollRun,
  Payslip,
  PlotFacing,
  Project,
  ProjectFile,
  PropertyUnit,
  SalaryStructure,
  User,
  WorkLocation,
} from '@prisma/client';
import {
  aggregateProject,
  commissionRateForUnit,
  isHoldActive,
  maskPhone,
  propertyStatus,
  type BusinessSummary,
  type DownlineMember,
  type EarningsSummary,
} from './derive';
import type { LeaveBalanceRow } from './leave';

/**
 * Serializers for the Flutter app surface (/api/v1/app/*), matching
 * API_DOCUMENTATION.md exactly: snake_case keys, ISO-8601 date strings, money as
 * whole-rupee integers, string enums sent verbatim.
 *
 * The admin panel is served by a DIFFERENT serializer set (see routes/admin/*), because
 * it is built against the real Laravel column names and numeric status codes. Both read
 * the same rows; neither transforms the other's output.
 */

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const numberFormat = new Intl.NumberFormat('en-IN');

/** "1,200 sq.ft" from a varchar area column. */
export function areaLabel(area: string, measurement = 'sq.ft'): string {
  const n = Number(area);
  return Number.isFinite(n) && n > 0 ? `${numberFormat.format(n)} ${measurement}` : area || '';
}

// ---------------------------------------------------------------------------
// Identity (§7 UserModel)
// ---------------------------------------------------------------------------

export function appUser(
  user: User,
  extras: { reportingLeaderName?: string | null; sponsorName?: string | null; sponsorCode?: string | null } = {}
) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    partner_code: user.partnerCode,
    email: user.email,
    phone: user.phone,
    designation: user.designation,
    area: user.area,
    reporting_leader: extras.reportingLeaderName ?? null,
    city: user.city,
    pincode: user.pincode,
    sponsor_name: extras.sponsorName ?? null,
    sponsor_code: extras.sponsorCode ?? null,
    joined_on: iso(user.joinedOn),
  };
}

// ---------------------------------------------------------------------------
// Attendance (§2, §7 WorkLocation / AttendanceRecord)
// ---------------------------------------------------------------------------

export function appWorkLocation(location: WorkLocation) {
  return {
    id: location.id,
    name: location.name,
    area: location.area,
    latitude: location.latitude,
    longitude: location.longitude,
    radius: location.radius,
  };
}

/** `synced` is always true here: a row that reached the database IS synced. */
export function appAttendance(record: AttendanceRecord) {
  return {
    date: iso(record.date),
    check_in_at: iso(record.checkInAt),
    check_out_at: iso(record.checkOutAt),
    check_in_location: record.checkInLocation,
    check_out_location: record.checkOutLocation,
    is_late: record.isLate,
    is_absent: record.isAbsent,
    synced: true,
    synced_at: iso(record.updatedAt),
    marked_by: record.markedBy ?? '',
    device: record.device ?? '',
  };
}

// ---------------------------------------------------------------------------
// Projects & properties (§3, §7 Project / Property / ConstructionUpdate)
// ---------------------------------------------------------------------------

type UnitWithFacings = PropertyUnit & { facings?: PlotFacing[]; holds?: { status: number; holdEnd: Date }[] };

/** The app has one `facing` string; the database has a free-form key/value repeater. */
export function facingOf(unit: UnitWithFacings): string {
  const match = unit.facings?.find((f) => f.key.trim().toLowerCase() === 'facing');
  return match?.value ?? '';
}

export function appProperty(unit: UnitWithFacings, projectName: string) {
  const hasActiveHold = (unit.holds ?? []).some((h) => isHoldActive(h));
  return {
    id: unit.id,
    project_id: unit.projectId,
    project_name: projectName,
    plot_number: unit.propertyNumber,
    area_sqft: Number(unit.propertyArea) || 0,
    facing: facingOf(unit),
    status: propertyStatus(unit, hasActiveHold),
    type: unit.isCorner ? 'corner' : 'standard',
    base_price: unit.totalInvestmentAmount,
    charges: unit.charges,
    gst_and_registration: unit.gstAndRegistration,
    token_amount: unit.tokenAmount,
    commission_rate: commissionRateForUnit(unit),
    plot_image_url: unit.thumbnail,
  };
}

/** base + charges + GST/registration — what the booking screen totals up (§4.1 total_amount). */
export function unitGrandTotal(unit: Pick<PropertyUnit, 'totalInvestmentAmount' | 'charges' | 'gstAndRegistration'>): number {
  return unit.totalInvestmentAmount + unit.charges + unit.gstAndRegistration;
}

export function appConstructionUpdate(file: ProjectFile) {
  return {
    id: file.id,
    captured_on: iso(file.capturedOn ?? file.createdAt),
    media_url: file.file,
    is_video: file.isVideo,
    caption: file.caption,
  };
}

type ProjectWithUnits = Project & { units: UnitWithFacings[]; files?: ProjectFile[] };

/** §3.1 — the light list shape. Omits units, amenities, gallery and construction updates. */
export function appProjectSummary(project: ProjectWithUnits) {
  const agg = aggregateProject(project, project.units);
  return {
    id: project.id,
    name: project.projectName,
    location: project.projectLocation,
    category: project.category,
    status: agg.appStatus,
    plot_size_range: agg.plotSizeRange,
    starting_price: agg.startingPrice,
    commission_rate: agg.commissionRate,
    hero_image: project.banner ?? project.thumbnail,
    property_count: agg.propertyCount,
    available_count: agg.availableCount,
    hold_reason: project.holdReason,
  };
}

/** §3.2 — the full detail shape, including every plot in the project. */
export function appProjectDetail(project: ProjectWithUnits, amenityNames: string[]) {
  const agg = aggregateProject(project, project.units);
  const construction = (project.files ?? []).filter((f) => f.kind === 'construction');
  return {
    id: project.id,
    name: project.projectName,
    location: project.projectLocation,
    category: project.category,
    status: agg.appStatus,
    plot_size_range: agg.plotSizeRange,
    starting_price: agg.startingPrice,
    commission_rate: agg.commissionRate,
    hold_reason: project.holdReason,
    hero_image: project.banner ?? project.thumbnail,
    gallery: [project.banner, project.thumbnail, project.map, ...project.gallery].filter(Boolean),
    layout_plan_url: project.layoutPlanUrl,
    latitude: project.latitude,
    longitude: project.longitude,
    amenities: amenityNames,
    plot_sizes: agg.plotSizes.map((s) => ({
      area_sqft: s.areaSqft,
      available_plots: s.availablePlots,
      starting_price: s.startingPrice,
    })),
    construction_updates: construction
      .slice()
      .sort((a, b) => (b.capturedOn ?? b.createdAt).getTime() - (a.capturedOn ?? a.createdAt).getTime())
      .map(appConstructionUpdate),
    properties: project.units.map((u) => appProperty(u, project.projectName)),
  };
}

// ---------------------------------------------------------------------------
// Bookings (§4, §7 Booking)
// ---------------------------------------------------------------------------

type BookingWithContext = Booking & {
  unit: (PropertyUnit & { project: Pick<Project, 'projectName'> }) | null;
};

export function appBooking(
  booking: BookingWithContext,
  extras: { paidAmount: number; byTeamMember?: string | null }
) {
  const unit = booking.unit;
  return {
    id: booking.id,
    reference: booking.reference,
    customer_name: booking.bookingName,
    project_name: unit?.project.projectName ?? '',
    plot_number: unit?.propertyNumber ?? '',
    plot_size: unit ? areaLabel(unit.propertyArea) : '',
    status: booking.status,
    mode: booking.paymentMode,
    paid_amount: extras.paidAmount,
    total_amount: unit ? unitGrandTotal(unit) : 0,
    commission: booking.commission,
    booked_on: iso(booking.createdAt),
    by_team_member: extras.byTeamMember ?? null,
  };
}

// ---------------------------------------------------------------------------
// Partner money (§5, §7 BusinessSummary / EarningsSummary)
// ---------------------------------------------------------------------------

export function appBusinessSummary(summary: BusinessSummary) {
  return {
    total_earnings: summary.totalEarnings,
    total_deposits: summary.totalDeposits,
    payout_released: summary.payoutReleased,
    net_payable: summary.netPayable,
    bookings: summary.bookings,
  };
}

export function appEarningsSummary(summary: EarningsSummary) {
  return {
    financial_year: summary.financialYear,
    total_earned: summary.totalEarned,
    released: summary.released,
    in_process: summary.inProcess,
    pending: summary.pending,
    by_kind: summary.byKind,
    recent: summary.recent.map((e) => ({
      id: e.id,
      title: e.title,
      kind: e.kind,
      amount: e.amount,
      credited_on: iso(e.creditedOn),
    })),
  };
}

export function appEarningEntry(entry: EarningEntry) {
  return {
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    amount: entry.amount,
    credited_on: iso(entry.creditedOn),
  };
}

/** §5.3 — phone numbers are masked here, server-side, never left to the client to hide. */
export function appTeamMember(member: DownlineMember, showFullPhone: boolean) {
  return {
    id: member.user.id,
    name: member.user.name,
    phone: showFullPhone ? member.user.phone : maskPhone(member.user.phone),
    role: member.user.role,
    activity: member.activity,
    bookings: member.bookings,
    joined_on: iso(member.user.joinedOn),
    level: member.level,
  };
}

/** §5.4 — the FULL account number: the app masks it for display so a partner can
 *  confirm which account is which when adding a new one. */
export function appBankAccount(account: BankAccount) {
  return {
    id: account.id,
    bank_name: account.bankName,
    account_number: account.accountNumber,
    holder_name: account.holderName,
    ifsc: account.ifsc,
    account_type: account.accountType,
    state: account.state,
    is_primary: account.isPrimary,
  };
}

// ---------------------------------------------------------------------------
// Notifications (§6, §7 NotificationItem)
// ---------------------------------------------------------------------------

export function appNotification(row: NotificationRecipient & { notification: Notification }) {
  return {
    id: row.notification.id,
    type: row.notification.type,
    title: row.notification.title,
    body: row.notification.body,
    created_at: iso(row.notification.createdAt),
    read: row.read,
  };
}

// ---------------------------------------------------------------------------
// Leave (not in the API doc — built for the panel first)
// ---------------------------------------------------------------------------

/** A date column, as a plain day. No timezone to get wrong: leave is booked in days. */
const day = (d: Date) => d.toISOString().slice(0, 10);

type LeaveRequestWithType = LeaveRequest & {
  type: Pick<LeaveType, 'name' | 'code' | 'isPaid'>;
};

export function appLeaveRequest(request: LeaveRequestWithType) {
  return {
    id: request.id,
    leave_type_id: request.leaveTypeId,
    type_name: request.type.name,
    type_code: request.type.code,
    is_paid: request.type.isPaid,
    start_date: day(request.startDate),
    end_date: day(request.endDate),
    days: request.days,
    half_day: request.halfDay,
    reason: request.reason,
    status: request.status,
    decision_note: request.decisionNote,
    decided_at: iso(request.decidedAt),
    applied_at: iso(request.createdAt),
    /// Only a request nobody has decided yet can still be withdrawn. Derived rather than
    /// stored, so it cannot go stale the moment a manager acts.
    can_cancel: request.status === 'pending',
  };
}

export function appLeaveType(type: LeaveType) {
  return {
    id: type.id,
    name: type.name,
    code: type.code,
    is_paid: type.isPaid,
    annual_quota: type.annualQuota,
  };
}

export function appLeaveBalance(balance: LeaveBalanceRow) {
  return {
    leave_type_id: balance.leaveTypeId,
    name: balance.name,
    code: balance.code,
    is_paid: balance.isPaid,
    allocated: balance.allocated,
    used: balance.used,
    pending: balance.pending,
    remaining: balance.remaining,
  };
}

// ---------------------------------------------------------------------------
// Salary & payslips (not in the API doc — payroll was built for the panel first)
//
// One rule runs through all of this: a DRAFT payroll run is invisible here. The schema calls
// a draft "figures calculated and editable; nothing is owed yet", and a number somebody reads
// on their phone and then watches change is worse than no number at all. Only `finalised` and
// `paid` runs reach the app.
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month);
}

/** What this person is paid today. Null when payroll has not set them up yet. */
export function appSalaryStructure(structure: SalaryStructure | null) {
  if (!structure) return null;
  const gross = structure.basic + structure.hra + structure.otherAllowance;
  const deductions = structure.pfDeduction + structure.professionalTax + structure.otherDeduction;
  return {
    basic: structure.basic,
    hra: structure.hra,
    other_allowance: structure.otherAllowance,
    gross_monthly: gross,
    pf_deduction: structure.pfDeduction,
    professional_tax: structure.professionalTax,
    other_deduction: structure.otherDeduction,
    total_deductions: deductions,
    net_monthly: gross - deductions,
    effective_from: iso(structure.effectiveFrom),
  };
}

type PayslipWithRun = Payslip & {
  run: Pick<PayrollRun, 'id' | 'month' | 'year' | 'status' | 'paidAt' | 'finalisedAt'>;
};

/** One row of the My Salary list, and of the Payslips list — month, net, and whether it is paid. */
export function appPayslipSummary(payslip: PayslipWithRun) {
  return {
    id: payslip.id,
    month: payslip.run.month,
    month_name: monthName(payslip.run.month),
    year: payslip.run.year,
    gross_earnings: payslip.grossEarnings,
    total_deductions: payslip.totalDeductions,
    net_pay: payslip.netPay,
    /// `finalised` means the figure is locked but the money has not gone out yet.
    status: payslip.run.status,
    paid_on: iso(payslip.run.paidAt),
    finalised_on: iso(payslip.run.finalisedAt),
  };
}

/**
 * The slip itself.
 *
 * Earnings and deductions come through as labelled lines rather than loose fields, so the app
 * renders a slip by looping instead of by hard-coding six component names — and a seventh
 * component added later shows up without an app release.
 */
export function appPayslipDetail(payslip: PayslipWithRun) {
  const earnings = [
    { label: 'Basic', amount: payslip.basic },
    { label: 'HRA', amount: payslip.hra },
    { label: 'Other Allowance', amount: payslip.otherAllowance },
  ].filter((line) => line.amount !== 0);

  const deductions = [
    { label: 'Provident Fund', amount: payslip.pfDeduction },
    { label: 'Professional Tax', amount: payslip.professionalTax },
    { label: 'Other Deduction', amount: payslip.otherDeduction },
    { label: 'Loss of Pay', amount: payslip.lopDeduction },
  ].filter((line) => line.amount !== 0);

  return {
    ...appPayslipSummary(payslip),
    period: `${monthName(payslip.run.month)} ${payslip.run.year}`,
    attendance: {
      working_days: payslip.workingDays,
      present_days: payslip.presentDays,
      paid_leave_days: payslip.paidLeaveDays,
      /// Days absent with no approved paid leave behind them — what `lop_deduction` costs.
      lop_days: payslip.lopDays,
    },
    earnings,
    deductions,
    generated_on: iso(payslip.createdAt),
  };
}
