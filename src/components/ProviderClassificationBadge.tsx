import { Badge } from '@/components/ui/badge';
import { Building2, User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProviderClassificationBadgeProps {
  employmentType: string | null;
  compact?: boolean;
}

export function ProviderClassificationBadge({ employmentType, compact = false }: ProviderClassificationBadgeProps) {
  const isAgency = employmentType === 'agency';
  const is1099 = employmentType === '1099';
  const isW2 = !employmentType || employmentType === 'w2';

  if (isAgency) {
    return (
      <Badge variant="outline" className={cn("gap-1 bg-orange-500/10 text-orange-600 border-orange-500/30", compact && "text-xs px-1.5 py-0")}>
        <Building2 className={cn("h-3 w-3", compact && "h-2.5 w-2.5")} />
        {compact ? 'Agency' : 'Externally Managed'}
      </Badge>
    );
  }

  if (is1099) {
    return (
      <Badge variant="outline" className={cn("gap-1 bg-purple-500/10 text-purple-600 border-purple-500/30", compact && "text-xs px-1.5 py-0")}>
        <User className={cn("h-3 w-3", compact && "h-2.5 w-2.5")} />
        {compact ? '1099' : '1099 Contractor'}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className={cn("gap-1 bg-primary/10 text-primary border-primary/30", compact && "text-xs px-1.5 py-0")}>
      <User className={cn("h-3 w-3", compact && "h-2.5 w-2.5")} />
      {compact ? 'W2' : 'W2 — Internally Managed'}
    </Badge>
  );
}
