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
import ProvidersListPage from "./pages/ProvidersListPage";
import StateConfigPage from "./pages/StateConfigPage";
import CollaborativeAgreementsPage from "./pages/CollaborativeAgreementsPage";
import CompliancePage from "./pages/CompliancePage";
import ProviderIntakePage from "./pages/ProviderIntakePage";
import PhysicianPortal from "./pages/PhysicianPortal";
import KnowledgeBasePage from "./pages/KnowledgeBasePage";
import ProviderOnboardingPage from "./pages/ProviderOnboardingPage";
import UserRolesPage from "./pages/UserRolesPage";
import ProfileSettingsPage from "./pages/ProfileSettingsPage";
import ProviderStateGridPage from "./pages/ProviderStateGridPage";
import ProviderDirectoryPage from "./pages/ProviderDirectoryPage";
import DataImportPage from "./pages/DataImportPage";
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
              <ProtectedRoute requiredRoles={['admin']}>
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
                <ProvidersListPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/states" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <StateConfigPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/agreements" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <CollaborativeAgreementsPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/compliance" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <CompliancePage />
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
              <ProtectedRoute requiredRoles={['admin', 'leadership']}>
                <ProviderStateGridPage />
              </ProtectedRoute>
            } />
            <Route path="/directory" element={
              <ProtectedRoute>
                <ProviderDirectoryPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/import" element={
              <ProtectedRoute requiredRoles={['admin']}>
                <DataImportPage />
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
