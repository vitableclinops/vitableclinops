import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Mail, AlertTriangle, ArrowRightLeft, Sparkles, Clock, Send } from 'lucide-react';

interface OutreachCandidate {
  profile_id: string;
  name: string;
  email: string;
  current_state: string | null;
  current_state_status: string | null;
  surplus_hours: number;
  on_cooldown: boolean;
  last_contacted_at: string | null;
}

interface StateRec {
  state: string;
  status: 'ok' | 'low' | 'critical' | 'zero' | 'no_data';
  gap_hours: number;
  available_slots: number | null;
  target_slots: number | null;
  outreach_candidates: OutreachCandidate[];
  apply_recommendation: {
    state: string;
    candidate_profile_ids: string[];
    candidate_names: string[];
    rationale: string;
  } | null;
}

interface DropRec {
  profile_id: string;
  provider_name: string;
  state: string;
  surplus_state_count: number;
  reason: string;
}

interface RecsResponse {
  state_recommendations: StateRec[];
  drop_recommendations: DropRec[];
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
  const queryClient = useQueryClient();
  const [outreachState, setOutreachState] = useState<StateRec | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [customMessage, setCustomMessage] = useState('');

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

  const sendOutreach = useMutation({
    mutationFn: async ({ state, profileIds, message }: { state: string; profileIds: string[]; message: string }) => {
      const { data, error } = await supabase.functions.invoke('send-coverage-outreach', {
        body: { state, profile_ids: profileIds, custom_message: message || undefined },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: `Outreach sent to ${data.sent} provider(s)`,
        description: data.skipped_cooldown > 0
          ? `${data.skipped_cooldown} skipped (already contacted within 7 days).`
          : `Logged in coverage outreach history.`,
      });
      setOutreachState(null);
      setSelectedIds(new Set());
      setCustomMessage('');
      queryClient.invalidateQueries({ queryKey: ['coverage_recommendations'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Outreach failed', description: err.message, variant: 'destructive' });
    },
  });

  const openOutreach = (s: StateRec) => {
    setOutreachState(s);
    // Pre-select all non-cooldown candidates
    setSelectedIds(new Set(s.outreach_candidates.filter(c => !c.on_cooldown).map(c => c.profile_id)));
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Recommended actions</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  const stateRecsWithCandidates = (recs?.state_recommendations ?? [])
    .filter(s => s.status === 'zero' || s.status === 'critical' || s.status === 'low')
    .filter(s => s.outreach_candidates.length > 0 || s.apply_recommendation)
    .sort((a, b) => {
      const order = { zero: 0, critical: 1, low: 2, ok: 3, no_data: 4 };
      return order[a.status] - order[b.status];
    });

  const dropRecs = recs?.drop_recommendations ?? [];

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Recommended actions
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {recs?.meta.states_needing_attention ?? 0} state(s) need attention · {recs?.meta.total_outreach_candidates ?? 0} provider(s) available to ping
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Fill the gap section */}
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              Fill the gap — outreach candidates
            </h3>
            {stateRecsWithCandidates.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">All deficit states either have no licensed providers or no surplus elsewhere to redirect.</p>
            ) : (
              <div className="space-y-3">
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
                      {s.outreach_candidates.filter(c => !c.on_cooldown).length > 0 && (
                        <Button size="sm" variant="default" className="gap-1.5 shrink-0" onClick={() => openOutreach(s)}>
                          <Send className="h-3 w-3" />
                          Send outreach
                        </Button>
                      )}
                    </div>
                    {s.outreach_candidates.length > 0 && (
                      <ul className="text-xs space-y-1 ml-1">
                        {s.outreach_candidates.map(c => (
                          <li key={c.profile_id} className="flex items-center gap-2">
                            <span className="font-medium">{c.name}</span>
                            {c.current_state_status === 'SURPLUS' && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-emerald-500 text-emerald-700 dark:text-emerald-400">
                                {c.surplus_hours.toFixed(1)}h surplus in {c.current_state}
                              </Badge>
                            )}
                            {c.current_state_status === 'BALANCED' && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5">BALANCED in {c.current_state}</Badge>
                            )}
                            {c.on_cooldown && (
                              <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5">
                                <Clock className="h-2.5 w-2.5" />
                                contacted recently
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {s.apply_recommendation && (
                      <div className="text-xs bg-muted/50 rounded p-2 mt-2">
                        <span className="font-medium">License recommendation:</span> {s.apply_recommendation.rationale}{' '}
                        Candidates: {s.apply_recommendation.candidate_names.join(', ')}.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Reallocate section */}
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <ArrowRightLeft className="h-3.5 w-3.5" />
              Reallocate — license drop candidates
            </h3>
            {dropRecs.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No providers currently meet the drop threshold (4+ surplus states).</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {dropRecs.map(d => (
                  <li key={`${d.profile_id}-${d.state}`} className="flex items-start gap-2 border rounded p-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                    <div>
                      <div><span className="font-medium">{d.provider_name}</span> — drop <span className="font-semibold">{d.state}</span> license</div>
                      <div className="text-muted-foreground mt-0.5">{d.reason}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!outreachState} onOpenChange={(open) => { if (!open) { setOutreachState(null); setSelectedIds(new Set()); setCustomMessage(''); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Send outreach for {outreachState?.state}</DialogTitle>
            <DialogDescription>
              Email selected providers about the ~{outreachState?.gap_hours.toFixed(1)}h coverage gap.
              Each recipient is logged and won't receive another outreach for this state for 7 days.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {outreachState?.outreach_candidates.map(c => {
                const checked = selectedIds.has(c.profile_id);
                return (
                  <label key={c.profile_id} className={`flex items-start gap-2 border rounded p-2 cursor-pointer ${c.on_cooldown ? 'opacity-50' : ''}`}>
                    <Checkbox
                      checked={checked}
                      disabled={c.on_cooldown}
                      onCheckedChange={(v) => {
                        const next = new Set(selectedIds);
                        if (v) next.add(c.profile_id); else next.delete(c.profile_id);
                        setSelectedIds(next);
                      }}
                    />
                    <div className="text-sm">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{c.email}</div>
                      {c.on_cooldown && (
                        <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">Cooldown — contacted within last 7 days</div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Custom note (optional)</label>
              <Textarea
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder="e.g. Even one extra shift this week would help us hit SLA targets."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOutreachState(null)}>Cancel</Button>
            <Button
              disabled={selectedIds.size === 0 || sendOutreach.isPending}
              onClick={() => outreachState && sendOutreach.mutate({
                state: outreachState.state,
                profileIds: [...selectedIds],
                message: customMessage,
              })}
            >
              {sendOutreach.isPending ? 'Sending…' : `Send to ${selectedIds.size} provider(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}