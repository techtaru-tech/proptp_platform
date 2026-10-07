import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { UIProvider } from './context/UIContext';
import { ReferenceDataProvider } from './context/ReferenceDataContext';
import { ProtectedRoute } from './app/ProtectedRoute';
import { AdminLayout } from './layouts/AdminLayout';

import { Login } from './pages/auth/Login';
import { Dashboard } from './pages/dashboard/Dashboard';

import { CrmOverview } from './pages/crm/CrmOverview';
import { LeadList } from './pages/crm/LeadList';
import { AddLead } from './pages/crm/AddLead';
import { ImportLeads } from './pages/crm/ImportLeads';
import { LeadDetail } from './pages/crm/LeadDetail';
import { Pipelines } from './pages/crm/Pipelines';
import { PipelineBoard } from './pages/crm/PipelineBoard';
import { FollowUps } from './pages/crm/FollowUps';
import { TaskCalendar } from './pages/crm/TaskCalendar';
import { Forms } from './pages/crm/Forms';
import { FormBuilder } from './pages/crm/FormBuilder';
import { FormView } from './pages/crm/FormView';
import { PublicForm } from './pages/public/PublicForm';
import { PublicPlotMap } from './pages/public/PublicPlotMap';
import { ReportCenter } from './pages/crm/reports/ReportCenter';
import { LeadActivities } from './pages/crm/LeadActivities';
import { Automations } from './pages/crm/Automations';
import { AutomationBuilder } from './pages/crm/AutomationBuilder';
import { AiSdrAgents } from './pages/crm/AiSdrAgents';
import { EmailSequences } from './pages/crm/EmailSequences';
import { EmailSequenceBuilder } from './pages/crm/EmailSequenceBuilder';
import { EmailSequenceDetail } from './pages/crm/EmailSequenceDetail';
import { CallHistory } from './pages/crm/CallHistory';
import { TelephonySettingsPage } from './pages/settings/TelephonySettingsPage';
import { EmailSettingsPage } from './pages/settings/EmailSettingsPage';
import { WhatsAppSettingsPage } from './pages/settings/WhatsAppSettingsPage';
import { SmsSettingsPage } from './pages/settings/SmsSettingsPage';
import { Conversations } from './pages/crm/Conversations';
import { AiSdrAgentBuilder } from './pages/crm/AiSdrAgentBuilder';
import { AiSdrAgentDetail } from './pages/crm/AiSdrAgentDetail';
import { Integrations } from './pages/crm/Integrations';
import { AddConnection } from './pages/crm/AddConnection';

import { TaskList } from './pages/tasks/TaskList';
import { TaskBoard } from './pages/tasks/TaskBoard';
import { TaskDetail } from './pages/tasks/TaskDetail';
import { TaskForm } from './pages/tasks/TaskForm';

import { ProjectList } from './pages/projects/ProjectList';
import { AddProject } from './pages/projects/AddProject';
import { ProjectDetail } from './pages/projects/ProjectDetail';

import { PropertyList } from './pages/properties/PropertyList';
import { AddProperty } from './pages/properties/AddProperty';
import { PlotHoldList } from './pages/properties/PlotHoldList';
import { BulkPriceUpdate } from './pages/properties/BulkPriceUpdate';
import { PlotMapSelect } from './pages/properties/PlotMapSelect';
import { PlotMap } from './pages/properties/PlotMap';

import { BookingList } from './pages/bookings/BookingList';
import { BookingDetail } from './pages/bookings/BookingDetail';
import { RemainingPayments } from './pages/bookings/RemainingPayments';

import { Transactions } from './pages/transactions/Transactions';

import { InvestmentList } from './pages/investments/InvestmentList';

import { WalletApprovals } from './pages/wallet/WalletApprovals';
import { KycApprovals } from './pages/wallet/KycApprovals';

import { IncentiveRequestList } from './pages/incentives/IncentiveRequestList';

