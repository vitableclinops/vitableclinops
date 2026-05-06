import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import { toast } from "sonner";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import AuthPage from "./pages/AuthPage";
import ProviderDashboard from "./pages/ProviderDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import TaskDetailView from "./pages/TaskDetailView";

import StateCompliancePage from "./pages/StateCompliancePage";
import CollaborativeAgreementsPage from "./pages/CollaborativeAgreementsPage";
import SystemSettingsPage from "./pages/SystemSettingsPage";
import ProviderIntakePage from "./pages/ProviderIntakePage";
import PhysicianPortal from "./pages/PhysicianPortal";
import KnowledgeBasePage from "./pages/KnowledgeBasePage";
import ProviderOnboardingPage from "./pages/ProviderOnboardingPage";
import UserRolesPage from "./pages/UserRolesPage";
import ProfileSettingsPage from "./pages/ProfileSettingsPage";
import ProviderStateGridPage from "./pages/ProviderStateGridPage";
import ProviderDirectoryPage from "./pages/ProviderDirectoryPage";
import StateDetailPage from "./pages/StateDetailPage";
import AgreementDetailPage from "./pages/AgreementDetailPage";
import PhysicianDetailPage from "./pages/PhysicianDetailPage";
import ActivationQueuePage from "./pages/ActivationQueuePage";
import ReimbursementsPage from "./pages/ReimbursementsPage";
import AgencyManagementPage from "./pages/AgencyManagementPage";
import AgencyDetailPage from "./pages/AgencyDetailPage";
import EnhancementRegistryPage from "./pages/EnhancementRegistryPage";
import CalendarPage from "./pages/CalendarPage";
import AdminAddProviderPage from "./pages/AdminAddProviderPage";
import LicensureApplicationPage from "./pages/LicensureApplicationPage";
import TaskRepositoryPage from "./pages/TaskRepositoryPage";
import MyLicensesPage from "./pages/MyLicensesPage";
import MyPodPage from "./pages/MyPodPage";
import HiringPipelinePage from "./pages/HiringPipelinePage";
import LicenseOptimizerPage from "./pages/LicenseOptimizerPage";
import OpsDashboardPage from "./pages/OpsDashboardPage";
import CoverageCopilotPage from "./pages/CoverageCopilotPage";
import DemandForecastPage from "./pages/DemandForecastPage";
import MonthlyForecastPage from "./pages/MonthlyForecastPage";
import ShiftPlanPage from "./pages/ShiftPlanPage";
import WorkbenchPage from "./pages/WorkbenchPage";
import UtilizationPage from "./pages/UtilizationPage";
import RoutingIntelligencePage from "./pages/RoutingIntelligencePage";
import DemandMatchingEnginePage from "./pages/DemandMatchingEnginePage";
import ContractorStrategyPage from "./pages/ContractorStrategyPage";
import DataQualityPage from "./pages/DataQualityPage";
import SlaAggregatePage from "./pages/SlaAggregatePage";
import TelemedicineAvailabilityPage from "./pages/TelemedicineAvailabilityPage";
import PCPCoveragePage from "./pages/PCPCoveragePage";
import ProviderAppointmentsPage from "./pages/ProviderAppointmentsPage";
import ExecutiveBriefingPage from "./pages/ExecutiveBriefingPage";
import UsabilityGuidePage from "./pages/UsabilityGuidePage";
import NotFound from "./pages/NotFound";
import SchedulingWorkbenchPage from "./pages/scheduling/SchedulingWorkbenchPage";
import SchedulingForecastPage from "./pages/scheduling/SchedulingForecastPage";
import JuneMvpPage from "./pages/scheduling/JuneMvpPage";

const queryClient = new QueryClient();

