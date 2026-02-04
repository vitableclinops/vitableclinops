import { cn } from '@/lib/utils';
import { CheckCircle2, Clock, AlertTriangle, Circle } from 'lucide-react';

type ReadinessStatus = 'complete' | 'in_progress' | 'not_started' | 'not_required' | 'blocked' | 'overdue';

interface ReadinessBadgeProps {
  status: ReadinessStatus;
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
}

const statusConfig: Record<ReadinessStatus, { 
  icon: React.ComponentType<{ className?: string }>;
  className: string;
  defaultLabel: string;
}> = {
  complete: {
    icon: CheckCircle2,
    className: 'text-success',
    defaultLabel: 'Complete',
  },
  in_progress: {
    icon: Clock,
    className: 'text-warning',
    defaultLabel: 'In Progress',
  },
  not_started: {
    icon: Circle,
    className: 'text-muted-foreground',
    defaultLabel: 'Not Started',
  },
  not_required: {
    icon: CheckCircle2,
    className: 'text-muted-foreground',
    defaultLabel: 'Not Required',
  },
  blocked: {
    icon: AlertTriangle,
    className: 'text-destructive',
    defaultLabel: 'Blocked',
  },
  overdue: {
    icon: AlertTriangle,
    className: 'text-destructive',
    defaultLabel: 'Overdue',
  },
};

export function ReadinessBadge({ status, label, size = 'md', className }: ReadinessBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-medium',
        size === 'sm' ? 'text-xs' : 'text-sm',
        config.className,
        className
      )}
    >
      <Icon className={cn('shrink-0', size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
      {label || config.defaultLabel}
    </span>
  );
}
