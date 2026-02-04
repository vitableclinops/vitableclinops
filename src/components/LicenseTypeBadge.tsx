import { cn } from '@/lib/utils';
import type { LicenseType } from '@/types';
import { FileText, Wifi, Award, RefreshCw } from 'lucide-react';

interface LicenseTypeBadgeProps {
  type: LicenseType;
  className?: string;
}

const typeConfig: Record<LicenseType, { 
  label: string; 
  icon: React.ComponentType<{ className?: string }>;
  className: string;
}> = {
  initial: {
    label: 'Initial License',
    icon: FileText,
    className: 'bg-primary/10 text-primary',
  },
  telehealth: {
    label: 'Telehealth',
    icon: Wifi,
    className: 'bg-info/10 text-info',
  },
  fpa: {
    label: 'Full Practice Authority',
    icon: Award,
    className: 'bg-accent/10 text-accent',
  },
  renewal: {
    label: 'Renewal',
    icon: RefreshCw,
    className: 'bg-warning/10 text-warning',
  },
};

export function LicenseTypeBadge({ type, className }: LicenseTypeBadgeProps) {
  const config = typeConfig[type];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium',
        config.className,
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}