const ROUTE_TITLES: Array<{ match: (p: string) => boolean; title: string }> = [
  { match: p => p === '/auth', title: 'Sign in' },
  { match: p => p === '/' || p === '/admin', title: 'Dashboard' },
  { match: p => p === '/provider', title: 'My Dashboard' },
  { match: p => p === '/physician', title: 'Physician Portal' },
  { match: p => p.startsWith('/task/'), title: 'Task' },
  { match: p => p === '/providers' || p === '/directory', title: 'Provider Directory' },
  { match: p => p === '/admin/intake', title: 'Provider Intake' },
  { match: p => p === '/admin/add-provider', title: 'Add Provider' },
  { match: p => p === '/grid', title: 'Provider Grid' },
  { match: p => p === '/admin/activation', title: 'Activation Queue' },
  { match: p => p === '/admin/states', title: 'States & Compliance' },
  { match: p => p.startsWith('/states/'), title: 'State detail' },
  { match: p => p === '/admin/agreements', title: 'Collaborative Agreements' },
  { match: p => p.startsWith('/admin/agreements/'), title: 'Agreement' },
  { match: p => p === '/admin/license-optimizer', title: 'License Optimizer' },
  { match: p => p === '/admin/data-quality', title: 'Data Quality' },
  { match: p => p === '/admin/executive-briefing', title: 'Executive Briefing' },
  { match: p => p === '/admin/ops', title: 'Coverage Hub' },
  { match: p => p === '/admin/coverage-copilot', title: 'Coverage Copilot' },
  { match: p => p === '/admin/utilization', title: 'Utilization' },
  { match: p => p === '/admin/routing', title: 'Routing Intelligence' },
  { match: p => p === '/admin/matching', title: 'Demand Matching' },
  { match: p => p === '/admin/demand-forecast', title: 'Demand Forecast' },
  { match: p => p === '/admin/monthly-forecast', title: 'Monthly Forecast' },
  { match: p => p === '/admin/shift-plan', title: 'Shift Plan' },
  { match: p => p === '/admin/workbench', title: 'Workbench' },
  { match: p => p === '/scheduling' || p === '/scheduling/workbench', title: 'Scheduling Workbench' },
  { match: p => p === '/scheduling/forecast', title: 'Scheduling Forecast' },
  { match: p => p === '/scheduling/june-mvp', title: 'June MVP' },
  { match: p => p === '/admin/contractor-strategy', title: 'Contractor Strategy' },
  { match: p => p === '/admin/sla-aggregate', title: 'SLA Aggregate' },
  { match: p => p === '/admin/tasks', title: 'Task Repository' },
  { match: p => p === '/admin/reimbursements', title: 'Reimbursements' },
  { match: p => p === '/admin/agencies', title: 'Agencies' },
  { match: p => p.startsWith('/admin/agencies/'), title: 'Agency' },
  { match: p => p === '/admin/hiring', title: 'Hiring Pipeline' },
  { match: p => p === '/admin/calendar', title: 'Calendar' },
  { match: p => p === '/knowledge', title: 'Knowledge Base' },
  { match: p => p === '/enhancements', title: 'Enhancement Registry' },
  { match: p => p === '/provider/licenses', title: 'My Licenses' },
  { match: p => p.startsWith('/licensure/'), title: 'Licensure Application' },
  { match: p => p === '/provider/pod', title: 'My Pod' },
  { match: p => p === '/onboarding', title: 'Onboarding' },
  { match: p => p === '/admin/roles', title: 'User Roles' },
  { match: p => p === '/admin/settings', title: 'System Settings' },
  { match: p => p === '/profile/settings', title: 'Profile Settings' },
];

const BASE_TITLE = 'Vitable Ops';

function DocumentTitleWatcher() {
  const location = useLocation();
  useEffect(() => {
    const entry = ROUTE_TITLES.find(r => r.match(location.pathname));
    document.title = entry ? `${entry.title} · ${BASE_TITLE}` : BASE_TITLE;
  }, [location.pathname]);
  return null;
}

