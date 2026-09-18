import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { UserCog } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { StatCard } from '../../components/ui/StatCard';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { Tabs, type TabItem } from '../../components/ui/Tabs';
import { UserCard } from '../../components/ui/UserCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import * as userService from '../../services/userService';
import * as teamService from '../../services/teamService';
import { findUserById, refAgents, refEmployees } from '../../data/referenceData';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format';
import { RoleId, type AccountStatus, type Agent, type BookingRow, type PayoutRequest, type AttendanceRecord, type TeamTreeNode } from '../../types';

const STATUS_SELECT_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'suspended', label: 'Suspended' },
];

function listPathForRole(role: RoleId): string {
  switch (role) {
    case RoleId.Agent:
      return '/users/agents';
    case RoleId.Employee:
      return '/users/employees';
    case RoleId.Leader:
      return '/users/leaders';
    default:
      return '/users/agents';
  }
}

function listLabelForRole(role: RoleId): string {
  switch (role) {
    case RoleId.Agent:
      return 'Agents';
    case RoleId.Employee:
      return 'Employees';
    case RoleId.Leader:
      return 'Leaders';
    default:
      return 'Users';
  }
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-1 text-sm text-ink">{value ?? '—'}</p>
    </div>
  );
}

function TeamNodeRow({ node, depth }: { node: TeamTreeNode; depth: number }) {
  return (
    <div>
      <Link
        to={`/users/${node.userId}`}
        className="flex items-center gap-2.5 rounded-lg py-1.5 pr-2 hover:bg-surface-subtle focus-ring"
        style={{ paddingLeft: `${depth * 22 + 8}px` }}
      >
        <Avatar name={node.name} size="xs" />
        <span className="text-sm font-medium text-ink">{node.name}</span>
        <span className="text-xs text-ink-faint">{userService.roleLabel(node.role)}</span>
        <StatusBadge kind="account" status={node.status} dot={false} />
        {node.teamSize > 0 && <span className="text-xs text-ink-faint">({node.teamSize})</span>}
      </Link>
      {node.children.map((child) => (
        <TeamNodeRow key={child.userId} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [refreshKey, setRefreshKey] = useState(0);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<AccountStatus>('active');

  // The user, their bookings, payouts and attendance all arrive in one request — the
  // eager-load the mock layer's synchronous cross-collection reads were standing in for.
  const { data: detail, isLoading, error } = useAsync(
    () => (id ? userService.getUserDetail(id) : Promise.resolve(undefined)),
    [id, refreshKey]
  );
  const user = detail?.user;

  const isLeader = user?.role === RoleId.Leader;
  const isEmployee = user?.role === RoleId.Employee;
  const isAgent = user?.role === RoleId.Agent;
  const agentTeamId = isAgent ? (user as Agent).teamId : undefined;

  const { data: leaderTree } = useAsync(
    () => (user && isLeader ? teamService.getTeamTree(user.id) : Promise.resolve(undefined)),
    [user?.id, isLeader]
  );

  const { data: agentTeam } = useAsync(
    () => (agentTeamId ? teamService.getTeam(agentTeamId) : Promise.resolve(undefined)),
    [agentTeamId]
  );

  const openStatusModal = () => {
    if (!user) return;
    setNewStatus(user.status);
    setStatusModalOpen(true);
  };

  const handleConfirmStatusChange = async () => {
    if (!user) return;
    await userService.updateUserStatus(user.id, newStatus);
    toast({ title: 'Status updated', description: `${user.name}'s account is now ${newStatus}.`, variant: 'success' });
    setRefreshKey((k) => k + 1);
  };

  if (isLoading) {
    return (
      <div>
        <PageHeader title="User" description="Loading partner profile..." />
        <CardSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="User" />
        <Card padded={false}>
          <ErrorState onRetry={() => setRefreshKey((k) => k + 1)} />
        </Card>
      </div>
    );
  }

  if (!user) {
    return (
      <div>
        <PageHeader title="User not found" />
        <Card padded={false}>
          <EmptyState title="User not found" description="This partner record does not exist or may have been removed." />
        </Card>
      </div>
    );
  }

  const bookings = detail?.bookings ?? [];
  const payouts = detail?.payouts ?? [];
  const attendance = isEmployee || isLeader ? detail?.attendance ?? [] : [];

  // Sibling/downline relationships come from the cached partner directory, which is small
  // enough to hold client-side and is what every other screen resolves names against.
  const referredAgents = isAgent ? refAgents.filter((a) => a.sponsorId === user.id) : [];
  const employeeLeaderId = (user as { leaderId?: string }).leaderId;
  const employeeLeader = isEmployee && employeeLeaderId ? findUserById(employeeLeaderId) : undefined;
  const employeeTeammates = isEmployee
    ? refEmployees.filter((e) => e.leaderId === employeeLeaderId && e.id !== user.id)
    : [];

  const showTeamTab = isLeader || isEmployee || (isAgent && !!agentTeamId);
  const showReferralsTab = isAgent;
  const showBookingsTab = bookings.length > 0;
  const showPayoutsTab = payouts.length > 0;
  const showAttendanceTab = (isEmployee || isLeader) && attendance.length > 0;

  const tabItems: TabItem[] = [
    { key: 'overview', label: 'Overview' },
    ...(showTeamTab ? [{ key: 'team', label: 'Team' }] : []),
    ...(showReferralsTab ? [{ key: 'referrals', label: 'Referrals', badge: referredAgents.length || undefined }] : []),
    ...(showBookingsTab ? [{ key: 'bookings', label: 'Bookings', badge: bookings.length }] : []),
    ...(showPayoutsTab ? [{ key: 'payouts', label: 'Payouts', badge: payouts.length }] : []),
    ...(showAttendanceTab ? [{ key: 'attendance', label: 'Attendance' }] : []),
  ];

  const bookingColumns: DataTableColumn<BookingRow>[] = [
    { key: 'id', header: 'Booking ID', render: (b) => <span className="font-medium text-ink">{b.id}</span> },
    { key: 'project', header: 'Project', render: (b) => b.projectName },
    { key: 'amount', header: 'Amount', align: 'right', render: (b) => formatCurrency(b.amount) },
    { key: 'status', header: 'Status', render: (b) => <StatusBadge kind="booking" status={b.status} /> },
    { key: 'date', header: 'Date', render: (b) => formatDate(b.createdAt) },
  ];

  const payoutColumns: DataTableColumn<PayoutRequest>[] = [
    { key: 'id', header: 'Payout ID', render: (p) => <span className="font-medium text-ink">{p.id}</span> },
    { key: 'amount', header: 'Amount', align: 'right', render: (p) => formatCurrency(p.amount) },
    { key: 'status', header: 'Status', render: (p) => <StatusBadge kind="payout" status={p.status} /> },
    { key: 'date', header: 'Request Date', render: (p) => formatDate(p.requestDate) },
  ];

  const attendanceColumns: DataTableColumn<AttendanceRecord>[] = [
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
    { key: 'checkIn', header: 'Check-in', render: (r) => (r.checkInAt ? formatDateTime(r.checkInAt) : '—') },
    { key: 'checkOut', header: 'Check-out', render: (r) => (r.checkOutAt ? formatDateTime(r.checkOutAt) : '—') },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge kind="attendance" status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title={user.name}
        breadcrumb={[{ label: listLabelForRole(user.role), to: listPathForRole(user.role) }, { label: user.name }]}
        actions={
          <Button variant="outline" leftIcon={<UserCog size={15} />} onClick={openStatusModal}>
            Change Status
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-line bg-white p-5 shadow-card">
        <Avatar name={user.name} src={user.avatarUrl} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-ink">{user.name}</h2>
            <Badge tone="navy">{userService.roleLabel(user.role)}</Badge>
            <StatusBadge kind="account" status={user.status} />
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {user.phone} · {user.email}
          </p>
        </div>
      </div>

      <Tabs items={tabItems}>
        {(activeKey) => (
          <>
            {activeKey === 'overview' && (
              <>
              <Card>
                <CardHeader title="Profile" subtitle="Core partner profile details" />
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  <DetailField label="Full Name" value={user.name} />
                  <DetailField label="Phone" value={user.phone} />
                  <DetailField label="Email" value={user.email} />
                  <DetailField label="Referral Code" value={<span className="font-mono">{user.referralCode}</span>} />
                  <DetailField label="City" value={user.city} />
                  <DetailField label="Address" value={user.address} />
                  <DetailField label="Created On" value={formatDate(user.createdAt)} />
                  <DetailField label="Bank Account" value={user.bankAccountMasked} />
                  <DetailField label="Bank IFSC" value={user.bankIfsc} />
                  <DetailField label="PAN" value={user.panMasked} />
                  {isAgent && (
                    <DetailField
                      label="Sponsor"
                      value={
                        user.sponsorId ? (
                          <Link to={`/users/${user.sponsorId}`} className="font-medium text-brand-600 hover:text-brand-700 focus-ring rounded">
                            {findUserById(user.sponsorId)?.name ?? user.sponsorId}
                          </Link>
                        ) : (
                          '—'
                        )
                      }
                    />
                  )}
                  {isEmployee && <DetailField label="Designation" value={(user as { designation?: string }).designation} />}
                </div>
              </Card>

              {isAgent && (
                <Card>
                  <CardHeader title="Upline Chain" subtitle="Full sponsor chain up to the root, mirroring the real referralMemberupline view" />
                  {(() => {
                    const chain: typeof user[] = [];
                    let current: typeof user | undefined = user;
                    const seen = new Set<string>();
                    while (current?.sponsorId && !seen.has(current.sponsorId)) {
                      seen.add(current.sponsorId);
                      const sponsor = findUserById(current.sponsorId);
                      if (!sponsor) break;
                      chain.push(sponsor as typeof user);
                      current = sponsor as typeof user;
                    }
                    if (chain.length === 0) return <p className="text-sm text-ink-muted">This agent has no sponsor — they are at the root of the referral tree.</p>;
                    return (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        {chain.map((u, i) => (
                          <span key={u.id} className="flex items-center gap-2">
                            {i > 0 && <span className="text-ink-faint">→</span>}
                            <Link to={`/users/${u.id}`} className="font-medium text-brand-600 hover:text-brand-700 focus-ring rounded">
                              {u.name}
                            </Link>
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                </Card>
              )}
              </>
            )}

            {activeKey === 'team' && showTeamTab && (
              <Card>
                {isLeader && (
                  <>
                    <CardHeader title="Team Overview" subtitle="Direct and downline network under this leader" />
                    <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
                      <StatCard label="Team Size" value={(user as { teamSize: number }).teamSize} tone="navy" />
                      <StatCard label="Employees" value={(user as { employeeCount: number }).employeeCount} tone="brand" />
                      <StatCard label="Agents" value={(user as { agentCount: number }).agentCount} tone="accent" />
                    </div>
                    {leaderTree && leaderTree.children.length > 0 ? (
                      <div className="rounded-lg border border-line p-2">
                        {leaderTree.children.map((child) => (
                          <TeamNodeRow key={child.userId} node={child} depth={0} />
                        ))}
                      </div>
                    ) : (
                      <EmptyState title="No team members yet" description="No employees or agents are currently assigned to this leader." />
                    )}
                  </>
                )}

                {isEmployee && (
                  <>
                    <CardHeader title="Team" subtitle="Reporting leader and teammates" />
                    <div className="space-y-4">
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Leader</p>
                        {employeeLeader ? (
                          <UserCard
                            name={employeeLeader.name}
                            role={employeeLeader.role}
                            status={employeeLeader.status}
                            avatarUrl={employeeLeader.avatarUrl}
                            to={`/users/${employeeLeader.id}`}
                          />
                        ) : (
                          <p className="text-sm text-ink-muted">No leader assigned.</p>
                        )}
                      </div>
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                          Teammates ({employeeTeammates.length})
                        </p>
                        {employeeTeammates.length > 0 ? (
                          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                            {employeeTeammates.map((mate) => (
                              <UserCard key={mate.id} name={mate.name} role={mate.role} status={mate.status} avatarUrl={mate.avatarUrl} to={`/users/${mate.id}`} />
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-ink-muted">No other teammates under this leader.</p>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {isAgent && agentTeamId && (
                  <>
                    <CardHeader title="Team" subtitle="Team this agent belongs to" />
                    {agentTeam ? (
                      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                        <DetailField label="Team" value={agentTeam.name} />
                        <DetailField
                          label="Team Leader"
                          value={
                            <Link to={`/users/${agentTeam.leaderId}`} className="font-medium text-brand-600 hover:text-brand-700 focus-ring rounded">
                              {findUserById(agentTeam.leaderId)?.name ?? agentTeam.leaderId}
                            </Link>
                          }
                        />
                        <DetailField label="Team Members" value={agentTeam.memberIds.length} />
                      </div>
                    ) : (
                      <p className="text-sm text-ink-muted">Loading team info...</p>
                    )}
                  </>
                )}
              </Card>
            )}

            {activeKey === 'referrals' && showReferralsTab && (
              <Card>
                <CardHeader title="Referrals" subtitle="Agents referred directly by this agent" />
                {referredAgents.length > 0 ? (
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {referredAgents.map((a) => (
                      <UserCard key={a.id} name={a.name} role={a.role} status={a.status} avatarUrl={a.avatarUrl} to={`/users/${a.id}`} />
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No referrals yet" description="This agent has not referred any other agents." />
                )}
              </Card>
            )}

            {activeKey === 'bookings' && showBookingsTab && (
              <Card padded={false}>
                <div className="p-5 pb-0">
                  <CardHeader title="Bookings" subtitle="Bookings associated with this partner" />
                </div>
                <DataTable columns={bookingColumns} rows={bookings} rowKey={(b) => b.id} onRowClick={(b) => navigate(`/bookings/${b.id}`)} />
              </Card>
            )}

            {activeKey === 'payouts' && showPayoutsTab && (
              <Card padded={false}>
                <div className="p-5 pb-0">
                  <CardHeader title="Payouts" subtitle="Payout requests raised by this partner" />
                </div>
                <DataTable columns={payoutColumns} rows={payouts} rowKey={(p) => p.id} onRowClick={(p) => navigate(`/payouts/${p.id}`)} />
              </Card>
            )}

            {activeKey === 'attendance' && showAttendanceTab && (
              <Card padded={false}>
                <div className="p-5 pb-0">
                  <CardHeader title="Attendance" subtitle="Recent attendance records" />
                </div>
                <DataTable
                  columns={attendanceColumns}
                  rows={attendance.slice(0, 15)}
                  rowKey={(r) => r.id}
                  onRowClick={(r) => navigate(`/attendance/${r.id}`)}
                />
              </Card>
            )}
          </>
        )}
      </Tabs>

      <Modal
        isOpen={statusModalOpen}
        onClose={() => setStatusModalOpen(false)}
        title="Change Account Status"
        description={`Update the account status for ${user.name}.`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setStatusModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={newStatus === user.status}
              onClick={() => {
                setStatusModalOpen(false);
                setConfirmOpen(true);
              }}
            >
              Continue
            </Button>
          </>
        }
      >
        <Select
          label="New status"
          value={newStatus}
          onChange={(e) => setNewStatus(e.target.value as AccountStatus)}
          options={STATUS_SELECT_OPTIONS}
        />
      </Modal>

      <ConfirmationDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirmStatusChange}
        title="Confirm status change"
        description={`Change ${user.name}'s account status to "${newStatus}"?`}
        confirmLabel="Change Status"
        variant={newStatus === 'suspended' ? 'danger' : 'primary'}
        audited
      />
    </div>
  );
}
