import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Lock,
  Shield,
  ExternalLink,
  ArrowRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { WorkflowReadiness, BlockingReason } from '@/hooks/useWorkflowReadiness';
import { cn } from '@/lib/utils';

interface WorkflowReadinessBannerProps {
  readiness: WorkflowReadiness;
  entityLabel?: string;
  onFixAction?: (reason: BlockingReason) => void;
  className?: string;
  compact?: boolean;
}

const statusConfig = {
  not_ready: {
    icon: Lock,
    label: 'Blocked',
    variant: 'destructive' as const,
    bgClass: 'border-destructive/30 bg-destructive/5',
    textClass: 'text-destructive',
  },
  ready_for_review: {
    icon: Clock,
    label: 'Ready for Review',
    variant: 'default' as const,
    bgClass: 'border-warning/30 bg-warning/5',
    textClass: 'text-warning',
  },
  ready_to_execute: {
    icon: Shield,
    label: 'Ready to Execute',
    variant: 'default' as const,
    bgClass: 'border-success/30 bg-success/5',
    textClass: 'text-success',
  },
  completed: {
    icon: CheckCircle2,
    label: 'Completed',
    variant: 'default' as const,
    bgClass: 'border-success/30 bg-success/5',
    textClass: 'text-success',
  },
};

export function WorkflowReadinessBanner({
  readiness,
  entityLabel,
  onFixAction,
  className,
  compact = false,
}: WorkflowReadinessBannerProps) {
  const navigate = useNavigate();
  const config = statusConfig[readiness.status];
  const Icon = config.icon;
  const requiredBlockers = readiness.blockingReasons.filter(r => r.severity === 'required');
  const recommendedBlockers = readiness.blockingReasons.filter(r => r.severity === 'recommended');

  // Don't show banner when completed and no issues
  if (readiness.isComplete && readiness.blockingReasons.length === 0) {
    return null;
  }

  if (compact) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <Badge className={cn('gap-1', config.bgClass, config.textClass, 'border')}>
          <Icon className="h-3 w-3" />
          {config.label}
        </Badge>
        {requiredBlockers.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {requiredBlockers.length} blocker(s)
          </span>
        )}
      </div>
    );
  }

  return (
    <Alert className={cn(config.bgClass, 'border', className)}>
      <Icon className={cn('h-4 w-4', config.textClass)} />
      <AlertTitle className={cn('flex items-center gap-2', config.textClass)}>
        {config.label}
        {entityLabel && (
          <span className="font-normal text-muted-foreground text-sm">— {entityLabel}</span>
        )}
      </AlertTitle>
      {readiness.blockingReasons.length > 0 && (
        <AlertDescription className="mt-2">
          <ul className="space-y-1.5">
            {requiredBlockers.map((reason, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                  {reason.label}
                </span>
                {reason.fixAction === 'navigate' && reason.fixTarget && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 px-2 text-xs"
                    onClick={() => navigate(reason.fixTarget!)}
                  >
                    Fix <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                )}
                {reason.fixAction === 'inline' && onFixAction && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 px-2 text-xs"
                    onClick={() => onFixAction(reason)}
                  >
                    Fix <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                )}
              </li>
            ))}
            {recommendedBlockers.map((reason, i) => (
              <li key={`rec-${i}`} className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  {reason.label}
                </span>
                {reason.fixAction === 'inline' && onFixAction && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 px-2 text-xs"
                    onClick={() => onFixAction(reason)}
                  >
                    Set <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </AlertDescription>
      )}
    </Alert>
  );
}
