import { useAuth } from '@/hooks/useAuth';
import { AppSidebar } from '@/components/AppSidebar';
import { ProviderStateGrid } from '@/components/grid/ProviderStateGrid';
import { useRealGridData } from '@/hooks/useRealGridData';
import { useActivationStats } from '@/hooks/useProviderStateStatus';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  ShieldAlert,
  ArrowRight,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function ProviderStateGridPage() {
  const { profile, roles } = useAuth();
  const { data: gridData, isLoading, refetch, isRefetching } = useRealGridData();
  const { data: stats, isLoading: statsLoading } = useActivationStats();
  
  const userRole = roles.includes('admin') ? 'admin' : 
                   roles.includes('leadership') ? 'leadership' : 
                   roles.includes('physician') ? 'physician' : 'provider';

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar 
        userRole={userRole}
        userName={profile?.full_name || 'User'}
        userEmail={profile?.email || ''}
        userAvatarUrl={profile?.avatar_url || undefined}
      />
      
      <main className="ml-16 lg:ml-64 transition-all duration-300 min-w-0">
        <div className="p-4 md:p-6 lg:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold">Provider–State Grid</h1>
              <p className="text-muted-foreground mt-1">
                Real-time licensure and credentialing status from provider directory
              </p>
            </div>
            
            <div className="flex items-center gap-4">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => refetch()}
                disabled={isRefetching}
              >
                <RefreshCw className={cn("h-4 w-4 mr-2", isRefetching && "animate-spin")} />
                Refresh
              </Button>

              {/* Quick Stats linking to Activation Queue */}
              {!statsLoading && stats && (stats.activeButNotReady > 0 || stats.inactiveAndReady > 0) && (
                <Link 
                  to="/admin/activation" 
                  className="flex items-center gap-4 p-3 border rounded-lg bg-card hover:bg-muted/50 transition-colors"
                >
                  {stats.activeButNotReady > 0 && (
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="h-5 w-5 text-destructive" />
                      <div>
                        <p className="text-sm font-medium text-destructive">
                          {stats.activeButNotReady} Critical
                        </p>
                        <p className="text-xs text-muted-foreground">Active but not ready</p>
                      </div>
                    </div>
                  )}
                  {stats.inactiveAndReady > 0 && (
                    <div className="flex items-center gap-2">
                      <Clock className="h-5 w-5 text-info" />
                      <div>
                        <p className="text-sm font-medium text-info">
                          {stats.inactiveAndReady} Pending
                        </p>
                        <p className="text-xs text-muted-foreground">Ready but inactive</p>
                      </div>
                    </div>
                  )}
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              )}
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-3 text-muted-foreground">Loading provider data...</span>
            </div>
          ) : gridData ? (
            <ProviderStateGrid data={gridData} />
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">No provider data available</p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
