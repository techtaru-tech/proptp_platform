import type {
  AttendanceRecord,
  BankAccount,
  Booking,
  EarningEntry,
  Notification,
  NotificationRecipient,
  PlotFacing,
  Project,
  ProjectFile,
  PropertyUnit,
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
