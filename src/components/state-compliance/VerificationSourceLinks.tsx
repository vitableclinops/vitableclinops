import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

const NURSYS_QUICKCONFIRM = 'https://www.nursys.com/LQC/LQCSearch.aspx';
const STATE_SPECIFIC: Record<string, { label: string; url: string }[]> = {
  NC: [{ label: 'NCBON license & registration lookup', url: 'https://portal.ncbon.com/LicenseVerification/search.aspx' }],
  PA: [{ label: 'PALS license lookup (PA)', url: 'https://www.pals.pa.gov/#/page/search' }],
};

/** External sites where staff can look up the proof needed to satisfy a state verification. */
export function VerificationSourceLinks({ state }: { state: string }) {
  const { data: kbUrl } = useQuery({
    queryKey: ['state-kb-url', state],
    queryFn: async () => {
      const { data } = await supabase.from('state_compliance_requirements').select('knowledge_base_url').eq('state_abbreviation', state).maybeSingle();
      return (data as { knowledge_base_url?: string | null } | null)?.knowledge_base_url ?? null;
    },
    staleTime: 10 * 60 * 1000,
  });
  const links = [
    { label: 'Nursys license verification', url: NURSYS_QUICKCONFIRM },
    ...(STATE_SPECIFIC[state] ?? []),
    ...(kbUrl && /^https?:\/\//.test(kbUrl) ? [{ label: `${state} requirement reference`, url: kbUrl }] : []),
  ];
  return <div className="space-y-1">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Where to find proof</p>
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {links.map(l => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">{l.label}<ExternalLink className="h-3 w-3" /></a>)}
    </div>
  </div>;
}
