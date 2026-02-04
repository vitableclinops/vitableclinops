import { cn } from '@/lib/utils';
import type { TaskStatus } from '@/types';
import { 
  Circle, 
  Clock, 
  Send, 
  CheckCircle2, 
  ShieldCheck, 
  AlertOctagon 
} from 'lucide-react';

interface StatusBadgeProps {
  status: TaskStatus;
  size?: 'sm' | 'md';
  showIcon?: boolean;
  className?: string;
}

const statusConfig: Record<TaskStatus, { 
  label: string; 
  className: string; 
  icon: React.ComponentType<{ className?: string }>;
}> = {
  not_started: {
    label: 'Not Started',
    className: 'status-not-started',
    icon: Circle,
  },
  in_progress: {
    label: 'In Progress',
    className: 'status-in-progress',
    icon: Clock,
  },
  submitted: {
    label: 'Submitted',
    className: 'status-submitted',
    icon: Send,
  },
  verified: {
    label: 'Verified',
    className: 'status-verified',
    icon: CheckCircle2,
  },
  approved: {
    label: 'Approved',
    className: 'status-approved',
    icon: ShieldCheck,
  },
  blocked: {
    label: 'Blocked',
    className: 'status-blocked',
    icon: AlertOctagon,
  },
};

export function StatusBadge({ status, size = 'md', showIcon = true, className }: StatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'status-badge',
        config.className,
        size === 'sm' && 'text-[10px] px-2 py-0.5',
        className
      )}
    >
      {showIcon && <Icon className={cn('shrink-0', size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')} />}
      {config.label}
    </span>
  );
}
