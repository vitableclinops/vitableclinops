import { RefreshCw, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { formatRelativeTime } from '@/hooks/useDataFreshness';
import { activeLicensedStates, useMedallionDirectoryData, useRunMedallionSync } from '@/hooks/useMedallionDirectory';

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <div className="text-sm">{children}</div>
  </div>
);

export function MedallionProviderSection({ profileId, medallionId }: { profileId: string; medallionId: string | null }) {
  const { toast } = useToast();
  const { data, isLoading } = useMedallionDirectoryData(true);
  const run = useRunMedallionSync();
  const m = data?.byProfile.get(profileId);
  const licenses = data?.licensesByProfile.get(profileId) ?? [];
  const agreements = data?.agreementsByProfile.get(profileId) ?? [];
  const states = activeLicensedStates(licenses);

  const refresh = () => run.mutate({ mode: 'apply', scope: 'provider', profile_id: profileId }, {
    onSuccess: (r) => toast({
      title: r.ok ? 'Provider refreshed from Medallion' : 'Refresh finished with problems',
      description: r.ok ? `${r.licenses?.returned ?? 0} licenses, ${r.agreements?.returned ?? 0} agreements.` : (r.providers?.error ?? r.licenses?.error ?? r.agreements?.error ?? 'Some data could not be retrieved.'),
      variant: r.ok ? undefined : 'destructive',
    }),
    onError: (e: Error) => toast({ title: 'Refresh failed', description: e.message, variant: 'destructive' }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading Medallion data…</p>;

  if (!medallionId) {
    return <p className="text-sm text-muted-foreground">Not linked to Medallion (no Medallion ID). Medallion data isn't shown for this provider — e.g. DirectShift or manually added records.</p>;
  }

  return (
    <div className="space-y-4 min-w-0 max-w-full overflow-hidden">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {m?.last_returned_at ? `Last returned by Medallion ${formatRelativeTime(m.last_returned_at)}` : 'Not returned by the last Medallion refresh.'}
        </p>
        <Button size="sm" variant="outline" onClick={refresh} disabled={run.isPending}>
          <RefreshCw className={`h-4 w-4 mr-1 ${run.isPending ? 'animate-spin' : ''}`} />Refresh this provider
        </Button>
      </div>

      {m?.conflicts?.length ? (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm space-y-1">
          <p className="font-medium flex items-center gap-1"><AlertTriangle className="h-4 w-4 text-warning" />Differs from Medallion</p>
          {m.conflicts.map((c, i) => (
            <p key={i} className="text-muted-foreground">{c.field.replace('_', ' ')}: ours {c.local ?? '—'}, Medallion {c.medallion ?? '—'}{c.note ? ` — ${c.note}` : ''}</p>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Field label="Medallion employment status">{m?.medallion_employment_status ?? '—'}</Field>
        <Field label="Specialty (Medallion)">{m?.primary_specialty ?? <span className="text-muted-foreground">Empty in Medallion</span>}</Field>
        <Field label="Taxonomy code (Medallion)">{m?.primary_taxonomy ?? '—'}</Field>
        <Field label="Languages (Medallion)">
          {!m ? '—'
            : m.detail_state === 'ok' ? (m.languages?.length ? m.languages.join(', ') : <span className="text-muted-foreground">Empty in Medallion</span>)
            : m.detail_state === 'not_available' ? <span className="text-muted-foreground">Not available (inactive in Medallion)</span>
            : <span className="text-destructive">Couldn't retrieve</span>}
        </Field>
        <Field label="Licensed States (Medallion, active)">{states.length ? states.join(', ') : '—'}</Field>
        <Field label="Active States in Vitable EHR"><Badge variant="outline">Not connected</Badge></Field>
      </div>

      <Separator />
      <div>
        <p className="text-sm font-medium mb-2">Collaborative agreements (Medallion) · {agreements.length}</p>
        {agreements.length === 0 ? <p className="text-sm text-muted-foreground">None returned.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground text-left">
                <tr><th className="py-1 pr-2">State</th><th className="pr-2">Supervisor</th><th className="pr-2">Type</th><th className="pr-2">Medallion status</th><th className="pr-2">Dates</th><th>Document</th></tr>
              </thead>
              <tbody className="divide-y">
                {agreements.map((a) => (
                  <tr key={a.medallion_agreement_id}>
                    <td className="py-1 pr-2">{a.state ?? '—'}</td>
                    <td className="pr-2">{a.supervisor_name ?? '—'}{a.supervisor_npi ? <span className="text-xs text-muted-foreground"> · NPI {a.supervisor_npi}</span> : null}</td>
                    <td className="pr-2 capitalize">{a.agreement_type ?? '—'}</td>
                    <td className="pr-2">{a.source_status ?? '—'}</td>
                    <td className="pr-2 whitespace-nowrap">{a.start_date ?? '?'} → {a.end_date ?? 'open'}</td>
                    <td className="text-xs break-all">{a.document_title ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Separator />
      <div>
        <p className="text-sm font-medium mb-2">Licenses (Medallion) · {licenses.length}</p>
        {licenses.length === 0 ? <p className="text-sm text-muted-foreground">None returned.</p> : (
          <div className="flex flex-wrap gap-1">
            {[...licenses].sort((a, b) => a.state.localeCompare(b.state)).map((l) => (
              <Badge key={l.medallion_license_id} variant={l.status === 'active' ? 'secondary' : 'outline'} title={`${l.certificate_type ?? ''} ${l.license_number ?? ''} · expires ${l.expiration_date ?? '?'}${l.verified ? ' · verified' : ''}`}>
                {l.state} {l.certificate_type ?? ''}{l.status !== 'active' ? ` (${l.status})` : ''}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
