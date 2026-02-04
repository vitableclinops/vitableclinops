import { CheckCircle2, Circle, Clock, FileSignature, Send, Users, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Database } from '@/integrations/supabase/types';

type WorkflowStatus = Database['public']['Enums']['agreement_workflow_status'];

interface WorkflowStep {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  statuses: WorkflowStatus[];
}

const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    id: 'draft',
    label: 'Draft Created',
    description: 'Agreement initialized',
    icon: FileSignature,
    statuses: ['draft'],
  },
  {
    id: 'signatures',
    label: 'Collecting Signatures',
    description: 'Awaiting all parties',
    icon: Send,
    statuses: ['pending_signatures', 'awaiting_physician_signature', 'awaiting_provider_signatures'],
  },
  {
    id: 'executed',
    label: 'Fully Executed',
    description: 'All signatures collected',
    icon: CheckCircle2,
    statuses: ['fully_executed'],
  },
  {
    id: 'active',
    label: 'Active',
    description: 'Agreement in effect',
    icon: Zap,
    statuses: ['active', 'pending_renewal'],
  },
];

interface WorkflowStatusTrackerProps {
  status: WorkflowStatus;
  physicianName?: string;
  providerCount?: number;
  physicianSigned?: boolean;
  providerSignatures?: { name: string; signed: boolean }[];
  className?: string;
  compact?: boolean;
}

export function WorkflowStatusTracker({
  status,
  physicianName,
  providerCount = 0,
  physicianSigned = false,
  providerSignatures = [],
  className,
  compact = false,
}: WorkflowStatusTrackerProps) {
  const isTerminated = status === 'terminated' || status === 'termination_initiated';
  
  const getStepState = (step: WorkflowStep): 'completed' | 'current' | 'pending' => {
    if (isTerminated) return 'pending';
    
    const stepIndex = WORKFLOW_STEPS.findIndex(s => s.id === step.id);
    const currentStepIndex = WORKFLOW_STEPS.findIndex(s => s.statuses.includes(status));
    
    if (stepIndex < currentStepIndex) return 'completed';
    if (stepIndex === currentStepIndex) return 'current';
    return 'pending';
  };

  const getStatusBadge = () => {
    const statusConfig: Record<WorkflowStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      draft: { label: 'Draft', variant: 'secondary' },
      pending_signatures: { label: 'Pending Signatures', variant: 'default' },
      awaiting_physician_signature: { label: 'Awaiting Physician', variant: 'default' },
      awaiting_provider_signatures: { label: 'Awaiting Providers', variant: 'default' },
      fully_executed: { label: 'Executed', variant: 'outline' },
      active: { label: 'Active', variant: 'outline' },
      pending_renewal: { label: 'Pending Renewal', variant: 'secondary' },
      termination_initiated: { label: 'Termination Initiated', variant: 'destructive' },
      terminated: { label: 'Terminated', variant: 'destructive' },
    };
    
    const config = statusConfig[status];
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const signedProviders = providerSignatures.filter(p => p.signed).length;

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        {WORKFLOW_STEPS.map((step, index) => {
          const state = getStepState(step);
          const Icon = step.icon;
          return (
            <div key={step.id} className="flex items-center">
              <div
                className={cn(
                  "h-8 w-8 rounded-full flex items-center justify-center transition-colors",
                  state === 'completed' && "bg-primary text-primary-foreground",
                  state === 'current' && "bg-primary/20 text-primary border-2 border-primary",
                  state === 'pending' && "bg-muted text-muted-foreground"
                )}
              >
                {state === 'completed' ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
              </div>
              {index < WORKFLOW_STEPS.length - 1 && (
                <div
                  className={cn(
                    "h-0.5 w-6 mx-1",
                    state === 'completed' ? "bg-primary" : "bg-muted"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Workflow Status</CardTitle>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Progress Steps */}
        <div className="relative">
          {WORKFLOW_STEPS.map((step, index) => {
            const state = getStepState(step);
            const Icon = step.icon;
            const isLast = index === WORKFLOW_STEPS.length - 1;
            
            return (
              <div key={step.id} className="flex gap-4">
                {/* Step indicator */}
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      "h-10 w-10 rounded-full flex items-center justify-center transition-all",
                      state === 'completed' && "bg-primary text-primary-foreground",
                      state === 'current' && "bg-primary/20 text-primary border-2 border-primary animate-pulse",
                      state === 'pending' && "bg-muted text-muted-foreground"
                    )}
                  >
                    {state === 'completed' ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : state === 'current' ? (
                      <Clock className="h-5 w-5" />
                    ) : (
                      <Circle className="h-5 w-5" />
                    )}
                  </div>
                  {!isLast && (
                    <div
                      className={cn(
                        "w-0.5 h-12 mt-2",
                        state === 'completed' ? "bg-primary" : "bg-muted"
                      )}
                    />
                  )}
                </div>
                
                {/* Step content */}
                <div className="flex-1 pb-8">
                  <div className="flex items-center gap-2">
                    <Icon className={cn(
                      "h-4 w-4",
                      state === 'completed' && "text-primary",
                      state === 'current' && "text-primary",
                      state === 'pending' && "text-muted-foreground"
                    )} />
                    <span className={cn(
                      "font-medium",
                      state === 'pending' && "text-muted-foreground"
                    )}>
                      {step.label}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {step.description}
                  </p>
                  
                  {/* Signature details for signature step */}
                  {step.id === 'signatures' && state === 'current' && (
                    <div className="mt-3 space-y-2">
                      {physicianName && (
                        <div className="flex items-center gap-2 text-sm">
                          <div className={cn(
                            "h-5 w-5 rounded-full flex items-center justify-center",
                            physicianSigned ? "bg-primary text-primary-foreground" : "bg-muted"
                          )}>
                            {physicianSigned ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : (
                              <Clock className="h-3 w-3" />
                            )}
                          </div>
                          <span className={physicianSigned ? "text-foreground" : "text-muted-foreground"}>
                            {physicianName}
                          </span>
                          {physicianSigned && (
                            <Badge variant="outline" className="text-xs">Signed</Badge>
                          )}
                        </div>
                      )}
                      
                      {providerCount > 0 && (
                        <div className="flex items-center gap-2 text-sm">
                          <div className={cn(
                            "h-5 w-5 rounded-full flex items-center justify-center",
                            signedProviders === providerCount ? "bg-primary text-primary-foreground" : "bg-muted"
                          )}>
                            <Users className="h-3 w-3" />
                          </div>
                          <span className="text-muted-foreground">
                            Providers: {signedProviders}/{providerCount} signed
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Termination notice */}
        {isTerminated && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <p className="text-sm text-destructive font-medium">
              {status === 'termination_initiated' 
                ? 'Termination has been initiated for this agreement.'
                : 'This agreement has been terminated.'}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
