import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EvidenceLink } from '@/components/agreements/EvidenceLink';
import { useRequiredAgreementFlags } from '@/hooks/useRequiredAgreementFlags';
import { isOffboarded } from '@/lib/employeeVisibility';
import { isTestAccountDirectoryRecord, OUT_OF_SCOPE_PROFILE_IDS } from '@/lib/pcpCoverage';
import { directoryDisplayName } from '@/lib/directoryDisplayName';
import { AlertTriangle, CheckCircle2, FileText, ShieldCheck, UserRound } from 'lucide-react';

const DECISION_LABEL: Record<string, string> = {
  independent_verified: 'Independent practice verified',
  rx_authority_verified: 'Rx authority verified',
};

/** EHR-active providers in one state with their requirement status; shares the live, auto-refreshing audit used by Needs fixing. */
export function StateActiveProvidersCard({ state }: { state: string }) {
  const { flags, profiles, coverage, audit, loading, error } = useRequiredAgreementFlags(true);
  const active = profiles
    .filter(p => !isOffboarded(p.employment_status) && !isTestAccountDirectoryRecord(p) && !OUT_OF_SCOPE_PROFILE_IDS[p.id])
    .filter(p => (coverage?.statesByProfile.get(p.id) ?? []).includes(state))
    .map(p => ({ p, name: directoryDisplayName(p) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2"><UserRound className="h-5 w-5" />Active providers in {state}</CardTitle>
            <CardDescription>Providers active in the EHR here, with their saved requirements. Updates automatically when agreements or verifications are saved.</CardDescription>
          </div>
          <Button asChild size="sm" variant="outline"><Link to={`/admin/agreements?state=${state}`}>{state} agreements</Link></Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">Couldn't load active providers.</p>}
        {!loading && !error && active.length === 0 && <p className="text-sm text-muted-foreground">No providers are active in the EHR in {state}.</p>}
        {active.map(({ p, name }) => {
          const providerFlags = flags.filter(f => f.provider.id === p.id && f.state === state);
          const rawAgreements = (audit?.agreements ?? []).filter(a => a.profileId === p.id && a.state === state
            && ['active', 'fully_executed'].includes((a.status ?? '').toLowerCase()) && (!a.end || a.end.slice(0, 10) >= today));
          // Local agreements and their linked source copies describe the same agreement: show each once.
          const hasLocal = rawAgreements.some(a => a.agreementId);
          const seen = new Set<string>();
          const agreements = [...rawAgreements].sort((x, y) => Number(!!y.agreementId) - Number(!!x.agreementId)).filter(a => {
            if (hasLocal && !a.agreementId) return false;
            const key = a.agreementId || a.document?.trim() || '';
            if (key && seen.has(key)) return false;
            if (key) seen.add(key);
            return true;
          });
          const decisions = (audit?.decisions ?? []).filter(d => d.profile_id === p.id && d.state_abbreviation === state && DECISION_LABEL[d.decision]);
          return (
            <div key={p.id} className="rounded-md border p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Link to={`/providers?search=${encodeURIComponent(name)}`} className="font-medium hover:underline">{name}</Link>
                  {p.profession && p.profession !== '-' && <span className="text-xs text-muted-foreground">{p.profession}</span>}
                </div>
                {providerFlags.length
                  ? <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />Needs fixing</Badge>
                  : <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" />Requirements met</Badge>}
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {agreements.map((a, i) => (
                  <span key={i} className="inline-flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-muted-foreground"><FileText className="h-3 w-3" />Collab Agreement{a.documentExempt ? ' (Direct Shifts)' : ''}</span>
                    {a.document?.trim()
                      ? <EvidenceLink reference={a.document} className="inline-flex items-center gap-1 text-primary hover:underline">View document</EvidenceLink>
                      : !a.documentExempt && <span className="text-muted-foreground">(no document)</span>}
                  </span>
                ))}
                {decisions.map((d, i) => (
                  <span key={`d${i}`} className="inline-flex flex-wrap items-center gap-1 text-muted-foreground">
                    <ShieldCheck className="h-3 w-3" />{DECISION_LABEL[d.decision]}
                    <span className="whitespace-nowrap">
                      {d.verified_on ? `· Verified ${d.verified_on}` : ''}
                      {d.verified_attachment_path && <> <EvidenceLink reference={d.verified_attachment_path} className="text-primary hover:underline">· {d.verified_attachment_name ?? 'Attachment'}</EvidenceLink></>}
                      {d.verified_link && <> <EvidenceLink reference={d.verified_link} className="text-primary hover:underline">· Open link</EvidenceLink></>}
                    </span>
                    {d.verified_source ? <span>· {d.verified_source}</span> : null}
                  </span>
                ))}
              </div>
              {providerFlags.map((f, i) => (
                <div key={i} className="rounded bg-muted p-2 text-xs space-y-1">
                  <p><span className="font-medium">{f.reason}</span> {f.howToFix}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={() => {
                      // Full navigation so the Agreements page picks up the ?state filter
                      // even when the user is already on /admin/agreements.
                      window.location.assign(`/admin/agreements?state=${state}`);
                    }}
                  >
                    Fix in Needs fixing
                  </Button>
                </div>
              ))}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
