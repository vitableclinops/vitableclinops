import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Sparkles, Copy, Clock, CalendarOff } from 'lucide-react';

interface OutreachCandidate {
  profile_id: string;
  name: string;
  email: string;
  current_state: string | null;
  current_state_status: string | null;
  surplus_hours: number;
  working_today?: boolean;
  shift_window?: string | null;
  appointments_today?: number | null;
}

interface StateRec {
  state: string;
  status: 'ok' | 'low' | 'critical' | 'zero' | 'no_data';
  gap_hours: number;
  available_slots: number | null;
  target_slots: number | null;
  outreach_candidates: OutreachCandidate[];
}

interface RecsResponse {
  state_recommendations: StateRec[];
  meta: {
    total_active_states: number;
    states_needing_attention: number;
    total_outreach_candidates: number;
  };
}

function statusBadge(status: StateRec['status']) {
  const map: Record<StateRec['status'], { label: string; cls: string }> = {
    zero: { label: 'ZERO', cls: 'bg-destructive text-destructive-foreground' },
    critical: { label: 'CRITICAL', cls: 'bg-orange-500 text-white' },
    low: { label: 'LOW', cls: 'bg-yellow-500 text-white' },
    ok: { label: 'OK', cls: 'bg-emerald-500 text-white' },
    no_data: { label: 'NO DATA', cls: 'bg-muted text-muted-foreground' },
  };
  const m = map[status];
  return <Badge className={`${m.cls} hover:${m.cls}`}>{m.label}</Badge>;
}

export function CoverageRecommendationsCard() {
  const { toast } = useToast();

  const { data: recs, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['coverage_recommendations'],
    queryFn: async (): Promise<RecsResponse> => {
      const { data, error } = await supabase.functions.invoke('compute-coverage-recommendations', {
        body: {},
      });
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });

  const copyEmails = async (state: string, candidates: OutreachCandidate[]) => {
    // Only copy emails of providers actually working today
    const working = candidates.filter(c => c.working_today);
    const pool = working.length > 0 ? working : candidates;
    const emails = pool.map(c => c.email).join(', ');
    try {
      await navigator.clipboard.writeText(emails);
      toast({
        title: `Copied ${pool.length} email(s) for ${state}`,
        description: working.length > 0
          ? 'Working today only. Paste into Slack DM or email.'
          : 'No one is on shift today — copied all licensed providers as fallback.',
      });
    } catch {
      toast({ title: 'Copy failed', description: emails, variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Suggested providers to ping</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  const stateRecsWithCandidates = (recs?.state_recommendations ?? [])
    .filter(s => s.status === 'zero' || s.status === 'critical' || s.status === 'low')
    .filter(s => s.outreach_candidates.length > 0)
    .sort((a, b) => {
      const order = { zero: 0, critical: 1, low: 2, ok: 3, no_data: 4 };
      return order[a.status] - order[b.status];
    });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Suggested providers to ping today
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {recs?.meta.states_needing_attention ?? 0} state(s) need attention · {recs?.meta.total_outreach_candidates ?? 0} provider(s) suggested
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          For each deficit state, we surface providers licensed there who have surplus or balanced capacity elsewhere today. Reach out via your usual channel — Slack DM, text, or email.
        </p>
        {stateRecsWithCandidates.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">All deficit states either have no licensed providers or no surplus elsewhere to redirect.</p>
        ) : (
          <div className="space-y-2">
            {stateRecsWithCandidates.slice(0, 8).map(s => (
              <div key={s.state} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {statusBadge(s.status)}
                    <span className="font-semibold">{s.state}</span>
                    <span className="text-xs text-muted-foreground">
                      needs ~{s.gap_hours.toFixed(1)}h ({s.available_slots ?? 0} slots vs target {s.target_slots ?? '—'})
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 shrink-0"
                    onClick={() => copyEmails(s.state, s.outreach_candidates)}
                  >
                    <Copy className="h-3 w-3" />
                    Copy emails
                  </Button>
                </div>
                <ul className="text-xs space-y-1 ml-1">
                  {s.outreach_candidates.map(c => (
                    <li key={c.profile_id} className="flex items-center gap-2 flex-wrap">
                      {c.working_today ? (
                        <Clock className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      ) : (
                        <CalendarOff className="h-3 w-3 text-muted-foreground shrink-0" />
                      )}
                      <span className="font-medium">{c.name}</span>
                      <span className="text-muted-foreground">{c.email}</span>
                      {c.working_today && c.shift_window && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-emerald-500 text-emerald-700 dark:text-emerald-400">
                          On shift {c.shift_window}
                        </Badge>
                      )}
                      {!c.working_today && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-muted-foreground">
                          Not on shift today
                        </Badge>
                      )}
                      {typeof c.appointments_today === 'number' && c.appointments_today > 0 && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                          {c.appointments_today} appt(s) today
                        </Badge>
                      )}
                      {c.current_state_status === 'SURPLUS' && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                          {c.surplus_hours.toFixed(1)}h surplus in {c.current_state}
                        </Badge>
                      )}
                      {c.current_state_status === 'BALANCED' && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5">BALANCED in {c.current_state}</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}