import { CheckCircle2, Circle, Clock, FileSignature, Send, Users, Zap, ShieldAlert, ClipboardCheck, XCircle, AlertTriangle } from 'lucide-react';
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
    id: 'in_progress',
    label: 'In Progress',
    description: 'Setup tasks being completed',
    icon: ClipboardCheck,
    statuses: ['in_progress', 'pending_setup'],
  },
  {
    id: 'signatures',
    label: 'Pending Signatures',
    description: 'Awaiting all parties',
    icon: Send,
    statuses: ['pending_signatures', 'awaiting_physician_signature', 'awaiting_provider_signatures'],
  },
  {
    id: 'verification',
    label: 'Pending Verification',
    description: 'Admin verification required',
    icon: ShieldAlert,
    statuses: ['pending_verification', 'fully_executed'],
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
  pendingTaskCount?: number;
  completedTaskCount?: number;
  totalTaskCount?: number;
}

export function WorkflowStatusTracker({
  status,
  physicianName,
  providerCount = 0,
  physicianSigned = false,
  providerSignatures = [],
  className,
  compact = false,
  pendingTaskCount = 0,
  completedTaskCount = 0,
  totalTaskCount = 0,
}: WorkflowStatusTrackerProps) {
  const isTerminated = status === 'terminated' || status === 'termination_initiated';
  const isInvalid = status === 'invalid';
  const isCancelled = status === 'cancelled';
  const isArchived = status === 'archived';
  
  const getStepState = (step: WorkflowStep): 'completed' | 'current' | 'pending' => {
    if (isTerminated || isInvalid || isCancelled || isArchived) return 'pending';
    
    const stepIndex = WORKFLOW_STEPS.findIndex(s => s.id === step.id);
    const currentStepIndex = WORKFLOW_STEPS.findIndex(s => s.statuses.includes(status));
    
    // When status is 'active', all steps including Active are completed
    if (status === 'active') return stepIndex <= currentStepIndex ? 'completed' : 'pending';
    
    if (stepIndex < currentStepIndex) return 'completed';
    if (stepIndex === currentStepIndex) return 'current';
    return 'pending';
  };

  const getStatusBadge = () => {
    const statusConfig: Record<WorkflowStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      draft: { label: 'Draft', variant: 'secondary' },
      in_progress: { label: 'In Progress', variant: 'default' },
      pending_setup: { label: 'Pending Setup', variant: 'default' },
      pending_signatures: { label: 'Pending Signatures', variant: 'default' },
      awaiting_physician_signature: { label: 'Awaiting Physician', variant: 'default' },
      awaiting_provider_signatures: { label: 'Awaiting Providers', variant: 'default' },
      fully_executed: { label: 'Executed', variant: 'outline' },
      pending_verification: { label: 'Pending Verification', variant: 'default' },
      active: { label: 'Active', variant: 'outline' },
      pending_renewal: { label: 'Pending Renewal', variant: 'secondary' },
      termination_initiated: { label: 'Pending Termination', variant: 'destructive' },
      terminated: { label: 'Terminated', variant: 'destructive' },
      cancelled: { label: 'Cancelled', variant: 'destructive' },
      archived: { label: 'Archived', variant: 'secondary' },
      invalid: { label: 'Invalid', variant: 'destructive' },
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
          <div className="flex items-center gap-2">
            {totalTaskCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {completedTaskCount}/{totalTaskCount} tasks
              </span>
            )}
            {getStatusBadge()}
          </div>
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
                  
                  {/* Task progress for in-progress steps */}
                  {(step.id === 'in_progress' || step.id === 'signatures') && state === 'current' && totalTaskCount > 0 && (
                    <div className="mt-2 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full rounded-full transition-all",
                              completedTaskCount === totalTaskCount ? "bg-success" : "bg-primary"
                            )}
                            style={{ width: `${(completedTaskCount / totalTaskCount) * 100}%` }} 
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {completedTaskCount}/{totalTaskCount}
                        </span>
                      </div>
                      {pendingTaskCount > 0 && (
                        <p className="text-xs text-warning mt-1">
                          {pendingTaskCount} task{pendingTaskCount !== 1 ? 's' : ''} remaining
                        </p>
                      )}
                      {pendingTaskCount === 0 && (
                        <p className="text-xs text-success mt-1">
                          ✓ All tasks complete — ready to advance
                        </p>
                      )}
                    </div>
                  )}

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
                ? 'Termination has been initiated. Required tasks must be completed before finalizing.'
                : 'This agreement has been terminated.'}
            </p>
          </div>
        )}

        {/* Invalid notice */}
        {isInvalid && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <p className="text-sm text-destructive font-medium">
                This agreement has been invalidated. Required conditions are no longer met. Remediation is required.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
