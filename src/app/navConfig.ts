import {
  LayoutDashboard,
  Building2,
  LayoutGrid,
  ClipboardList,
  Wallet,
  Users,
  Network,
  Fingerprint,
  Banknote,
  LifeBuoy,
  Bell,
  BarChart3,
  Settings,
  Target,
  ListChecks,
  TrendingUp,
  Gift,
  HardHat,
  Truck,
  Scale,
  Workflow,
  Camera,
  Briefcase,
  Handshake,
  type LucideIcon,
} from 'lucide-react';

export interface NavChild {
  label: string;
  to: string;
  /** Hidden from people who only ever see their own work — there is no team for them to look at. */
  teamOnly?: boolean;
}

/** Matches the module keys the server enforces — see server/src/services/permissions.ts. */
export type ModuleKey =
  | 'dashboard' | 'crm' | 'tasks' | 'projects' | 'construction' | 'vendors' | 'legal' | 'ops_rules' | 'cameras' | 'vendor_portal' | 'partner_portal' | 'properties' | 'bookings' | 'payments' | 'investments'
  | 'partners' | 'teams' | 'attendance' | 'payouts' | 'incentives' | 'support' | 'notifications'
  | 'reports' | 'settings';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** The permission this section needs. A user without it never sees the entry. */
  module: ModuleKey;
  children?: NavChild[];
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, module: 'dashboard' },
  {
    label: 'CRM',
    to: '/crm',
    icon: Target,
    module: 'crm',
    children: [
      { label: 'Overview', to: '/crm' },
      { label: 'Leads', to: '/crm/leads' },
      { label: 'Pipeline', to: '/crm/pipeline' },
      { label: 'Kanban', to: '/crm/pipeline/kanban' },
      { label: 'Follow-ups', to: '/crm/follow-ups' },
      { label: 'Site Visits', to: '/crm/site-visits' },
      { label: 'Telecaller Activity', to: '/crm/telecallers', teamOnly: true },
      { label: 'Task Calendar', to: '/crm/calendar' },
      { label: 'Forms', to: '/crm/forms' },
      { label: 'Report Center', to: '/crm/report-center' },
      { label: 'Activities', to: '/crm/activities' },
      { label: 'Team Leaders', to: '/crm/team-leaders', teamOnly: true },
      { label: 'Team Hierarchy', to: '/crm/hierarchy', teamOnly: true },
      { label: 'Automation', to: '/crm/automation' },
      { label: 'Conversations', to: '/crm/conversations' },
      { label: 'Email Sequences', to: '/crm/email-sequences' },
      { label: 'Call History', to: '/crm/calls' },
      { label: 'AI SDR Agents', to: '/crm/sdr-agents' },
      { label: 'Integrations', to: '/crm/integrations' },
    ],
  },
  {
    label: 'Tasks',
    to: '/tasks',
    icon: ListChecks,
    module: 'tasks',
    children: [
      { label: 'All Tasks', to: '/tasks' },
      { label: 'Board', to: '/tasks/board' },
      { label: 'My Tasks', to: '/tasks/mine' },
      { label: 'New Task', to: '/tasks/new' },
    ],
  },
  {
    label: 'Construction',
    to: '/construction',
    icon: HardHat,
    module: 'construction',
    children: [
      { label: 'Progress', to: '/construction' },
      { label: 'Review Updates', to: '/construction/reviews' },
      { label: 'Site Issues', to: '/construction/issues' },
    ],
  },
  {
    label: 'Vendors & Material',
    to: '/vendors',
    icon: Truck,
    module: 'vendors',
    children: [
      { label: 'Directory', to: '/vendors' },
      { label: 'Material', to: '/vendors/material' },
      { label: 'Bills', to: '/vendors/bills' },
    ],
  },
  {
    label: 'Legal & Registry',
    to: '/legal',
    icon: Scale,
    module: 'legal',
    children: [
      { label: 'Legal Files', to: '/legal' },
      { label: 'Compliance', to: '/legal/compliance' },
      { label: 'Disputes & Notices', to: '/legal/disputes' },
      { label: 'Document Templates', to: '/legal/templates' },
    ],
  },
  {
    label: 'Site Cameras',
    to: '/cameras',
    icon: Camera,
    module: 'cameras',
    children: [
      { label: 'Cameras', to: '/cameras' },
      { label: 'Flagged Pictures', to: '/cameras/flagged' },
    ],
  },
  { label: 'Operations Rules', to: '/ops-rules', icon: Workflow, module: 'ops_rules' },
  {
    label: 'My Work',
    to: '/vendor-portal',
    icon: Briefcase,
    module: 'vendor_portal',
    children: [
      { label: 'Work & updates', to: '/vendor-portal' },
      { label: 'Material', to: '/vendor-portal/material' },
      { label: 'Bills', to: '/vendor-portal/bills' },
    ],
  },
  {
    label: 'Partner Portal',
    to: '/partner-portal',
    icon: Handshake,
    module: 'partner_portal',
    children: [
      { label: 'My leads', to: '/partner-portal' },
      { label: 'My bookings', to: '/partner-portal/bookings' },
      { label: 'My brokerage', to: '/partner-portal/brokerage' },
      { label: 'Disputes', to: '/partner-portal/disputes' },
    ],
  },
  {
    label: 'Projects',
    to: '/projects',
    icon: Building2,
    module: 'projects',
    children: [
      { label: 'All Projects', to: '/projects' },
      { label: 'Add Project', to: '/projects/new' },
    ],
  },
  {
    label: 'Properties',
    to: '/properties',
    icon: LayoutGrid,
    module: 'properties',
    children: [
      { label: 'All Properties', to: '/properties' },
      { label: 'Running Properties', to: '/properties/running' },
      { label: 'Sold Out Properties', to: '/properties/sold-out' },
      { label: 'Booked Properties', to: '/properties/booked' },
      { label: 'Add Property', to: '/properties/new' },
      { label: 'Plot Map', to: '/properties/map' },
      { label: 'Plot Holds', to: '/properties/holds' },
      { label: 'Bulk Price Update', to: '/properties/bulk-price-update' },
    ],
  },
  {
    label: 'Bookings',
    to: '/bookings',
    icon: ClipboardList,
    module: 'bookings',
    children: [
      { label: 'All Bookings', to: '/bookings' },
      { label: 'Pending', to: '/bookings/pending' },
      { label: 'Booked', to: '/bookings/booked' },
      { label: 'Remaining Payments', to: '/bookings/remaining' },
      { label: 'Cancellations', to: '/bookings/cancellations' },
    ],
  },
  {
    label: 'Payments / Transactions',
    to: '/transactions',
    icon: Wallet,
    module: 'payments',
    children: [
      { label: 'All Payments', to: '/transactions' },
      { label: 'Wallet Deposit Approvals', to: '/wallet/approvals' },
      { label: 'KYC Approvals', to: '/wallet/kyc' },
    ],
  },
  {
    label: 'Investments / Deposits',
    to: '/investments',
    icon: TrendingUp,
    module: 'investments',
    children: [
      { label: 'All Deposits', to: '/investments' },
      { label: 'Running', to: '/investments/running' },
      { label: 'Due', to: '/investments/due' },
      { label: 'Expired', to: '/investments/expired' },
      { label: 'Completed', to: '/investments/completed' },
    ],
  },
  {
    label: 'Partners / Users',
    to: '/users/agents',
    icon: Users,
    module: 'partners',
    children: [
      { label: 'Agents', to: '/users/agents' },
      { label: 'Employees', to: '/users/employees' },
      { label: 'Team Leaders', to: '/users/team-leaders' },
      { label: 'Leaders', to: '/users/leaders' },
      { label: 'Channel partners', to: '/channel-partners' },
    ],
  },
  { label: 'Teams / Referrals', to: '/teams', icon: Network, module: 'teams' },
  {
    label: 'Attendance',
    to: '/attendance/today',
    icon: Fingerprint,
    module: 'attendance',
    children: [
      { label: 'Today', to: '/attendance/today' },
      { label: 'History', to: '/attendance/history' },
      { label: 'Corrections', to: '/attendance/corrections' },
      { label: 'Leave Requests', to: '/attendance/leave' },
      { label: 'Leave Types', to: '/attendance/leave-types' },
      { label: 'Reports', to: '/attendance/reports' },
    ],
  },
  {
    label: 'Payouts / Earnings',
    to: '/payouts',
    icon: Banknote,
    module: 'payouts',
    children: [
      { label: 'Partner Payouts', to: '/payouts' },
      { label: 'Employee Payroll', to: '/payouts/payroll' },
    ],
  },
  { label: 'Incentive Requests', to: '/incentive-requests', icon: Gift, module: 'incentives' },
  { label: 'Support Tickets', to: '/support', icon: LifeBuoy, module: 'support' },
  {
    label: 'Notifications',
    to: '/notifications',
    icon: Bell,
    module: 'notifications',
    children: [
      { label: 'Sent Notifications', to: '/notifications' },
      { label: 'WhatsApp Broadcast', to: '/notifications/whatsapp' },
    ],
  },
  {
    label: 'Reports / Exports',
    to: '/reports',
    icon: BarChart3,
    module: 'reports',
    children: [
      { label: 'Properties', to: '/reports/properties' },
      { label: 'Bookings', to: '/reports/bookings' },
      { label: 'Payments', to: '/reports/payments' },
      { label: 'Partners', to: '/reports/partners' },
      { label: 'Teams', to: '/reports/teams' },
      { label: 'Attendance', to: '/reports/attendance' },
      { label: 'Support', to: '/reports/support' },
      { label: 'Payouts', to: '/reports/payouts' },
    ],
  },
  {
    label: 'Settings',
    to: '/settings/organization',
    icon: Settings,
    module: 'settings',
    children: [
      { label: 'Organization', to: '/settings/organization' },
      { label: 'Roles & Permissions', to: '/settings/roles' },
      { label: 'Panel Users', to: '/settings/panel-users' },
      { label: 'Business Hours', to: '/settings/business-hours' },
      { label: 'Telephony', to: '/settings/telephony' },
      { label: 'Email', to: '/settings/email' },
      { label: 'WhatsApp', to: '/settings/whatsapp' },
      { label: 'Attendance Policy', to: '/settings/attendance' },
      { label: 'Notifications', to: '/settings/notifications' },
      { label: 'Admin Profile', to: '/settings/profile' },
      { label: 'Security', to: '/settings/security' },
      { label: 'Return Schedules', to: '/settings/schedules' },
      { label: 'Sales Policy', to: '/settings/sales-policy' },
      { label: 'Referral Commission', to: '/settings/referral-commission' },
      { label: 'Badges / Ranks', to: '/settings/badges' },
      { label: 'Audit Log', to: '/settings/audit-log' },
    ],
  },
];
