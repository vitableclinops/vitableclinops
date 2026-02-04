import { cn } from '@/lib/utils';
import type { DemandTag } from '@/types';
import { AlertTriangle, TrendingUp, Eye, CheckCircle2 } from 'lucide-react';

interface DemandTagBadgeProps {
  tag: DemandTag;
  showLabel?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

const tagConfig: Record<DemandTag, { 
  label: string; 
  icon: React.ComponentType<{ className?: string }>;
  className: string;
  description: string;
}> = {
  critical: {
    label: 'Critical',
    icon: AlertTriangle,
    className: 'bg-destructive/10 text-destructive border-destructive/30',
    description: 'Immediate attention required',
  },
  at_risk: {
    label: 'At Risk',
    icon: TrendingUp,
    className: 'bg-warning/10 text-warning border-warning/30',
    description: 'Projected demand pressure',
  },
  watch: {
    label: 'Watch',
    icon: Eye,
    className: 'bg-info/10 text-info border-info/30',
    description: 'Monitoring for changes',
  },
  stable: {
    label: 'Stable',
    icon: CheckCircle2,
    className: 'bg-muted text-muted-foreground border-border',
    description: 'Demand aligned with capacity',
  },
};

export function DemandTagBadge({ tag, showLabel = true, size = 'md', className }: DemandTagBadgeProps) {
  const config = tagConfig[tag];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border font-medium',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs',
        config.className,
        className
      )}
      title={config.description}
    >
      <Icon className={cn('shrink-0', size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
      {showLabel && config.label}
    </span>
  );
}

export function getDemandTagConfig(tag: DemandTag) {
  return tagConfig[tag];
}
