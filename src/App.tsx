import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
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
import DataImportPage from "./pages/DataImportPage";
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
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
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
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
