import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
import { useLicensedStateReadiness } from '@/hooks/useLicensedStateReadiness';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EvidenceLink } from '@/components/agreements/EvidenceLink';
import { REQUIREMENT_LABELS } from '@/lib/stateSheetRequirements';

export function ProviderRequirementReviews() {
  const [params, setParams] = useSearchParams();
  const state = params.get('state') ?? 'all';
  const [search, setSearch] = useState('');
  const [verify, setVerify] = useState<{ profileId: string; providerName: string; state: string } | null>(null);
  const [prefill, setPrefill] = useState<{ stateAbbr: string; skipProcess: boolean; provider: { id: string; name: string; email: string; npi?: string } } | null>(null);
  const { flags, loading, error, audit, rows, coverage } = useLicensedStateReadiness();
  const scope = params.get('scope') === 'licensed' ? 'licensed' : 'active';
  const licensed = rows.filter(r => (state === 'all' || r.state === state) && r.name.toLowerCase().includes(search.toLowerCase()));
  const filtered = flags.filter(f => (state === 'all' || f.state === state) && f.name.toLowerCase().includes(search.toLowerCase()));
  const rule = audit?.rules.find(r => r.state_abbreviation === state);
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Provider requirement reviews <Badge variant="secondary">{scope === 'licensed' ? licensed.length : filtered.length}</Badge></h2>
      <div className="flex flex-wrap gap-2 min-w-0"><Input aria-label="Search requirement reviews" placeholder="Search providers…" value={search} onChange={e => setSearch(e.target.value)} className="w-56 max-w-full" />
        <Select value={state} onValueChange={value => { const next = new URLSearchParams(params); next.set('tab','reviews'); if (value === 'all') next.delete('state'); else next.set('state',value); setParams(next); }}><SelectTrigger className="w-56" aria-label="Review state"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All states</SelectItem>{allUSStates.map(s => <SelectItem key={s.abbreviation} value={s.abbreviation}>{s.name} ({s.abbreviation})</SelectItem>)}</SelectContent></Select>
      </div>
    </div>
    <Tabs value={scope} onValueChange={value => { const next = new URLSearchParams(params); next.set('scope', value); setParams(next); }}><TabsList className="flex flex-wrap h-auto justify-start"><TabsTrigger className="whitespace-normal text-left" value="active">Active in EHR · needs review ({filtered.length})</TabsTrigger><TabsTrigger className="whitespace-normal text-left" value="licensed">Medallion licensed · advance review ({licensed.length})</TabsTrigger></TabsList></Tabs>
    {scope === 'licensed' && <p className="text-xs text-muted-foreground">EHR snapshot fetched: {coverage?.pulledAt ? new Date(coverage.pulledAt).toLocaleString('en-US', {timeZone:'America/New_York'}) + ' ET' : 'Unavailable'}{coverage?.stale ? ' · May be out of date' : ''}</p>}
    {state !== 'all' && <StateRequirementLine state={state} collabType={rule?.collab_requirement_type} caRequired={rule?.ca_required} />}
    {loading && <p className="text-muted-foreground">Checking active-state requirements…</p>}
    {error && <p className="text-destructive">Could not load requirement reviews.</p>}
    {!loading && !error && !(scope === 'licensed' ? licensed.length : filtered.length) && <p className="text-muted-foreground">{scope === 'licensed' ? 'No Medallion-licensed providers outside the active EHR list.' : `No requirements need fixing${state !== 'all' ? ` in ${state}` : ''}.`}</p>}
    {scope === 'licensed' && <div className="divide-y border-y">{!loading && !error && licensed.map(r => <div key={`${r.provider.id}:${r.state}`} className="py-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2"><Link className="font-medium hover:underline" to={`/providers?search=${encodeURIComponent(r.name)}`}>{r.name} — {r.state}</Link><Badge variant="outline">Medallion license active</Badge><Badge variant={r.reviews.length ? 'outline' : 'secondary'}>{r.reviews.length ? 'Requirements to verify' : 'Saved requirements met'}</Badge></div>
      <p className="text-sm text-muted-foreground">{r.activation === 'not_active' ? 'Not active in this state in the latest EHR snapshot' : `EHR activation unconfirmed · ${r.activationDetail}`}</p>
      <StateRequirementLine state={r.state} collabType={audit?.rules.find(rule => rule.state_abbreviation === r.state)?.collab_requirement_type} caRequired={audit?.rules.find(rule => rule.state_abbreviation === r.state)?.ca_required} />
      {r.reviews.map((review, index) => <p key={index} className="text-sm text-destructive">{review.reason}</p>)}
      <div className="flex flex-wrap gap-2">{r.reviews.some(f => f.sheetReview || f.registrationReview || f.independentAlternative) && <Button size="sm" variant="outline" onClick={() => setVerify({profileId:r.provider.id,providerName:r.name,state:r.state})}>Verify state requirements</Button>}{r.reviews.length > 0 && (!SHEET_REQUIREMENTS[r.state] || SHEET_REQUIREMENTS[r.state].agreement || SHEET_REQUIREMENTS[r.state].agreementSubstitute) && <Button size="sm" variant="outline" onClick={() => setPrefill({stateAbbr:r.state,skipProcess:true,provider:{id:r.provider.id,name:r.name,email:r.provider.email,npi:r.provider.npi_number ?? undefined}})}>Add / link agreement</Button>}</div>
      {(audit?.requirementProofs ?? []).filter(p => p.profile_id === r.provider.id && p.state_abbreviation === r.state).map(p => <p key={p.requirement_key} className="text-sm text-muted-foreground">{REQUIREMENT_LABELS[p.requirement_key]} · {p.verified_on} {p.verified_attachment_path && <EvidenceLink reference={p.verified_attachment_path}>{p.verified_attachment_name ?? 'View file'}</EvidenceLink>} {p.verified_link && <EvidenceLink reference={p.verified_link}>Open link</EvidenceLink>} · {p.verified_source}</p>)}
      {(audit?.decisions ?? []).filter(d => d.profile_id === r.provider.id && d.state_abbreviation === r.state && d.verified_on).map((d, i) => <p key={`decision-${i}`} className="text-sm text-muted-foreground">{d.decision === 'ncbon_registered' ? 'NCBON registration' : d.decision === 'independent_verified' ? 'Independent practice' : 'Prescriptive authority'} · {d.verified_on} {d.verified_attachment_path && <EvidenceLink reference={d.verified_attachment_path}>{d.verified_attachment_name ?? 'View file'}</EvidenceLink>} {d.verified_link && <EvidenceLink reference={d.verified_link}>Open link</EvidenceLink>} · {d.verified_source}</p>)}
      {(audit?.agreements ?? []).filter(a => a.profileId === r.provider.id && a.state === r.state && a.document).filter((a, index, list) => list.findIndex(other => other.document?.trim() === a.document?.trim()) === index).map((a, i) => a.document ? <p key={i} className="text-sm">Collab Agreement · <EvidenceLink reference={a.document}>View document</EvidenceLink></p> : null)}
    </div>)}</div>}
    <div className="divide-y border-y">{scope === 'active' && filtered.map(f => {
      const existing = audit?.agreements.find(a => a.profileId === f.provider.id && a.state === f.state && a.agreementId && ['active','fully_executed'].includes(a.status ?? ''));
      return <div key={`${f.provider.id}:${f.state}`} className="py-4 space-y-2"><p className="font-medium">{f.name} — {f.state}</p>{f.newlyActive && <Badge variant="outline">Newly active in EHR</Badge>}<p className="text-sm text-destructive">{f.reason}</p><p className="text-sm text-muted-foreground">{f.howToFix}</p><div className="flex flex-wrap gap-2">
        {(f.sheetReview || f.registrationReview || f.independentAlternative) && <Button size="sm" variant="outline" onClick={() => setVerify({ profileId:f.provider.id,providerName:f.name,state:f.state })}>{f.registrationReview ? 'Verify NCBON registration' : f.sheetReview ? 'Verify state requirements' : ['PA','VA'].includes(f.state) ? 'Verify license designations' : 'Verify independent practice'}</Button>}
        {existing?.agreementId ? <Button size="sm" variant="outline" asChild><Link to={`/admin/agreements/${existing.agreementId}`}>Open agreement</Link></Button> : (!SHEET_REQUIREMENTS[f.state] || SHEET_REQUIREMENTS[f.state].agreement) && <Button size="sm" onClick={() => setPrefill({stateAbbr:f.state,skipProcess:true,provider:{id:f.provider.id,name:f.name,email:f.provider.email,npi:f.provider.npi_number ?? undefined}})}>Add / link agreement</Button>}
      </div></div>;
    })}</div>
    {scope === 'active' && state !== 'all' && <StateActiveProvidersCard state={state} />}
    {verify && <IndependentPracticeVerifyDialog open {...verify} onOpenChange={v => { if (!v) setVerify(null); }} />}
    <AgreementWizard open={!!prefill} prefill={prefill} onOpenChange={v => { if (!v) setPrefill(null); }} />
  </section>;
}