import { EmployeeList } from './pages/users/EmployeeList';
import { LeaderList } from './pages/users/LeaderList';
import { TeamLeaderList } from './pages/users/TeamLeaderList';
import { TeamLeaders } from './pages/crm/TeamLeaders';
import { TeamHierarchy } from './pages/crm/TeamHierarchy';
import { SiteVisits } from './pages/crm/SiteVisits';
import { Telecallers } from './pages/crm/Telecallers';
import { ConstructionHome } from './pages/construction/ConstructionHome';
import { ConstructionProject } from './pages/construction/ConstructionProject';
import { ReviewUpdates } from './pages/construction/ReviewUpdates';
import { OpsRules } from './pages/automation/OpsRules';
import { SalesPolicySettings } from './pages/settings/SalesPolicySettings';
import { Cancellations } from './pages/bookings/Cancellations';
import { Cameras } from './pages/cameras/Cameras';
import { CameraDetail } from './pages/cameras/CameraDetail';
import { LegalFiles } from './pages/legal/LegalFiles';
import { LegalFileDetail } from './pages/legal/LegalFileDetail';
import { Compliance } from './pages/legal/Compliance';
import { Disputes } from './pages/legal/Disputes';
import { Templates } from './pages/legal/Templates';
import { Vendors } from './pages/vendors/Vendors';
import { VendorDetail } from './pages/vendors/VendorDetail';
import { Materials } from './pages/vendors/Materials';
import { VendorBills } from './pages/vendors/VendorBills';
import { VendorOnly } from './pages/vendorPortal/VendorOnly';
import { Assistant } from './pages/assistant/Assistant';
import { ChannelPartners } from './pages/partners/ChannelPartners';
import { ChannelPartnerDetail } from './pages/partners/ChannelPartnerDetail';
import { PartnerOnly, PartnerHome, PartnerBookings, PartnerBrokerage, PartnerDisputes } from './pages/partnerPortal/PartnerPortal';
import { PortalViewShell } from './pages/vendorPortal/PortalViewShell';
import { PortalHome } from './pages/vendorPortal/PortalHome';
import { PortalMaterial } from './pages/vendorPortal/PortalMaterial';
import { PortalBills } from './pages/vendorPortal/PortalBills';
import { SiteIssues } from './pages/construction/SiteIssues';
import { UserDetail } from './pages/users/UserDetail';

import { TeamsOverview } from './pages/teams/TeamsOverview';
import { TeamDetail } from './pages/teams/TeamDetail';

import { AttendanceToday } from './pages/attendance/AttendanceToday';
import { AttendanceHistory } from './pages/attendance/AttendanceHistory';
import { AttendanceDetail } from './pages/attendance/AttendanceDetail';
import { AttendanceCorrections } from './pages/attendance/AttendanceCorrections';
import { AttendanceReports } from './pages/attendance/AttendanceReports';
import { Holidays } from './pages/hr/Holidays';

import { PayoutList } from './pages/payouts/PayoutList';
import { PayoutDetail } from './pages/payouts/PayoutDetail';
import { CommissionStatements } from './pages/payouts/CommissionStatements';

import { TicketList } from './pages/support/TicketList';
import { TicketDetail } from './pages/support/TicketDetail';

import { Notifications } from './pages/notifications/Notifications';
import { LeaveRequests } from './pages/hr/LeaveRequests';
import { LeaveSettings } from './pages/hr/LeaveSettings';
import { Payroll } from './pages/hr/Payroll';
import { WhatsAppTemplates } from './pages/notifications/WhatsAppTemplates';

import { ReportsHome } from './pages/reports/ReportsHome';
import { ProjectReportPage } from './pages/reports/ProjectReportPage';
import { PropertyReport } from './pages/reports/PropertyReport';
import { BookingReport } from './pages/reports/BookingReport';
import { PaymentReport } from './pages/reports/PaymentReport';
import { PartnerReport } from './pages/reports/PartnerReport';
import { TeamReport } from './pages/reports/TeamReport';
import { AttendanceReport } from './pages/reports/AttendanceReport';
import { SupportReport } from './pages/reports/SupportReport';
import { PayoutReport } from './pages/reports/PayoutReport';

