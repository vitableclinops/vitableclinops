import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, Eye, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { formatRelativeTime } from '@/hooks/useDataFreshness';
import {
  computeEntityHealth, MEDALLION_STALE_HOURS, useMedallionDirectoryData, useRunMedallionSync,
  type MedallionSyncRun,
} from '@/hooks/useMedallionDirectory';

const ENTITY_LABEL = { providers: 'Providers', licenses: 'Licenses', agreements: 'Collaborative agreements' } as const;

function statusBadge(run: MedallionSyncRun | null) {
  if (!run) return <Badge variant="outline">Never run</Badge>;
  if (run.status === 'success') return <Badge className="bg-success/10 text-success">Succeeded</Badge>;
  if (run.status === 'partial') return <Badge className="bg-warning/10 text-warning">Partly failed</Badge>;
  if (run.status === 'running') return <Badge variant="secondary">Running</Badge>;
  return <Badge variant="destructive">Failed</Badge>;
}

interface Props {
  reviewProfiles: { id: string; full_name: string | null; email: string; directory_visibility_reason: string | null }[];
}

export function MedallionSyncPanel({ reviewProfiles }: Props) {
  const { toast } = useToast();
  const { data, isLoading, error } = useMedallionDirectoryData(true);
  const run = useRunMedallionSync();
  const health = useMemo(() => computeEntityHealth(data?.runs ?? []), [data?.runs]);
  const anyStale = health.some((h) => h.stale);

  const conflicts = useMemo(
    () => (data?.providers ?? []).filter((p) => p.conflicts?.length),
    [data?.providers],
  );
  const unlinked = useMemo(
    () => (data?.providers ?? []).filter((p) => p.match_method !== 'medallion_id'),
    [data?.providers],
  );
  const agreementReview = useMemo(
    () => (data?.agreements ?? []).filter((a) => !a.local_agreement_id),
    [data?.agreements],
  );

  const trigger = (mode: 'dry_run' | 'apply') =>
    run.mutate({ mode, scope: 'full' }, {
      onSuccess: (r) => toast({
        title: r.ok ? (mode === 'apply' ? 'Directory refreshed from Medallion' : 'Preview complete — nothing saved') : 'Refresh finished with problems',
        description: `${r.providers?.returned ?? 0} providers, ${r.licenses?.returned ?? 0} licenses, ${r.agreements?.returned ?? 0} agreements.`,
        variant: r.ok ? undefined : 'destructive',
      }),
      onError: (e: Error) => toast({ title: 'Refresh failed', description: e.message, variant: 'destructive' }),
    });

  if (isLoading) return <Card><CardContent className="py-10 text-center text-muted-foreground">Loading Medallion sync status…</CardContent></Card>;
  if (error) return <Alert variant="destructive"><AlertTitle>Couldn't load sync status</AlertTitle><AlertDescription>{(error as Error).message}</AlertDescription></Alert>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Medallion sync</h2>
          <p className="text-sm text-muted-foreground">Refreshes daily at 5:15 AM Central. Medallion is read only — nothing is changed there.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => trigger('dry_run')} disabled={run.isPending}>
            <Eye className="h-4 w-4 mr-2" />Preview changes
          </Button>
          <Button onClick={() => trigger('apply')} disabled={run.isPending}>
            <RefreshCw className={`h-4 w-4 mr-2 ${run.isPending ? 'animate-spin' : ''}`} />
            {run.isPending ? 'Refreshing… (about a minute)' : 'Refresh directory'}
          </Button>
        </div>
      </div>

      {anyStale && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Medallion data may be out of date</AlertTitle>
          <AlertDescription>
            {health.filter((h) => h.stale).map((h) => ENTITY_LABEL[h.entity]).join(', ')} {health.filter((h) => h.stale).length === 1 ? 'has' : 'have'} not refreshed successfully in the last {MEDALLION_STALE_HOURS} hours.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {health.map((h) => (
          <Card key={h.entity}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{ENTITY_LABEL[h.entity]}</CardTitle>
                {statusBadge(h.lastRun)}
              </div>
              <CardDescription className="flex items-center gap-1">
                {h.stale ? <XCircle className="h-3.5 w-3.5 text-destructive" /> : <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
                Last successful refresh: {h.lastSuccess ? formatRelativeTime(h.lastSuccess.finished_at ?? h.lastSuccess.started_at) : 'never'}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              {h.lastRun ? (
                <>
                  <p className="text-muted-foreground flex items-center gap-1"><Clock className="h-3.5 w-3.5" />Last attempt {formatRelativeTime(h.lastRun.started_at)} ({h.lastRun.trigger_source})</p>
                  <p>{h.lastRun.rows_returned} returned · {h.lastRun.rows_written} saved{h.lastRun.rows_failed ? ` · ${h.lastRun.rows_failed} failed` : ''}</p>
                  {h.lastRun.error_message && <p className="text-destructive">{h.lastRun.error_message}</p>}
                </>
              ) : <p className="text-muted-foreground">No refresh has run yet.</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Differences to review ({conflicts.length})</CardTitle>
          <CardDescription>Medallion and our directory disagree. Local terminations, employment classifications and agreement stages are kept — nothing here was changed automatically.</CardDescription>
        </CardHeader>
        <CardContent>
          {conflicts.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
            <ul className="divide-y text-sm">
              {conflicts.map((p) => (
                <li key={p.medallion_id} className="py-2">
                  <span className="font-medium">{p.full_name}</span>
                  {p.conflicts.map((c, i) => (
                    <p key={i} className="text-muted-foreground">
                      {c.field.replace('_', ' ')}: ours <span className="text-foreground">{c.local ?? '—'}</span>, Medallion <span className="text-foreground">{c.medallion ?? '—'}</span>{c.note ? ` — ${c.note}` : ''}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Medallion providers not linked ({unlinked.length})</CardTitle>
            <CardDescription>Only exact Medallion IDs are linked automatically.</CardDescription>
          </CardHeader>
          <CardContent>
            {unlinked.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
              <ul className="divide-y text-sm">
                {unlinked.map((p) => (
                  <li key={p.medallion_id} className="py-2 flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{p.full_name}</p>
                      <p className="text-muted-foreground">{p.match_notes ?? 'No matching record in our directory.'}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Badge variant="outline">{p.medallion_employment_status ?? 'unknown'}</Badge>
                      <Badge variant={p.match_method === 'candidate' || p.match_method === 'ambiguous' ? 'secondary' : 'outline'}>
                        {p.match_method === 'candidate' ? 'Possible match' : p.match_method === 'ambiguous' ? 'Ambiguous' : 'No match'}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Medallion agreements without a local match ({agreementReview.length})</CardTitle>
            <CardDescription>Matched on provider + state + supervisor. Never merged automatically.</CardDescription>
          </CardHeader>
          <CardContent>
            {agreementReview.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
              <ul className="divide-y text-sm">
                {agreementReview.map((a) => {
                  const prov = data?.providers.find((p) => p.profile_id === a.profile_id);
                  return (
                    <li key={a.medallion_agreement_id} className="py-2">
                      <p className="font-medium">{prov?.full_name ?? 'Unknown provider'} · {a.state} · {a.supervisor_name}</p>
                      <p className="text-muted-foreground">{a.local_match_notes ?? 'No local agreement found for this provider, state and supervisor.'}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Accounts flagged for review ({reviewProfiles.length})</CardTitle>
          <CardDescription>Possible internal or staff accounts. Still shown in the directory until confirmed. Confirmed test accounts are already hidden (logins kept).</CardDescription>
        </CardHeader>
        <CardContent>
          {reviewProfiles.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
            <ul className="divide-y text-sm">
              {reviewProfiles.map((p) => (
                <li key={p.id} className="py-2">
                  <span className="font-medium">{p.full_name}</span> <span className="text-muted-foreground">· {p.email}</span>
                  {p.directory_visibility_reason && <p className="text-muted-foreground">{p.directory_visibility_reason}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Alerts: stale data shows here even if the job never starts. Sending an outside alert (e.g. Slack) needs a recipient or channel to be chosen.
      </p>
    </div>
  );
}
