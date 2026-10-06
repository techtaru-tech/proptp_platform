import type {
  AttendanceRecord,
  AuditEntry,
  BankAccount,
  Booking,
  BookingStatus,
  EarningEntry,
  FundRequest,
  IncentiveRequest,
  Investment,
  Notification,
  PaymentMode,
  PayoutRequest,
  PayoutStatus,
  PayoutStatusEvent,
  PlotFacing,
  PlotHold,
  Project,
  ProjectFile,
  PropertyUnit,
  SupportTicket,
  Task,
  TaskComment,
  TicketMessage,
  User,
  UserRole,
} from '@prisma/client';

/**
 * Serializers for the admin surface (/api/*). The admin panel is built against the real
 * Laravel column names and its numeric status codes, so this layer converts the shared
 * tables back into exactly the shapes `src/types/index.ts` already declares — no frontend
 * type had to be reshaped to accommodate the app's flatter contract.
 *
 * The app surface has its own serializers (services/appMappers.ts). Both read the same
 * rows; neither is derived from the other.
 */

// ---------------------------------------------------------------------------
// Enum bridges — the DB stores names, the admin panel speaks the real numeric codes.
// ---------------------------------------------------------------------------

/** 4 is new: the real system has no Team Leader, so the number is ours and appended, never reused. */
export const ROLE_ID: Record<UserRole, 0 | 1 | 2 | 3 | 4 | 5> = { agent: 0, admin: 1, employee: 2, leader: 3, team_leader: 4, vendor: 5 };
export const ROLE_BY_ID: Record<number, UserRole> = { 0: 'agent', 1: 'admin', 2: 'employee', 3: 'leader', 4: 'team_leader', 5: 'vendor' };

/** Real `bookings.paymant_mode` (sic): 0=Bank Transfer, 1=Cash, 2=Cheque, 3=Other. 4=Online is new. */
export const PAYMENT_MODE_ID: Record<PaymentMode, 0 | 1 | 2 | 3 | 4> = {
  bankTransfer: 0,
  cash: 1,
  cheque: 2,
  other: 3,
  online: 4,
};
export const PAYMENT_MODE_BY_ID: Record<number, PaymentMode> = {
  0: 'bankTransfer',
  1: 'cash',
  2: 'cheque',
  3: 'other',
  4: 'online',
};

/** Real `bookings.status` only ever held 0/1; partPaid and cancelled come from the app. */
export const BOOKING_STATUS_ID: Record<BookingStatus, 0 | 1 | 2 | 3> = {
  pending: 0,
  booked: 1,
  partPaid: 2,
  cancelled: 3,
};
export const BOOKING_STATUS_BY_ID: Record<number, BookingStatus> = {
  0: 'pending',
  1: 'booked',
  2: 'partPaid',
  3: 'cancelled',
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : undefined);
const isoRequired = (d: Date) => d.toISOString();

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface UserStats {
  totalBookings?: number;
  totalReferrals?: number;
  teamSize?: number;
  employeeCount?: number;
  agentCount?: number;
  attendanceStatusToday?: string;
}

function maskAccount(accounts: BankAccount[]): { masked?: string; ifsc?: string } {
  const primary = accounts.find((a) => a.isPrimary) ?? accounts[0];
  if (!primary) return {};
  return { masked: `•••• •••• ${primary.accountNumber.slice(-4)}`, ifsc: primary.ifsc };
}

