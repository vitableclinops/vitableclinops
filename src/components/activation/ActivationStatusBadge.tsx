import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Enums } from '@/integrations/supabase/types';
import { 
  CheckCircle2, 
  Clock, 
  XCircle, 
  AlertTriangle, 
  Power, 
  PowerOff 
} from 'lucide-react';

type EhrActivationStatus = Enums<'ehr_activation_status'>;
type ReadinessStatus = Enums<'readiness_status'>;
type MismatchType = Enums<'mismatch_type'>;

interface ActivationStatusBadgeProps {
  status: EhrActivationStatus;
  className?: string;
}

const activationConfig: Record<EhrActivationStatus, { 
  label: string; 
  className: string; 
  icon: typeof Power;
}> = {
  inactive: { 
    label: 'Inactive', 
    className: 'bg-muted text-muted-foreground', 
    icon: PowerOff 
  },
  activation_requested: { 
    label: 'Activation Requested', 
    className: 'bg-info/20 text-info', 
    icon: Clock 
  },
  active: { 
    label: 'Active', 
    className: 'bg-success/20 text-success', 
    icon: Power 
  },
  deactivation_requested: { 
    label: 'Deactivation Requested', 
    className: 'bg-warning/20 text-warning', 
    icon: Clock 
  },
  deactivated: { 
    label: 'Deactivated', 
    className: 'bg-destructive/20 text-destructive', 
    icon: XCircle 
  },
};

export function ActivationStatusBadge({ status, className }: ActivationStatusBadgeProps) {
  const config = activationConfig[status];
  const Icon = config.icon;
  
  return (
    <Badge className={cn('gap-1', config.className, className)}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

interface ReadinessStatusBadgeProps {
  status: ReadinessStatus;
  reason?: string | null;
  className?: string;
}

const readinessConfig: Record<ReadinessStatus, { 
  label: string; 
  className: string; 
  icon: typeof CheckCircle2;
}> = {
  not_ready: { 
    label: 'Not Ready', 
    className: 'bg-destructive/20 text-destructive', 
    icon: XCircle 
  },
  ready: { 
    label: 'Ready', 
    className: 'bg-success/20 text-success', 
    icon: CheckCircle2 
  },
  at_risk: { 
    label: 'At Risk', 
    className: 'bg-warning/20 text-warning', 
    icon: AlertTriangle 
  },
  blocked: { 
    label: 'Blocked', 
    className: 'bg-destructive/20 text-destructive', 
    icon: XCircle 
  },
};

export function ReadinessStatusBadge({ status, reason, className }: ReadinessStatusBadgeProps) {
  const config = readinessConfig[status];
  const Icon = config.icon;
  
  return (
    <Badge 
      className={cn('gap-1', config.className, className)} 
      title={reason || undefined}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

interface MismatchBadgeProps {
  mismatchType: MismatchType | null;
  className?: string;
}

const mismatchConfig: Record<Exclude<MismatchType, 'none'>, { 
  label: string; 
  className: string;
}> = {
  active_but_not_ready: { 
    label: '⚠️ Active but Not Ready', 
    className: 'bg-destructive text-destructive-foreground animate-pulse' 
  },
  ready_but_inactive: { 
    label: 'Ready but Inactive', 
    className: 'bg-info/20 text-info' 
  },
  expired_license_but_active: { 
    label: '🚨 Expired License but Active', 
    className: 'bg-destructive text-destructive-foreground animate-pulse' 
  },
  expired_collab_but_active: { 
    label: '🚨 Expired Collab but Active', 
    className: 'bg-destructive text-destructive-foreground animate-pulse' 
  },
};

export function MismatchBadge({ mismatchType, className }: MismatchBadgeProps) {
  if (!mismatchType || mismatchType === 'none') return null;
  
  const config = mismatchConfig[mismatchType];
  
  return (
    <Badge className={cn('text-xs', config.className, className)}>
      {config.label}
    </Badge>
  );
}