function SessionExpiredWatcher() {
  const { sessionExpired, clearSessionExpired } = useAuth();
  useEffect(() => {
    if (!sessionExpired) return;
    toast.warning('Session expired', {
      description: 'Your session has ended. Please sign in again. Any in-progress form data will be restored.',
      duration: 8000,
    });
    clearSessionExpired();
  }, [sessionExpired, clearSessionExpired]);
  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <DocumentTitleWatcher />
          <SessionExpiredWatcher />
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/" element={
              <ProtectedRoute>
                <Index />
              </ProtectedRoute>
            } />
            <Route path="/provider" element={
              <ProtectedRoute>
                <ProviderDashboard />
              </ProtectedRoute>
            } />
            <Route path="/admin" element={
              <ProtectedRoute requiredRoles={['admin', 'pod_lead']}>
                <AdminDashboard />
              </ProtectedRoute>
            } />
            <Route path="/task/:taskId" element={
              <ProtectedRoute>
                <TaskDetailView />
              </ProtectedRoute>
            } />
            <Route path="/providers" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <ProviderDirectoryPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/states" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <StateCompliancePage />
              </ProtectedRoute>
            } />
            <Route path="/admin/agreements" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <CollaborativeAgreementsPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/settings" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <SystemSettingsPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/intake" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <ProviderIntakePage />
              </ProtectedRoute>
            } />
            <Route path="/physician" element={
              <ProtectedRoute requiredRoles={['physician']}>
                <PhysicianPortal />
              </ProtectedRoute>
            } />
            <Route path="/knowledge" element={
              <ProtectedRoute>
                <KnowledgeBasePage />
              </ProtectedRoute>
            } />
            <Route path="/onboarding" element={
              <ProtectedRoute>
                <ProviderOnboardingPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/roles" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <UserRolesPage />
              </ProtectedRoute>
            } />
            <Route path="/profile/settings" element={
              <ProtectedRoute>
                <ProfileSettingsPage />
              </ProtectedRoute>
            } />
            <Route path="/grid" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <ProviderStateGridPage />
              </ProtectedRoute>
            } />
            <Route path="/directory" element={
              <ProtectedRoute>
                <ProviderDirectoryPage />
              </ProtectedRoute>
            } />
            {/* Data Import now in /admin/settings */}
            <Route path="/states/:stateAbbr" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <StateDetailPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/agreements/:agreementId" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <AgreementDetailPage />
              </ProtectedRoute>
            } />
            <Route path="/physicians/:physicianEmail" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <PhysicianDetailPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/activation" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <ActivationQueuePage />
              </ProtectedRoute>
            } />
            <Route path="/reimbursements" element={
              <ProtectedRoute>
                <ReimbursementsPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/agencies" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <AgencyManagementPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/agencies/:agencyId" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <AgencyDetailPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/calendar" element={
              <ProtectedRoute requiredRoles={['admin', 'pod_lead']}>
                <CalendarPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/enhancements" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <EnhancementRegistryPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/add-provider" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <AdminAddProviderPage />
              </ProtectedRoute>
            } />
            <Route path="/licensure/:applicationId" element={
              <ProtectedRoute>
                <LicensureApplicationPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/tasks" element={
              <ProtectedRoute requiredRoles={['admin', 'pod_lead']}>
                <TaskRepositoryPage />
              </ProtectedRoute>
            } />
            <Route path="/provider/licenses" element={
              <ProtectedRoute>
                <MyLicensesPage />
              </ProtectedRoute>
            } />
            <Route path="/provider/pod" element={
              <ProtectedRoute requiredRoles={['pod_lead']}>
                <MyPodPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/hiring" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <HiringPipelinePage />
              </ProtectedRoute>
            } />
            <Route path="/admin/license-optimizer" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <LicenseOptimizerPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/ops" element={
              <ProtectedRoute requiredRoles={['admin', 'pod_lead']}>
                <OpsDashboardPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/coverage-copilot" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <CoverageCopilotPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/demand-forecast" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <DemandForecastPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/monthly-forecast" element={
              <ProtectedRoute requiredRoles={['admin', 'pod_lead']}>
                <MonthlyForecastPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/shift-plan" element={
              <ProtectedRoute requiredRoles={['admin', 'pod_lead']}>
                <ShiftPlanPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/workbench" element={
              <ProtectedRoute requiredRoles={['admin', 'pod_lead']}>
                <WorkbenchPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/utilization" element={
              <ProtectedRoute requiredRoles={['admin', 'pod_lead']}>
                <UtilizationPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/routing" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <RoutingIntelligencePage />
              </ProtectedRoute>
            } />
            <Route path="/admin/matching" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <DemandMatchingEnginePage />
              </ProtectedRoute>
            } />
            <Route path="/admin/contractor-strategy" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <ContractorStrategyPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/data-quality" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <DataQualityPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/sla-aggregate" element={
              <ProtectedRoute requiredRoles={['admin', 'pod_lead']}>
                <SlaAggregatePage />
              </ProtectedRoute>
            } />
            <Route path="/admin/telemedicine-availability" element={
              <ProtectedRoute requiredRoles={['admin', 'pod_lead']}>
                <TelemedicineAvailabilityPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/pcp-coverage" element={
              <ProtectedRoute requiredRoles={['admin', 'pod_lead']}>
                <PCPCoveragePage />
              </ProtectedRoute>
            } />
            <Route path="/admin/provider-appointments" element={
              <ProtectedRoute requiredRoles={['admin', 'pod_lead']}>
                <ProviderAppointmentsPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/executive-briefing" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <ExecutiveBriefingPage />
              </ProtectedRoute>
            } />
            <Route path="/guide" element={
              <ProtectedRoute>
                <UsabilityGuidePage />
              </ProtectedRoute>
            } />
            <Route path="/scheduling" element={<Navigate to="/scheduling/workbench" replace />} />
            <Route path="/scheduling/workbench" element={
              <ProtectedRoute requiredRoles={['admin', 'scheduling']}>
                <SchedulingWorkbenchPage />
              </ProtectedRoute>
            } />
            <Route path="/scheduling/forecast" element={
              <ProtectedRoute requiredRoles={['admin', 'scheduling']}>
                <SchedulingForecastPage />
              </ProtectedRoute>
            } />
            <Route path="/scheduling/june-mvp" element={
              <ProtectedRoute requiredRoles={['admin', 'scheduling']}>
                <JuneMvpPage />
              </ProtectedRoute>
            } />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
