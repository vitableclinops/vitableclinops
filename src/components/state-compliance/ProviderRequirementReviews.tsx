import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useRequiredAgreementFlags } from '@/hooks/useRequiredAgreementFlags';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { IndependentPracticeVerifyDialog } from '@/components/agreements/IndependentPracticeVerifyDialog';
import { AgreementWizard } from '@/components/agreements/AgreementWizard';
import { StateActiveProvidersCard } from '@/components/states/StateActiveProvidersCard';
import { SHEET_REQUIREMENTS } from '@/lib/stateSheetRequirements';
import { StateRequirementLine } from '@/components/states/StateRequirementLine';
import { allUSStates } from '@/data/allStates';

export function ProviderRequirementReviews() {
  const [params, setParams] = useSearchParams();
  const state = params.get('state') ?? 'all';
  const [search, setSearch] = useState('');
  const [verify, setVerify] = useState<{ profileId: string; providerName: string; state: string } | null>(null);
  const [prefill, setPrefill] = useState<{ stateAbbr: string; skipProcess: boolean; provider: { id: string; name: string; email: string; npi?: string } } | null>(null);
  const { flags, loading, error, audit } = useRequiredAgreementFlags(true);
  const filtered = flags.filter(f => (state === 'all' || f.state === state) && f.name.toLowerCase().includes(search.toLowerCase()));
  const rule = audit?.rules.find(r => r.state_abbreviation === state);
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Provider requirement reviews <Badge variant="secondary">{filtered.length}</Badge></h2>
      <div className="flex flex-wrap gap-2"><Input aria-label="Search requirement reviews" placeholder="Search providers…" value={search} onChange={e => setSearch(e.target.value)} className="w-56" />
        <Select value={state} onValueChange={value => { const next = new URLSearchParams(params); next.set('tab','reviews'); if (value === 'all') next.delete('state'); else next.set('state',value); setParams(next); }}><SelectTrigger className="w-56" aria-label="Review state"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All states</SelectItem>{allUSStates.map(s => <SelectItem key={s.abbreviation} value={s.abbreviation}>{s.name} ({s.abbreviation})</SelectItem>)}</SelectContent></Select>
      </div>
    </div>
    {state !== 'all' && <StateRequirementLine state={state} collabType={rule?.collab_requirement_type} caRequired={rule?.ca_required} />}
    {loading && <p className="text-muted-foreground">Checking active-state requirements…</p>}
    {error && <p className="text-destructive">Could not load requirement reviews.</p>}
    {!loading && !error && !filtered.length && <p className="text-muted-foreground">No requirements need fixing{state !== 'all' ? ` in ${state}` : ''}.</p>}
    <div className="divide-y border-y">{filtered.map(f => {
      const existing = audit?.agreements.find(a => a.profileId === f.provider.id && a.state === f.state && a.agreementId && ['active','fully_executed'].includes(a.status ?? ''));
      return <div key={`${f.provider.id}:${f.state}`} className="py-4 space-y-2"><p className="font-medium">{f.name} — {f.state}</p>{f.newlyActive && <Badge variant="outline">Newly active in EHR</Badge>}<p className="text-sm text-destructive">{f.reason}</p><p className="text-sm text-muted-foreground">{f.howToFix}</p><div className="flex flex-wrap gap-2">
        {(f.sheetReview || f.registrationReview || f.independentAlternative) && <Button size="sm" variant="outline" onClick={() => setVerify({ profileId:f.provider.id,providerName:f.name,state:f.state })}>{f.registrationReview ? 'Verify NCBON registration' : f.sheetReview ? 'Verify state requirements' : ['PA','VA'].includes(f.state) ? 'Verify license designations' : 'Verify independent practice'}</Button>}
        {existing?.agreementId ? <Button size="sm" variant="outline" asChild><Link to={`/admin/agreements/${existing.agreementId}`}>Open agreement</Link></Button> : (!SHEET_REQUIREMENTS[f.state] || SHEET_REQUIREMENTS[f.state].agreement) && <Button size="sm" onClick={() => setPrefill({stateAbbr:f.state,skipProcess:true,provider:{id:f.provider.id,name:f.name,email:f.provider.email,npi:f.provider.npi_number ?? undefined}})}>Add / link agreement</Button>}
      </div></div>;
    })}</div>
    {state !== 'all' && <StateActiveProvidersCard state={state} />}
    {verify && <IndependentPracticeVerifyDialog open {...verify} onOpenChange={v => { if (!v) setVerify(null); }} />}
    <AgreementWizard open={!!prefill} prefill={prefill} onOpenChange={v => { if (!v) setPrefill(null); }} />
  </section>;
}