export function adminUser(
  user: User & { bankAccounts?: BankAccount[]; reportingLeader?: { name: string } | null },
  stats: UserStats = {}
) {
  const bank = maskAccount(user.bankAccounts ?? []);
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email ?? '',
    role: ROLE_ID[user.role],
    status: user.status,
    avatarUrl: user.avatarUrl ?? undefined,
    referralCode: user.referralCode,
    partnerCode: user.partnerCode,
    sponsorId: user.sponsorId ?? undefined,
    createdAt: isoRequired(user.createdAt),
    city: user.city ?? undefined,
    address: user.address ?? undefined,
    bankAccountMasked: bank.masked,
    bankIfsc: bank.ifsc,
    panMasked: user.panNumber ? `••••••${user.panNumber.slice(-4)}` : undefined,
    walletBalance: user.walletBalance,
    kycStatus: user.kycStatus,
    // Role-specific fields. Only the ones meaningful for this row are populated, which is
    // what the Agent/Employee/Leader union in the frontend expects.
    teamId: user.teamId ?? undefined,
    leaderId: user.reportingLeaderId ?? undefined,
    /** The same edge under its CRM name: who this person reports to. */
    managerId: user.reportingLeaderId ?? undefined,
    managerName: user.reportingLeader?.name,
    designation: user.designation ?? undefined,
    area: user.area ?? undefined,
    ...stats,
  };
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

/**
 * The frontend's single `status` field folds two independent DB concepts together:
 * whether the day is complete, and whether the row ever synced. Sync trouble wins,
 * because that is what the admin needs to act on.
 */
export function attendanceStatus(record: Pick<AttendanceRecord, 'checkInAt' | 'checkOutAt' | 'syncStatus'>) {
  if (record.syncStatus === 'failed') return 'failed';
  if (record.syncStatus === 'pending') return 'pending_sync';
  if (record.checkInAt && record.checkOutAt) return 'checked_out';
  if (record.checkInAt) return 'checked_in';
  return 'not_checked_in';
}

