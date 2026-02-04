import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import ProviderDashboard from "./pages/ProviderDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import TaskDetailView from "./pages/TaskDetailView";
import ProvidersListPage from "./pages/ProvidersListPage";
import StateConfigPage from "./pages/StateConfigPage";
import CollaborativeAgreementsPage from "./pages/CollaborativeAgreementsPage";
import CompliancePage from "./pages/CompliancePage";
import ProviderIntakePage from "./pages/ProviderIntakePage";
import PhysicianPortal from "./pages/PhysicianPortal";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/provider" element={<ProviderDashboard />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/task/:taskId" element={<TaskDetailView />} />
          <Route path="/providers" element={<ProvidersListPage />} />
          <Route path="/admin/states" element={<StateConfigPage />} />
          <Route path="/admin/agreements" element={<CollaborativeAgreementsPage />} />
          <Route path="/admin/compliance" element={<CompliancePage />} />
          <Route path="/admin/intake" element={<ProviderIntakePage />} />
          <Route path="/physician" element={<PhysicianPortal />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
