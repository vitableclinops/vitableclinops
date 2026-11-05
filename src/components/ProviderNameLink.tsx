import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/** Provider name that opens that provider's profile in the Provider Directory. */
export function ProviderNameLink({ id, name, className }: { id?: string | null; name: string | null | undefined; className?: string }) {
  const label = name || 'Unknown provider';
  if (!id && !name) return <span className={className}>{label}</span>;
  const to = id ? `/directory?provider=${id}` : `/directory?search=${encodeURIComponent(label)}`;
  return (
    <Link to={to} onClick={e => e.stopPropagation()} className={cn('hover:underline', className)}>
      {label}
    </Link>
  );
}
