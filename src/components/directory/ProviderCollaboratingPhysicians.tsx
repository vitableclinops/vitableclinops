import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { isActiveSlotAgreement } from '@/lib/physicianSlots';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

interface Row {
  state: string;
  physicianName: string;
  physicianNpi: string | null;
  status: string;
}

/** Current collaborating physicians per state for one provider, from active agreements. */
export function ProviderCollaboratingPhysicians({ providerId }: { providerId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['provider-collab-physicians', providerId],
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Row[]> => {
      const { data: links, error: e1 } = await supabase
        .from('agreement_providers')
        .select('agreement_id, is_active, removed_at')
        .eq('provider_id', providerId);
      if (e1) throw e1;
      const ids = (links ?? []).filter(l => l.is_active !== false && !l.removed_at).map(l => l.agreement_id);
      if (!ids.length) return [];
      const { data: ags, error: e2 } = await supabase
        .from('collaborative_agreements')
        .select('id, state_abbreviation, physician_id, physician_name, physician_npi, workflow_status, start_date, end_date')
        .in('id', ids);
      if (e2) throw e2;
      const active = (ags ?? []).filter(a => isActiveSlotAgreement({ status: a.workflow_status, start: a.start_date, end: a.end_date }));
      const physIds = [...new Set(active.map(a => a.physician_id).filter(Boolean))] as string[];
      const npiById = new Map<string, string | null>();
      if (physIds.length) {
        const { data: profs } = await supabase.from('profiles').select('id, npi_number, full_name').in('id', physIds);
        (profs ?? []).forEach((p: any) => npiById.set(p.id, p.npi_number ?? null));
      }
      const seen = new Set<string>();
      return active
        .map(a => ({
          state: a.state_abbreviation ?? '—',
          physicianName: a.physician_name ?? 'Unknown physician',
          physicianNpi: a.physician_npi || (a.physician_id ? npiById.get(a.physician_id) ?? null : null),
          status: a.workflow_status,
        }))
        .filter(r => { const k = `${r.state}|${r.physicianName}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .sort((a, b) => a.state.localeCompare(b.state) || a.physicianName.localeCompare(b.physicianName));
    },
  });

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (error) return <p className="text-sm text-destructive">Couldn't load collaborating physicians.</p>;
  if (!data?.length) return <p className="text-sm text-muted-foreground">No active Collab Agreements for this provider.</p>;

  return (
    <div className="rounded-md border divide-y">
      <div className="grid grid-cols-[4rem_1fr_9rem] gap-2 px-3 py-2 text-xs font-medium text-muted-foreground uppercase">
        <span>State</span><span>Collaborating physician</span><span>Physician NPI</span>
      </div>
      {data.map(r => (
        <div key={`${r.state}-${r.physicianName}`} className="grid grid-cols-[4rem_1fr_9rem] gap-2 px-3 py-2 text-sm items-center">
          <Badge variant="outline" className="w-fit">{r.state}</Badge>
          <span>{r.physicianName}</span>
          <span className="font-mono text-xs">{r.physicianNpi || <span className="text-muted-foreground">Not on file</span>}</span>
        </div>
      ))}
    </div>
  );
}