export function adminAttendance(record: AttendanceRecord & { user: Pick<User, 'name' | 'role'> }) {
  const point = (lat: number | null, lng: number | null, address: string | null) =>
    lat !== null && lng !== null ? { lat, lng, address: address ?? undefined } : undefined;
  return {
    id: record.id,
    userId: record.userId,
    userName: record.user.name,
    role: ROLE_ID[record.user.role],
    date: isoRequired(record.date),
    checkInAt: iso(record.checkInAt),
    checkOutAt: iso(record.checkOutAt),
    workingHours: record.workingHours ?? undefined,
    status: attendanceStatus(record),
    isLate: record.isLate,
    isEarlyDeparture: record.isEarlyDeparture,
    checkInLocation: point(record.checkInLat, record.checkInLng, record.checkInLocation),
    checkOutLocation: point(record.checkOutLat, record.checkOutLng, record.checkOutLocation),
    geoFenceResult: record.geoFenceResult,
    distanceFromOfficeMeters: record.distanceFromOfficeMeters ?? undefined,
    syncStatus: record.syncStatus,
    failureReason: record.failureReason ?? undefined,
    correctionRequested: record.correctionRequested,
    correctionReason: record.correctionReason ?? undefined,
    correctionStatus: record.correctionStatus ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Projects & properties
// ---------------------------------------------------------------------------

/** Plot tallies for a project. Derived, and included wherever the screens show them. */
export interface ProjectUnitCounts {
  total: number;
  available: number;
  booked: number;
  soldOut: number;
}

export function adminProject(project: Project & { files?: ProjectFile[] }, unitCounts?: ProjectUnitCounts) {
  const files = project.files ?? [];
  const ofKind = (kind: ProjectFile['kind']) =>
    files.filter((f) => f.kind === kind).map((f) => ({ id: f.id, file: f.file, capturedOn: iso(f.capturedOn), caption: f.caption ?? undefined, isVideo: f.isVideo }));
  return {
    id: project.id,
    projectName: project.projectName,
    projectType: project.projectType ?? undefined,
    category: project.category,
    projectLocation: project.projectLocation,
    landArea: project.landArea,
    projectPrice: project.projectPrice ?? undefined,
    projectDescription: project.projectDescription,
    status: project.status,
    sortOrder: project.sortOrder,
    holdReason: project.holdReason ?? undefined,
    banner: project.banner ?? undefined,
    thumbnail: project.thumbnail ?? undefined,
    map: project.map ?? undefined,
    googleLocation: project.googleLocation ?? undefined,
    latitude: project.latitude ?? undefined,
    longitude: project.longitude ?? undefined,
    distanceMap: project.distanceMap ?? undefined,
    layoutPlanUrl: project.layoutPlanUrl ?? undefined,
    d3ViewLink: project.d3ViewLink ?? undefined,
    d3ViewFile: project.d3ViewFile ?? undefined,
    d3WalkthroughLink: project.d3WalkthroughLink ?? undefined,
    d3WalkthroughFile: project.d3WalkthroughFile ?? undefined,
    amenityIds: project.amenityIds,
    gallery: project.gallery,
    jdaCertificates: ofKind('jda'),
    reraCertificates: ofKind('rera'),
    constructionPhotographs: ofKind('construction'),
    unitCounts,
    createdAt: isoRequired(project.createdAt),
    updatedAt: isoRequired(project.updatedAt),
  };
}

export function adminUnit(unit: PropertyUnit & { facings?: PlotFacing[] }) {
  return {
    id: unit.id,
    projectId: unit.projectId,
    addressId: unit.addressId ?? undefined,
    propertyTitle: unit.propertyTitle,
    propertyNumber: unit.propertyNumber,
    propertyType: unit.propertyType,
    propertyArea: unit.propertyArea,
    propertyMeasurement: unit.propertyMeasurement,
    width: unit.width ?? undefined,
    length: unit.length ?? undefined,
    details: unit.details ?? undefined,
    // Storage for per-unit FAQs exists in the real schema but its admin UI never created
    // any, so this is always empty — kept so the frontend type stays satisfied.
    faq: [] as { title: string; details: string }[],
    status: unit.status,
    bookingStatus: unit.bookingStatus,
    isCorner: unit.isCorner,
    isFeatured: unit.isFeatured,
    isVerified: unit.isVerified,
    location: unit.location ?? undefined,
    thumbnail: unit.thumbnail ?? undefined,
    sitePlan: unit.sitePlan ?? undefined,
    images: unit.images,
    amenityIds: unit.amenityIds,
    plotFacings: (unit.facings ?? []).map((f) => ({ key: f.key, value: f.value })),
    constructedArea: unit.constructedArea ?? undefined,
    perAreaAmount: unit.perAreaAmount,
    perAreaProfit: unit.perAreaProfit,
    totalInvestmentAmount: unit.totalInvestmentAmount,
    profit: unit.profit,
    charges: unit.charges,
    gstAndRegistration: unit.gstAndRegistration,
    tokenAmount: unit.tokenAmount,
    bookedBy: unit.bookedById ?? undefined,
    createdAt: isoRequired(unit.createdAt),
    updatedAt: isoRequired(unit.updatedAt),
  };
}

export function adminPlotHold(hold: PlotHold) {
  return {
    id: hold.id,
    unitId: hold.unitId,
    userId: hold.userId ?? undefined,
    holdStart: isoRequired(hold.holdStart),
    holdEnd: isoRequired(hold.holdEnd),
    status: hold.status,
  };
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export function adminBooking(booking: Booking) {
  return {
    id: booking.id,
    reference: booking.reference,
    propertyId: booking.propertyId,
    bookingName: booking.bookingName,
    phone: booking.phone,
    userId: booking.userId ?? undefined,
    involvedMemberId: booking.involvedMemberId ?? undefined,
    amount: booking.amount,
    paymentMode: PAYMENT_MODE_ID[booking.paymentMode],
    chequeImage: booking.chequeImage ?? undefined,
    note: booking.note ?? undefined,
    aadhaarNumber: booking.aadhaarNumber ?? undefined,
    aadhaarImage: booking.aadhaarImage ?? undefined,
    aadhaarBack: booking.aadhaarBack ?? undefined,
    isDeposit: booking.isDeposit as 0 | 1,
    status: BOOKING_STATUS_ID[booking.status],
    commission: booking.commission,
    createdAt: isoRequired(booking.createdAt),
    updatedAt: isoRequired(booking.updatedAt),
  };
}

export function adminInvestment(investment: Investment) {
  return {
    id: investment.id,
    userId: investment.userId,
    propertyId: investment.propertyId,
    bookingId: investment.bookingId,
    amount: investment.amount,
    profit: investment.profit,
    profitType: investment.profitType as 0 | 1,
    netProfit: investment.netProfit,
    loss: investment.loss,
    lossType: investment.lossType as 0 | 1,
    isActive: investment.isActive as 0 | 1,
    deactiveReason: investment.deactiveReason ?? undefined,
    returnDate: iso(investment.returnDate),
    lastReturnDate: iso(investment.lastReturnDate),
    createdAt: isoRequired(investment.createdAt),
    updatedAt: isoRequired(investment.updatedAt),
  };
}

export function adminFund(fund: FundRequest) {
  return {
    id: fund.id,
    userId: fund.userId,
    amount: fund.amount,
    gatewayName: fund.gatewayName,
    trxId: fund.trxId,
    status: fund.status as 1 | 2 | 3,
    feedback: fund.feedback ?? undefined,
    createdAt: isoRequired(fund.createdAt),
    updatedAt: isoRequired(fund.updatedAt),
  };
}

export function adminIncentiveRequest(request: IncentiveRequest) {
  return {
    id: request.id,
    userId: request.userId,
    propertyId: request.propertyId,
    status: request.status as 0 | 1 | 2,
    createdAt: isoRequired(request.createdAt),
    updatedAt: isoRequired(request.updatedAt),
  };
}

export function adminPayout(
  payout: PayoutRequest & { user: Pick<User, 'name' | 'role'>; history?: PayoutStatusEvent[] }
) {
  return {
    id: payout.id,
    userId: payout.userId,
    userName: payout.user.name,
    role: ROLE_ID[payout.user.role],
    amount: payout.amount,
    requestDate: isoRequired(payout.requestDate),
    status: payout.status,
    processor: payout.processor ?? undefined,
    bankAccountMasked: payout.bankAccountMasked,
    bankIfsc: payout.bankIfsc,
    referralBonus: payout.referralBonus,
    commission: payout.commission,
    isAutomaticMethod: payout.isAutomaticMethod,
    lastError: payout.lastError ?? undefined,
    statusHistory: (payout.history ?? []).map((h) => ({
      status: h.status as PayoutStatus,
      timestamp: isoRequired(h.createdAt),
      note: h.note ?? undefined,
    })),
  };
}

/** The admin's "Commission Statements" row — the same EarningEntry ledger the app reads. */
export function adminCommissionStatement(
  entry: EarningEntry & { user: Pick<User, 'name'>; referralUserName?: string | null }
) {
  return {
    id: entry.id,
    userId: entry.userId,
    userName: entry.user.name,
    referralUserId: entry.referralUserId ?? undefined,
    referralUserName: entry.referralUserName ?? undefined,
    // A referral row's money is the bonus; a commission row's money is the commission.
    commission: entry.kind === 'bookingCommission' ? entry.amount : 0,
    bonus: entry.kind === 'bookingCommission' ? 0 : entry.amount,
    date: isoRequired(entry.creditedOn),
    status: entry.status,
  };
}

// ---------------------------------------------------------------------------
// Support, notifications, audit
// ---------------------------------------------------------------------------

export function adminTicket(
  ticket: SupportTicket & { user: Pick<User, 'name' | 'role'>; messages?: TicketMessage[] }
) {
  return {
    id: ticket.id,
    userId: ticket.userId,
    userName: ticket.user.name,
    userRole: ROLE_ID[ticket.user.role],
    subject: ticket.subject,
    status: ticket.status,
    createdAt: isoRequired(ticket.createdAt),
    updatedAt: isoRequired(ticket.updatedAt),
    lastReplyAt: iso(ticket.lastReplyAt),
    messages: (ticket.messages ?? []).map((m) => ({
      id: m.id,
      ticketId: m.ticketId,
      authorId: m.authorId,
      authorName: m.authorName,
      authorRole: m.authorRole as 'admin' | 'user',
      message: m.message,
      attachments: m.attachments,
      createdAt: isoRequired(m.createdAt),
    })),
  };
}

/** Delivery counts come from the fan-out rows, so they always match reality. */
export function adminNotification(
  notification: Notification & { _count?: { recipients: number }; deliveredCount?: number; failedCount?: number }
) {
  const recipientCount = notification._count?.recipients ?? 0;
  const failedCount = notification.failedCount ?? 0;
  return {
    id: notification.id,
    title: notification.title,
    body: notification.body,
    type: notification.type,
    audience: notification.audience,
    createdAt: isoRequired(notification.createdAt),
    deliveryStatus: notification.deliveryStatus,
    // Null once it has gone out, so the list can tell "waiting" from "already sent".
    scheduledFor: notification.scheduledFor ? isoRequired(notification.scheduledFor) : undefined,
    sentAt: notification.sentAt ? isoRequired(notification.sentAt) : undefined,
    recipientCount,
    deliveredCount: notification.deliveredCount ?? recipientCount - failedCount,
    failedCount,
  };
}

export function adminAudit(entry: AuditEntry) {
  return {
    id: entry.id,
    userId: entry.userId,
    userName: entry.userName,
    action: entry.action,
    module: entry.module,
    recordId: entry.recordId,
    recordLabel: entry.recordLabel,
    timestamp: isoRequired(entry.createdAt),
    description: entry.description,
    changes: Array.isArray(entry.changes) ? entry.changes : [],
  };
}

export function adminBankAccount(account: BankAccount) {
  return {
    id: account.id,
    bankName: account.bankName,
    accountNumber: account.accountNumber,
    holderName: account.holderName,
    ifsc: account.ifsc,
    accountType: account.accountType,
    state: account.state,
    isPrimary: account.isPrimary,
  };
}

// ---------------------------------------------------------------------------
// Task management
// ---------------------------------------------------------------------------

type TaskPerson = Pick<User, 'id' | 'name' | 'role' | 'avatarUrl'>;

/**
 * A task as the panel's list, board and detail screens read it.
 *
 * `isOverdue` is computed here rather than in the browser so every surface agrees on it —
 * a done task is never overdue, however long ago its due date passed.
 */
export function adminTask(
  task: Task & { assignee?: TaskPerson | null; createdBy?: TaskPerson | null; _count?: { comments: number } }
) {
  const isOpen = task.status !== 'done' && task.status !== 'cancelled';
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? '',
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt?.toISOString() ?? null,
    isOverdue: isOpen && !!task.dueAt && task.dueAt.getTime() < Date.now(),
    assigneeId: task.assigneeId,
    assigneeName: task.assignee?.name ?? '',
    assigneeRole: task.assignee ? ROLE_ID[task.assignee.role] : null,
    assigneeAvatarUrl: task.assignee?.avatarUrl ?? undefined,
    createdById: task.createdById,
    createdByName: task.createdBy?.name ?? '',
    commentCount: task._count?.comments ?? 0,
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export function adminTaskComment(comment: TaskComment & { author?: TaskPerson | null }) {
  return {
    id: comment.id,
    taskId: comment.taskId,
    body: comment.body,
    authorId: comment.authorId,
    authorName: comment.author?.name ?? '',
    authorAvatarUrl: comment.author?.avatarUrl ?? undefined,
    createdAt: comment.createdAt.toISOString(),
  };
}
