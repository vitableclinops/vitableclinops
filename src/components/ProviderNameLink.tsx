import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ProviderDetailModal } from '@/components/directory/ProviderDetailModal';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

/** Provider name that pops up that provider's directory profile in place (no navigation). */
export function ProviderNameLink({ id, name, className }: { id?: string | null; name: string | null | undefined; className?: string }) {
  const label = name || 'Unknown provider';
  const { hasRole } = useAuth();
  const [provider, setProvider] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const canOpen = hasRole('admin') || hasRole('pod_lead');
  if ((!id && !name) || !canOpen) return <span className={className}>{label}</span>;

  const open = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (loading) return;
    setLoading(true);
    const q = supabase.from('profiles').select('*');
    const { data } = id ? await q.eq('id', id).maybeSingle() : await q.ilike('full_name', label).limit(1).maybeSingle();
    setLoading(false);
    if (data) setProvider(data);
  };

  return (
    <>
      <button type="button" onClick={open} className={cn('text-left hover:underline', loading && 'opacity-60', className)}>
        {label}
      </button>
      {provider && (
        <span onClick={e => e.stopPropagation()}>
          <ProviderDetailModal provider={provider} onClose={() => setProvider(null)} onSaved={saved => setProvider(saved)} />
        </span>
      )}
    </>
  );
}
