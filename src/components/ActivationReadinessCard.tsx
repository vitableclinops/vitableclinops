import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ReadinessBadge } from './ReadinessBadge';
import { CheckCircle2, AlertTriangle, FileText, Users, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProviderState } from '@/types';

interface ActivationReadinessCardProps {
  providerState: ProviderState;
  className?: string;
}

export function ActivationReadinessCard({ providerState, className }: ActivationReadinessCardProps) {
  const { state, licensureComplete, collaborativeComplete, complianceComplete, isReadyForActivation } = providerState;
  
  // Determine collaborative requirement
  const collabRequired = state.requiresCollaborativeAgreement;
  
  // Calculate individual statuses
  const licensureTasks = providerState.tasks.filter(t => t.category === 'licensure');
  const collaborativeTasks = providerState.tasks.filter(t => t.category === 'collaborative');
  const complianceTasks = providerState.tasks.filter(t => t.category === 'compliance');
  
  const getLicensureStatus = () => {
    if (licensureComplete) return 'complete';
    if (licensureTasks.some(t => t.status === 'blocked')) return 'blocked';
    if (licensureTasks.some(t => ['in_progress', 'submitted'].includes(t.status))) return 'in_progress';
    return 'not_started';
  };
  
  const getCollaborativeStatus = () => {
    if (!collabRequired) return 'not_required';
    if (collaborativeComplete) return 'complete';
    if (collaborativeTasks.some(t => t.status === 'blocked')) return 'blocked';
    if (collaborativeTasks.some(t => ['in_progress', 'submitted'].includes(t.status))) return 'in_progress';
    return 'not_started';
  };
  
  const getComplianceStatus = () => {
    if (complianceComplete) return 'complete';
    const overdue = complianceTasks.some(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'approved');
    if (overdue) return 'overdue';
    if (complianceTasks.some(t => ['in_progress', 'submitted'].includes(t.status))) return 'in_progress';
    return 'not_started';
  };

  return (
    <Card className={cn(
      'transition-all',
      isReadyForActivation && 'border-success/50 bg-success/5',
      !isReadyForActivation && providerState.tasks.some(t => t.status === 'blocked') && 'border-destructive/30',
      className
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            {state.abbreviation} Readiness
          </CardTitle>
          {isReadyForActivation ? (
            <Badge className="bg-success text-success-foreground">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Ready
            </Badge>
          ) : (
            <Badge variant="secondary">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Not Ready
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Licensure Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText className="h-4 w-4" />
            Licensure
          </div>
          <ReadinessBadge status={getLicensureStatus()} size="sm" />
        </div>
        
        {/* Collaborative Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            Collaboration
          </div>
          <ReadinessBadge status={getCollaborativeStatus()} size="sm" />
        </div>
        
        {/* Compliance Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4" />
            Compliance
          </div>
          <ReadinessBadge status={getComplianceStatus()} size="sm" />
        </div>
      </CardContent>
    </Card>
  );
}
