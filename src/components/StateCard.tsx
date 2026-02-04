import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { StatusBadge } from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import type { ProviderState } from '@/types';
import { 
  MapPin, 
  CheckCircle2, 
  Clock, 
  AlertTriangle,
  ChevronRight,
  Shield,
  Users
} from 'lucide-react';

interface StateCardProps {
  providerState: ProviderState;
  onClick?: () => void;
  className?: string;
}

export function StateCard({ providerState, onClick, className }: StateCardProps) {
  const { state, isLicensed, isReadyForActivation, tasks } = providerState;
  
  const pendingTasks = tasks.filter(t => 
    ['not_started', 'in_progress', 'submitted'].includes(t.status)
  ).length;
  const blockedTasks = tasks.filter(t => t.status === 'blocked').length;
  const completedTasks = tasks.filter(t => 
    ['verified', 'approved'].includes(t.status)
  ).length;
  
  // Determine the most urgent status to show
  const currentTask = tasks.find(t => t.status === 'in_progress') 
    || tasks.find(t => t.status === 'blocked')
    || tasks.find(t => t.status === 'submitted')
    || tasks.find(t => t.status === 'not_started');

  return (
    <Card 
      className={cn(
        'card-interactive cursor-pointer group',
        isReadyForActivation && 'border-success/30 bg-success/5',
        blockedTasks > 0 && 'border-destructive/30',
        className
      )}
      onClick={onClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              'flex h-12 w-12 items-center justify-center rounded-lg text-lg font-bold',
              isReadyForActivation 
                ? 'bg-success/10 text-success' 
                : blockedTasks > 0 
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-primary/10 text-primary'
            )}>
              {state.abbreviation}
            </div>
            <div>
              <h3 className="font-semibold text-foreground">{state.name}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                {state.hasFPA ? (
                  <span className="inline-flex items-center gap-1 text-xs text-success">
                    <Shield className="h-3 w-3" />
                    Full Practice Authority
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" />
                    Requires Collaboration
                  </span>
                )}
              </div>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </CardHeader>
      
      <CardContent className="pt-0">
        {/* Status indicators */}
        <div className="flex items-center gap-4 mb-4">
          {isLicensed && (
            <div className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" />
              <span>Licensed</span>
            </div>
          )}
          {isReadyForActivation && (
            <div className="flex items-center gap-1.5 text-sm text-success font-medium">
              <Shield className="h-4 w-4" />
              <span>Ready for Activation</span>
            </div>
          )}
        </div>

        {/* Task progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Task Progress</span>
            <span className="font-medium">{completedTasks}/{tasks.length}</span>
          </div>
          
          {/* Progress bar */}
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div 
              className={cn(
                'h-full rounded-full transition-all',
                blockedTasks > 0 ? 'bg-destructive' : 'bg-success'
              )}
              style={{ width: `${(completedTasks / tasks.length) * 100}%` }}
            />
          </div>

          {/* Current status */}
          {currentTask && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-muted-foreground truncate max-w-[60%]">
                {currentTask.title}
              </p>
              <StatusBadge status={currentTask.status} size="sm" />
            </div>
          )}
        </div>

        {/* Blockers warning */}
        {blockedTasks > 0 && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{blockedTasks} blocked task{blockedTasks > 1 ? 's' : ''} needs attention</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
