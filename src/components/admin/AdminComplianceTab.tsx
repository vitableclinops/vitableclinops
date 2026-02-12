import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Users, FileText, ShieldCheck, Calendar, ChevronRight } from 'lucide-react';
import type { DashboardStats } from '@/hooks/useAdminDashboard';

interface AdminComplianceTabProps {
  stats: DashboardStats;
}

export function AdminComplianceTab({ stats }: AdminComplianceTabProps) {
  const navigate = useNavigate();

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-primary" />
            Internal Provider Compliance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Compliance is monitored for all internal (W2 and 1099) providers. Agency-supplied providers are managed externally.
          </p>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-4 rounded-lg bg-primary/5 border">
              <p className="text-2xl font-bold text-primary">{stats.totalInternalProviders}</p>
              <p className="text-xs text-muted-foreground mt-1">Internal Providers</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50 border">
              <p className="text-2xl font-bold">{stats.w2Count}</p>
              <p className="text-xs text-muted-foreground mt-1">W2 Employees</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50 border">
              <p className="text-2xl font-bold">{stats.contractorCount}</p>
              <p className="text-xs text-muted-foreground mt-1">1099 Contractors</p>
            </div>
          </div>
          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border text-sm">
            <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">
              {stats.agencyCount} agency-supplied provider{stats.agencyCount !== 1 ? 's' : ''} excluded from internal compliance tracking.
            </span>
          </div>
          <Button variant="outline" className="w-full" onClick={() => navigate('/admin/directory')}>
            View Provider Directory
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-primary" />
            Agreement Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-success" />
                <span className="text-sm">Active Agreements</span>
              </div>
              <span className="text-sm font-bold">{stats.activeAgreements}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground" />
                <span className="text-sm">Draft</span>
              </div>
              <span className="text-sm font-bold">{stats.draftAgreements}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-warning" />
                <span className="text-sm">Pending Setup / Verification</span>
              </div>
              <span className="text-sm font-bold">{stats.pendingSetupAgreements}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                <span className="text-sm">Active Transfers</span>
              </div>
              <span className="text-sm font-bold">{stats.activeTransfers}</span>
            </div>
            {stats.upcomingRenewals > 0 && (
              <div className="flex items-center justify-between p-3 rounded-lg border border-warning/30 bg-warning/5">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-warning" />
                  <span className="text-sm">Renewals (next 90 days)</span>
                </div>
                <span className="text-sm font-bold text-warning">{stats.upcomingRenewals}</span>
              </div>
            )}
          </div>
          <Button variant="outline" className="w-full" onClick={() => navigate('/admin/agreements')}>
            Manage Agreements
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
