import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
  const focus = params.get('focus');
  const [expanded, setExpanded] = useState<string | null>(focus);
  useEffect(() => { if (focus) setExpanded(focus); }, [focus]);
  const [verify, setVerify] = useState<{ profileId: string; providerName: string; state: string } | null>(null);
  const [prefill, setPrefill] = useState<{ stateAbbr: string; skipProcess: boolean; provider: { id: string; name: string; email: string; npi?: string } } | null>(null);
  const { flags, loading, error, audit, rows, coverage } = useLicensedStateReadiness();
  const scope = params.get('scope') === 'licensed' ? 'licensed' : 'active';
  const licensed = rows.filter(r => (state === 'all' || r.state === state) && r.name.toLowerCase().includes(search.toLowerCase()));
  const filtered = flags.filter(f => (state === 'all' || f.state === state) && f.name.toLowerCase().includes(search.toLowerCase()));
  const rule = audit?.rules.find(r => r.state_abbreviation === state);
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Provider requirements <Badge variant="secondary">{scope === 'licensed' ? licensed.length : filtered.length}</Badge></h2>
      <div className="flex flex-wrap gap-2 min-w-0"><Input aria-label="Search requirement reviews" placeholder="Search providers…" value={search} onChange={e => setSearch(e.target.value)} className="w-56 max-w-full" />
        <Select value={state} onValueChange={value => { const next = new URLSearchParams(params); next.set('tab','compliance'); if (value === 'all') next.delete('state'); else next.set('state',value); setParams(next); }}><SelectTrigger className="w-56" aria-label="Review state"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All states</SelectItem>{allUSStates.map(s => <SelectItem key={s.abbreviation} value={s.abbreviation}>{s.name} ({s.abbreviation})</SelectItem>)}</SelectContent></Select>
      </div>
    </div>
    <Tabs value={scope} onValueChange={value => { const next = new URLSearchParams(params); next.set('scope', value); setExpanded(null); setParams(next); }}><TabsList className="flex flex-wrap h-auto justify-start"><TabsTrigger className="whitespace-normal text-left" value="active">Active · needs review ({filtered.length})</TabsTrigger><TabsTrigger className="whitespace-normal text-left" value="licensed">Licensed / requested · not active ({licensed.length})</TabsTrigger></TabsList></Tabs>
    {scope === 'licensed' && <p className="text-xs text-muted-foreground">EHR snapshot fetched: {coverage?.pulledAt ? new Date(coverage.pulledAt).toLocaleString('en-US', {timeZone:'America/New_York'}) + ' ET' : 'Unavailable'}{coverage?.stale ? ' · May be out of date' : ''}</p>}
    {state !== 'all' && <StateRequirementLine state={state} collabType={rule?.collab_requirement_type} caRequired={rule?.ca_required} />}
    {loading && <p className="text-muted-foreground">Checking active-state requirements…</p>}
    {error && <p className="text-destructive">Could not load requirement reviews.</p>}
    {!loading && !error && !(scope === 'licensed' ? licensed.length : filtered.length) && <p className="text-muted-foreground">{scope === 'licensed' ? 'No Medallion-licensed providers outside the active EHR list.' : `No requirements need fixing${state !== 'all' ? ` in ${state}` : ''}.`}</p>}
    {scope === 'licensed' && !loading && !error && [{ title: 'Recent activation requests', items: licensed.filter(r => r.activationRequested), accent: true }, { title: 'Licensed in Medallion · not active', items: licensed.filter(r => !r.activationRequested), accent: false }].filter(g => g.items.length).map(g => <div key={g.title} className="space-y-2"><h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{g.title} ({g.items.length})</h3><div className={`divide-y rounded-md border overflow-hidden ${g.accent ? 'border-primary' : ''}`}>{g.items.map(r => {
      const stateRule = audit?.rules.find(rule => rule.state_abbreviation === r.state);
      const savedProofs = (audit?.requirementProofs ?? []).filter(p => p.profile_id === r.provider.id && p.state_abbreviation === r.state);
      const savedDecisions = (audit?.decisions ?? []).filter(d => d.profile_id === r.provider.id && d.state_abbreviation === r.state && d.verified_on);
      const savedAgreements = (audit?.agreements ?? []).filter(a => a.profileId === r.provider.id && a.state === r.state && a.document).filter((a, index, list) => list.findIndex(other => other.document?.trim() === a.document?.trim()) === index);
      const rowKey = `${r.provider.id}:${r.state}`;
      return <Collapsible key={rowKey} open={expanded === rowKey} onOpenChange={open => setExpanded(open ? rowKey : null)}>
      <CollapsibleTrigger asChild><Button variant="ghost" className="h-auto w-full rounded-none px-4 py-3 justify-start gap-3 text-left whitespace-normal">
        {expanded === rowKey ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <span className="min-w-0 flex-1 font-semibold break-words">{r.name}</span>
        <Badge variant="secondary">{r.state}</Badge>
        {r.activationRequested && <Badge variant="outline">Requested{r.requestedAt ? ` · ${new Date(r.requestedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}` : ''}</Badge>}
        <span className={r.reviews.length ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}>{r.reviews.length ? `${r.reviews.length} to verify` : 'Requirements met'}</span>
      </Button></CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4 sm:pl-11 space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link className="text-base font-semibold hover:underline" to={`/providers?search=${encodeURIComponent(r.name)}`}>{r.name}</Link>
        <Badge variant="secondary" className="font-mono">{r.state}</Badge>

        <span className="text-xs text-muted-foreground">{r.activationRequested ? 'Activation requested · ' : ''}{r.activation === 'requested' ? 'Not yet active in EHR' : r.activation === 'not_active' ? 'Not active in the latest EHR snapshot' : `EHR activation unconfirmed · ${r.activationDetail}`}</span>
      </div>
      {state === 'all' && <StateRequirementLine state={r.state} collabType={stateRule?.collab_requirement_type} caRequired={stateRule?.ca_required} />}
      {r.reviews.length > 0 && <div className="space-y-2 border-l-2 border-destructive pl-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Needs verification ({r.reviews.length})</p>
        <ul className="list-disc pl-5 space-y-1">{r.reviews.map((review, index) => <li key={index} className="text-sm text-destructive">{review.reason}</li>)}</ul>
      </div>}
      <div className="flex flex-wrap gap-2">{r.reviews.some(f => f.sheetReview || f.registrationReview || f.independentAlternative) && <Button size="sm" variant="outline" onClick={() => setVerify({profileId:r.provider.id,providerName:r.name,state:r.state})}>Verify state requirements</Button>}{r.reviews.length > 0 && (!SHEET_REQUIREMENTS[r.state] || SHEET_REQUIREMENTS[r.state].agreement || SHEET_REQUIREMENTS[r.state].agreementSubstitute) && <Button size="sm" variant="outline" onClick={() => setPrefill({stateAbbr:r.state,skipProcess:true,provider:{id:r.provider.id,name:r.name,email:r.provider.email,npi:r.provider.npi_number ?? undefined}})}>Add / link agreement</Button>}</div>
      {(savedProofs.length > 0 || savedDecisions.length > 0 || savedAgreements.length > 0) && <div className="space-y-2 border-t pt-3 break-words">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Saved proof</p>
        {savedProofs.map(p => <p key={p.requirement_key} className="text-sm text-muted-foreground">{REQUIREMENT_LABELS[p.requirement_key]} · {p.verified_on} {p.verified_attachment_path && <EvidenceLink reference={p.verified_attachment_path}>{p.verified_attachment_name ?? 'View file'}</EvidenceLink>} {p.verified_link && <EvidenceLink reference={p.verified_link}>Open link</EvidenceLink>} · {p.verified_source}</p>)}
        {savedDecisions.map((d, i) => <p key={`decision-${i}`} className="text-sm text-muted-foreground">{d.decision === 'ncbon_registered' ? 'NCBON registration' : d.decision === 'independent_verified' ? 'Independent practice' : 'Prescriptive authority'} · {d.verified_on} {d.verified_attachment_path && <EvidenceLink reference={d.verified_attachment_path}>{d.verified_attachment_name ?? 'View file'}</EvidenceLink>} {d.verified_link && <EvidenceLink reference={d.verified_link}>Open link</EvidenceLink>} · {d.verified_source}</p>)}
        {savedAgreements.map((a, i) => a.document ? <p key={i} className="text-sm">Collab Agreement · <EvidenceLink reference={a.document}>View document</EvidenceLink></p> : null)}
      </div>}
      </CollapsibleContent></Collapsible>;})}</div></div>)}
    <div className="divide-y rounded-md border overflow-hidden">{scope === 'active' && filtered.map(f => {
      const existing = audit?.agreements.find(a => a.profileId === f.provider.id && a.state === f.state && a.agreementId && ['active','fully_executed'].includes(a.status ?? ''));
      const rowKey = `${f.provider.id}:${f.state}`;
      return <Collapsible key={rowKey} open={expanded === rowKey} onOpenChange={open => setExpanded(open ? rowKey : null)}>
      <CollapsibleTrigger asChild><Button variant="ghost" className="h-auto w-full rounded-none px-4 py-3 justify-start gap-3 text-left whitespace-normal">
        {expanded === rowKey ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <span className="min-w-0 flex-1 font-semibold break-words">{f.name}</span>
        <Badge variant="secondary">{f.state}</Badge>
        <span className="text-xs text-destructive">Needs review</span>
      </Button></CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4 sm:pl-11 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link className="text-base font-semibold hover:underline" to={`/providers?search=${encodeURIComponent(f.name)}`}>{f.name}</Link>
        <Badge variant="secondary" className="font-mono">{f.state}</Badge>
        {f.newlyActive && <Badge variant="outline">Newly active in EHR</Badge>}
      </div>
      <div className="space-y-2 border-l-2 border-destructive pl-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Needs fixing</p>
        <p className="text-sm text-destructive">{f.reason}</p>
        <p className="text-sm text-muted-foreground">{f.howToFix}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(f.sheetReview || f.registrationReview || f.independentAlternative) && <Button size="sm" variant="outline" onClick={() => setVerify({ profileId:f.provider.id,providerName:f.name,state:f.state })}>{f.registrationReview ? 'Verify NCBON registration' : f.sheetReview ? 'Verify state requirements' : ['PA','VA'].includes(f.state) ? 'Verify license designations' : 'Verify independent practice'}</Button>}
        {existing?.agreementId ? <Button size="sm" variant="outline" asChild><Link to={`/admin/agreements/${existing.agreementId}`}>Open agreement</Link></Button> : (!SHEET_REQUIREMENTS[f.state] || SHEET_REQUIREMENTS[f.state].agreement) && <Button size="sm" onClick={() => setPrefill({stateAbbr:f.state,skipProcess:true,provider:{id:f.provider.id,name:f.name,email:f.provider.email,npi:f.provider.npi_number ?? undefined}})}>Add / link agreement</Button>}
      </div></CollapsibleContent></Collapsible>;
    })}</div>
    {scope === 'active' && state !== 'all' && <Collapsible key={state} defaultOpen>
      <CollapsibleTrigger asChild><Button variant="outline" className="gap-2"><ChevronDown className="h-4 w-4" />All active providers in {state}</Button></CollapsibleTrigger>
      <CollapsibleContent className="pt-3"><StateActiveProvidersCard state={state} /></CollapsibleContent>
    </Collapsible>}
    {verify && <IndependentPracticeVerifyDialog open {...verify} onOpenChange={v => { if (!v) setVerify(null); }} />}
    <AgreementWizard open={!!prefill} prefill={prefill} onOpenChange={v => { if (!v) setPrefill(null); }} />
  </section>;
}