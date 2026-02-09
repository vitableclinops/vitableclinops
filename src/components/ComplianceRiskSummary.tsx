import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangle, CheckCircle2, ShieldAlert, Clock, Loader2 } from 'lucide-react';
import { useComplianceRiskSummary, type ComplianceStatus } from '@/hooks/useComplianceStatus';
import { cn } from '@/lib/utils';

const statusConfig: Record<ComplianceStatus, { label: string; color: string; icon: typeof AlertTriangle }> = {
  compliant: { label: 'Compliant', color: 'bg-success/10 text-success border-success/30', icon: CheckCircle2 },
  at_risk: { label: 'At Risk', color: 'bg-warning/10 text-warning border-warning/30', icon: Clock },
  non_compliant: { label: 'Non-Compliant', color: 'bg-destructive/10 text-destructive border-destructive/30', icon: AlertTriangle },
  active_but_non_compliant: { label: 'Active but Non-Compliant', color: 'bg-destructive/10 text-destructive border-destructive/30 font-semibold', icon: ShieldAlert },
  unknown: { label: 'Unknown', color: 'bg-muted text-muted-foreground', icon: Clock },
};

export function ComplianceStatusBadge({ status }: { status: ComplianceStatus }) {
  const config = statusConfig[status];
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={cn('gap-1', config.color)}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

export function ComplianceRiskSummaryCard() {
  const { data, isLoading } = useComplianceRiskSummary();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const criticalRecords = data.records.filter(
    r => r.compliance_status === 'active_but_non_compliant' || r.compliance_status === 'non_compliant'
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldAlert className="h-5 w-5" />
          Compliance Risk Summary
          <span className="text-sm font-normal text-muted-foreground">
            (W2 Providers Only)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg bg-success/5 border border-success/20 text-center">
            <p className="text-2xl font-bold text-success">{data.compliant}</p>
            <p className="text-xs text-muted-foreground">Compliant</p>
          </div>
          <div className="p-3 rounded-lg bg-warning/5 border border-warning/20 text-center">
            <p className="text-2xl font-bold text-warning">{data.at_risk}</p>
            <p className="text-xs text-muted-foreground">At Risk</p>
          </div>
          <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20 text-center">
            <p className="text-2xl font-bold text-destructive">{data.non_compliant}</p>
            <p className="text-xs text-muted-foreground">Non-Compliant</p>
          </div>
          <div className={cn(
            "p-3 rounded-lg text-center",
            data.active_but_non_compliant > 0 
              ? "bg-destructive/10 border-2 border-destructive animate-pulse" 
              : "bg-muted/50 border border-border"
          )}>
            <p className={cn("text-2xl font-bold", data.active_but_non_compliant > 0 ? "text-destructive" : "text-muted-foreground")}>
              {data.active_but_non_compliant}
            </p>
            <p className="text-xs text-muted-foreground">Active + Non-Compliant</p>
          </div>
        </div>

        {/* Critical issues list */}
        {criticalRecords.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Critical Issues</h4>
            <ScrollArea className="h-[200px]">
              <div className="space-y-2">
                {criticalRecords.slice(0, 20).map((record, idx) => (
                  <div key={idx} className={cn(
                    "flex items-center justify-between p-3 rounded-lg border",
                    record.compliance_status === 'active_but_non_compliant' 
                      ? "border-destructive/50 bg-destructive/5" 
                      : "border-warning/50 bg-warning/5"
                  )}>
                    <div>
                      <p className="text-sm font-medium">{record.provider_name}</p>
                      <p className="text-xs text-muted-foreground">{record.state_abbreviation} — {record.compliance_reason}</p>
                    </div>
                    <ComplianceStatusBadge status={record.compliance_status} />
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {criticalRecords.length === 0 && (
          <div className="text-center py-4">
            <CheckCircle2 className="h-8 w-8 mx-auto text-success/50 mb-2" />
            <p className="text-sm text-muted-foreground">No critical compliance issues for W2 providers</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
