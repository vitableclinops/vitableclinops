import { 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  Users, 
  CheckCircle,
  AlertTriangle,
  FileText,
  Calendar
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  providers, 
  collaborativeAgreements, 
  selfReportedLicenses,
  getAllTasks,
  states
} from '@/data/mockData';

interface Metric {
  label: string;
  value: number | string;
  change?: number;
  changeLabel?: string;
  icon: typeof TrendingUp;
  color: string;
  subtext?: string;
}

export function OperationalMetrics() {
  // Calculate real metrics from mock data
  const allTasks = getAllTasks();
  const pendingTasks = allTasks.filter(t => t.status === 'in_progress' || t.status === 'submitted');
  const blockedTasks = allTasks.filter(t => t.status === 'blocked');
  const pendingVerifications = selfReportedLicenses.filter(l => l.verificationStatus === 'pending');
  const activeAgreements = collaborativeAgreements.filter(a => a.status === 'active');
  const pendingRenewalAgreements = collaborativeAgreements.filter(a => a.status === 'pending_renewal');
  
  const providersReadyForActivation = providers.filter(p => 
    p.states.some(s => s.isReadyForActivation)
  ).length;
  
  const criticalStates = states.filter(s => s.demandTag === 'critical');
  const atRiskStates = states.filter(s => s.demandTag === 'at_risk');
  
  const complianceRate = providers.filter(p => p.complianceStatus?.isCompliant).length / providers.length * 100;
  
  const metrics: Metric[] = [
    {
      label: 'Active Providers',
      value: providers.length,
      icon: Users,
      color: 'text-blue-500',
      subtext: `${providersReadyForActivation} ready for activation`,
    },
    {
      label: 'Pending Tasks',
      value: pendingTasks.length,
      change: -3,
      changeLabel: 'from last week',
      icon: FileText,
      color: 'text-amber-500',
      subtext: `${blockedTasks.length} blocked`,
    },
    {
      label: 'Verifications Queue',
      value: pendingVerifications.length,
      icon: CheckCircle,
      color: 'text-green-500',
      subtext: 'Avg. 2.5 days to verify',
    },
    {
      label: 'Active Agreements',
      value: activeAgreements.length,
      icon: Calendar,
      color: 'text-purple-500',
      subtext: `${pendingRenewalAgreements.length} pending renewal`,
    },
  ];
  
  return (
    <div className="space-y-4">
      {/* Top Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map(metric => {
          const Icon = metric.icon;
          return (
            <Card key={metric.label}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{metric.label}</p>
                    <p className="text-2xl font-bold mt-1">{metric.value}</p>
                    {metric.subtext && (
                      <p className="text-xs text-muted-foreground mt-1">{metric.subtext}</p>
                    )}
                  </div>
                  <div className={`p-2 rounded-lg bg-muted ${metric.color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
                {metric.change !== undefined && (
                  <div className="flex items-center gap-1 mt-2">
                    {metric.change > 0 ? (
                      <TrendingUp className="h-3 w-3 text-green-500" />
                    ) : (
                      <TrendingDown className="h-3 w-3 text-red-500" />
                    )}
                    <span className={`text-xs ${metric.change > 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {metric.change > 0 ? '+' : ''}{metric.change} {metric.changeLabel}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      
      {/* Compliance & State Demand */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Provider Compliance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Overall Compliance Rate</span>
                <span className="font-semibold">{complianceRate.toFixed(0)}%</span>
              </div>
              <Progress value={complianceRate} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{providers.filter(p => p.complianceStatus?.isCompliant).length} compliant</span>
                <span>{providers.filter(p => !p.complianceStatus?.isCompliant).length} non-compliant</span>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">State Demand Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {criticalStates.length > 0 && (
                <div className="flex items-center gap-2">
                  <Badge className="bg-red-500 text-white">
                    {criticalStates.length} Critical
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {criticalStates.map(s => s.abbreviation).join(', ')}
                  </span>
                </div>
              )}
              {atRiskStates.length > 0 && (
                <div className="flex items-center gap-2">
                  <Badge className="bg-amber-500 text-white">
                    {atRiskStates.length} At Risk
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {atRiskStates.map(s => s.abbreviation).join(', ')}
                  </span>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Demand tags help prioritize licensure and agreement work based on organizational expansion needs.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