import { OrganizationSettings } from './pages/settings/OrganizationSettings';
import { BusinessHoursSettings } from './pages/settings/BusinessHoursSettings';
import { RolesSettings } from './pages/settings/RolesSettings';
import { PanelUsersSettings } from './pages/settings/PanelUsersSettings';
import { AttendancePolicySettings } from './pages/settings/AttendancePolicySettings';
import { NotificationSettings } from './pages/settings/NotificationSettings';
import { AdminProfileSettings } from './pages/settings/AdminProfileSettings';
import { SecuritySettings } from './pages/settings/SecuritySettings';
import { ScheduleManage } from './pages/settings/ScheduleManage';
import { ReferralCommissionSettings } from './pages/settings/ReferralCommissionSettings';
import { BadgeSettings } from './pages/settings/BadgeSettings';
import { AuditLogPage } from './pages/audit/AuditLogPage';

import { NotFound } from './pages/NotFound';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <UIProvider>
            <ReferenceDataProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              {/* Visitor-facing lead capture — no auth, no admin chrome. */}
              <Route path="/f/:slug" element={<PublicForm />} />
              {/* A plot map shared with a buyer. No session, so it sits outside the admin layout. */}
              <Route path="/m/:token" element={<PublicPlotMap />} />
              <Route path="/" element={<Navigate to="/dashboard" replace />} />

              <Route
                element={
                  <ProtectedRoute>
                    <AdminLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="/dashboard" element={<Dashboard />} />

                <Route path="/crm" element={<CrmOverview />} />
                <Route path="/crm/leads" element={<LeadList />} />
                <Route path="/crm/leads/new" element={<AddLead />} />
                <Route path="/crm/leads/import" element={<ImportLeads />} />
                <Route path="/crm/leads/:id" element={<LeadDetail />} />
                <Route path="/crm/pipeline" element={<Pipelines />} />
                <Route path="/crm/pipeline/kanban" element={<PipelineBoard />} />
                <Route path="/crm/follow-ups" element={<FollowUps />} />
                <Route path="/crm/calendar" element={<TaskCalendar />} />
                <Route path="/crm/forms" element={<Forms />} />
                <Route path="/crm/forms/new" element={<FormBuilder />} />
                <Route path="/crm/forms/:id" element={<FormView />} />
                <Route path="/crm/forms/:id/edit" element={<FormBuilder />} />
                <Route path="/crm/report-center" element={<ReportCenter />} />
                <Route path="/crm/activities" element={<LeadActivities />} />
                <Route path="/crm/automation" element={<Automations />} />
                <Route path="/crm/automation/new" element={<AutomationBuilder />} />
                <Route path="/crm/automation/:id/edit" element={<AutomationBuilder />} />
                <Route path="/ops-rules" element={<OpsRules />} />
                <Route path="/cameras" element={<Cameras />} />
                <Route path="/cameras/flagged" element={<CameraDetail flaggedOnly />} />
                <Route path="/cameras/:id" element={<CameraDetail />} />
                <Route path="/legal" element={<LegalFiles />} />
                <Route path="/legal/files/:id" element={<LegalFileDetail />} />
                <Route path="/legal/compliance" element={<Compliance />} />
                <Route path="/legal/disputes" element={<Disputes />} />
                <Route path="/legal/templates" element={<Templates />} />
                <Route path="/vendors" element={<Vendors />} />
                <Route path="/vendors/material" element={<Materials />} />
                <Route path="/vendors/bills" element={<VendorBills />} />
                <Route path="/vendors/:id" element={<VendorDetail />} />
                <Route path="/vendors/:id/portal" element={<PortalViewShell />}>
                  <Route index element={<PortalHome />} />
                  <Route path="material" element={<PortalMaterial />} />
                  <Route path="bills" element={<PortalBills />} />
                </Route>
                <Route path="/assistant" element={<Assistant />} />
                <Route path="/channel-partners" element={<ChannelPartners />} />
                <Route path="/channel-partners/:id" element={<ChannelPartnerDetail />} />
                <Route path="/partner-portal" element={<PartnerOnly><PartnerHome /></PartnerOnly>} />
                <Route path="/partner-portal/bookings" element={<PartnerOnly><PartnerBookings /></PartnerOnly>} />
                <Route path="/partner-portal/brokerage" element={<PartnerOnly><PartnerBrokerage /></PartnerOnly>} />
                <Route path="/partner-portal/disputes" element={<PartnerOnly><PartnerDisputes /></PartnerOnly>} />
                <Route path="/vendor-portal" element={<VendorOnly><PortalHome /></VendorOnly>} />
                <Route path="/vendor-portal/material" element={<VendorOnly><PortalMaterial /></VendorOnly>} />
                <Route path="/vendor-portal/bills" element={<VendorOnly><PortalBills /></VendorOnly>} />
                <Route path="/construction" element={<ConstructionHome />} />
                <Route path="/construction/reviews" element={<ReviewUpdates />} />
                <Route path="/construction/issues" element={<SiteIssues />} />
                <Route path="/construction/:id" element={<ConstructionProject />} />
                <Route path="/crm/site-visits" element={<SiteVisits />} />
                <Route path="/crm/telecallers" element={<Telecallers />} />
                <Route path="/crm/team-leaders" element={<TeamLeaders />} />
                <Route path="/crm/hierarchy" element={<TeamHierarchy />} />
                <Route path="/crm/sdr-agents" element={<AiSdrAgents />} />
                <Route path="/crm/sdr-agents/new" element={<AiSdrAgentBuilder />} />
                <Route path="/crm/sdr-agents/:id" element={<AiSdrAgentDetail />} />
                <Route path="/crm/sdr-agents/:id/edit" element={<AiSdrAgentBuilder />} />
                <Route path="/crm/email-sequences" element={<EmailSequences />} />
                <Route path="/crm/email-sequences/new" element={<EmailSequenceBuilder />} />
                <Route path="/crm/email-sequences/:id" element={<EmailSequenceDetail />} />
                <Route path="/crm/email-sequences/:id/edit" element={<EmailSequenceBuilder />} />
                <Route path="/crm/calls" element={<CallHistory />} />
                <Route path="/crm/conversations" element={<Conversations />} />
                <Route path="/crm/integrations" element={<Integrations />} />
                <Route path="/crm/integrations/new" element={<AddConnection />} />

                {/* Tasks. `/tasks/new` is declared before `/tasks/:id` so "new" is not read as an id. */}
                <Route path="/tasks" element={<TaskList />} />
                <Route path="/tasks/board" element={<TaskBoard />} />
                <Route path="/tasks/mine" element={<TaskList mineOnly />} />
                <Route path="/tasks/new" element={<TaskForm />} />
                <Route path="/tasks/:id" element={<TaskDetail />} />
                <Route path="/tasks/:id/edit" element={<TaskForm />} />

                <Route path="/projects" element={<ProjectList />} />
                <Route path="/projects/new" element={<AddProject />} />
                <Route path="/projects/:id" element={<ProjectDetail />} />

                <Route path="/properties" element={<PropertyList />} />
                <Route path="/properties/running" element={<PropertyList filter="running" />} />
                <Route path="/properties/sold-out" element={<PropertyList filter="sold-out" />} />
                <Route path="/properties/booked" element={<PropertyList filter="booked" />} />
                <Route path="/properties/new" element={<AddProperty />} />
                <Route path="/properties/holds" element={<PlotHoldList />} />
                <Route path="/properties/map" element={<PlotMapSelect />} />
                <Route path="/properties/map/:projectId" element={<PlotMap />} />
                <Route path="/properties/bulk-price-update" element={<BulkPriceUpdate />} />

                <Route path="/bookings" element={<BookingList />} />
                <Route path="/bookings/pending" element={<BookingList statusFilter="pending" />} />
                <Route path="/bookings/booked" element={<BookingList statusFilter="confirmed" />} />
                <Route path="/bookings/remaining" element={<RemainingPayments />} />
                <Route path="/bookings/:id" element={<BookingDetail />} />

                <Route path="/transactions" element={<Transactions />} />

                <Route path="/investments" element={<InvestmentList />} />
                <Route path="/investments/running" element={<InvestmentList filter="running" />} />
                <Route path="/investments/due" element={<InvestmentList filter="due" />} />
                <Route path="/investments/expired" element={<InvestmentList filter="expired" />} />
                <Route path="/investments/completed" element={<InvestmentList filter="completed" />} />

                <Route path="/wallet/approvals" element={<WalletApprovals />} />
                <Route path="/wallet/kyc" element={<KycApprovals />} />

                <Route path="/incentive-requests" element={<IncentiveRequestList />} />

                <Route path="/users/agents" element={<Navigate to="/channel-partners" replace />} />
                <Route path="/users/employees" element={<EmployeeList />} />
                <Route path="/users/leaders" element={<LeaderList />} />
                <Route path="/users/team-leaders" element={<TeamLeaderList />} />
                <Route path="/users/:id" element={<UserDetail />} />

                <Route path="/teams" element={<TeamsOverview />} />
                <Route path="/teams/:id" element={<TeamDetail />} />

                <Route path="/attendance/today" element={<AttendanceToday />} />
                <Route path="/attendance/history" element={<AttendanceHistory />} />
                <Route path="/attendance/corrections" element={<AttendanceCorrections />} />
                <Route path="/attendance/reports" element={<AttendanceReports />} />
                <Route path="/attendance/holidays" element={<Holidays />} />
                <Route path="/attendance/:id" element={<AttendanceDetail />} />

                <Route path="/payouts" element={<PayoutList />} />
                <Route path="/payouts/statements" element={<CommissionStatements />} />
                <Route path="/payouts/:id" element={<PayoutDetail />} />

                <Route path="/support" element={<TicketList />} />
                <Route path="/support/:id" element={<TicketDetail />} />

                <Route path="/attendance/leave" element={<LeaveRequests />} />
                <Route path="/attendance/leave-types" element={<LeaveSettings />} />
                <Route path="/payouts/payroll" element={<Payroll />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/notifications/whatsapp" element={<WhatsAppTemplates />} />

                <Route path="/reports" element={<ReportsHome />} />
                <Route path="/reports/suite/:key" element={<ProjectReportPage />} />
                <Route path="/reports/properties" element={<PropertyReport />} />
                <Route path="/reports/bookings" element={<BookingReport />} />
                <Route path="/reports/payments" element={<PaymentReport />} />
                <Route path="/reports/partners" element={<PartnerReport />} />
                <Route path="/reports/teams" element={<TeamReport />} />
                <Route path="/reports/attendance" element={<AttendanceReport />} />
                <Route path="/reports/support" element={<SupportReport />} />
                <Route path="/reports/payouts" element={<PayoutReport />} />

                <Route path="/settings/organization" element={<OrganizationSettings />} />
                <Route path="/settings/business-hours" element={<BusinessHoursSettings />} />
                <Route path="/settings/roles" element={<RolesSettings />} />
                <Route path="/settings/panel-users" element={<PanelUsersSettings />} />
                <Route path="/settings/telephony" element={<TelephonySettingsPage />} />
                <Route path="/settings/email" element={<EmailSettingsPage />} />
                <Route path="/settings/whatsapp" element={<WhatsAppSettingsPage />} />
                <Route path="/settings/sms" element={<SmsSettingsPage />} />
                <Route path="/settings/attendance" element={<AttendancePolicySettings />} />
                <Route path="/settings/notifications" element={<NotificationSettings />} />
                <Route path="/settings/profile" element={<AdminProfileSettings />} />
                <Route path="/settings/security" element={<SecuritySettings />} />
                <Route path="/settings/schedules" element={<ScheduleManage />} />
                <Route path="/settings/referral-commission" element={<ReferralCommissionSettings />} />
                <Route path="/settings/sales-policy" element={<SalesPolicySettings />} />
                <Route path="/bookings/cancellations" element={<Cancellations />} />
                <Route path="/settings/badges" element={<BadgeSettings />} />
                <Route path="/settings/audit-log" element={<AuditLogPage />} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
            </ReferenceDataProvider>
          </UIProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
