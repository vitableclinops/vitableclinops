import { cn } from '@/lib/utils';
import type { TaskCategory } from '@/types';
import { FileText, Users, ShieldCheck } from 'lucide-react';

interface CategoryBadgeProps {
  category: TaskCategory;
  size?: 'sm' | 'md';
  className?: string;
}

const categoryConfig: Record<TaskCategory, { 
  label: string; 
  icon: React.ComponentType<{ className?: string }>;
  className: string;
}> = {
  licensure: {
    label: 'Licensure',
    icon: FileText,
    className: 'bg-primary/10 text-primary',
  },
  collaborative: {
    label: 'Collaborative',
    icon: Users,
    className: 'bg-info/10 text-info',
  },
  compliance: {
    label: 'Compliance',
    icon: ShieldCheck,
    className: 'bg-accent/10 text-accent-foreground',
  },
};

export function CategoryBadge({ category, size = 'md', className }: CategoryBadgeProps) {
  const config = categoryConfig[category];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md font-medium',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs',
        config.className,
        className
      )}
    >
      <Icon className={cn('shrink-0', size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
      {config.label}
    </span>
  );
}
