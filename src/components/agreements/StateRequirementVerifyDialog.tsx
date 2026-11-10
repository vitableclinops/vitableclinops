import { ProofEntry } from '@/components/agreements/ProofEntry';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './inlineableDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { REQUIREMENT_LABELS, REQUIREMENT_INFO_NOTES, SHEET_REQUIREMENTS, validRequirementProof, remainingVerificationKeys } from '@/lib/stateSheetRequirements';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';

/** Small info icon with a hover note, shown next to a requirement label. */
export function RequirementInfoNote({ state, requirementKey }: { state: string; requirementKey: string }) {
  const note = REQUIREMENT_INFO_NOTES[`${state}:${requirementKey}`];
  if (!note) return null;
  return <TooltipProvider><Tooltip><TooltipTrigger asChild>
    <button type="button" aria-label="Requirement info" className="inline-flex align-middle text-muted-foreground hover:text-foreground"><Info className="h-3.5 w-3.5" /></button>
  </TooltipTrigger><TooltipContent className="max-w-xs text-xs">
    <p>{note.text}</p>
    {note.url && <a href={note.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-primary underline">{note.urlLabel ?? note.url}</a>}
  </TooltipContent></Tooltip></TooltipProvider>;
}
import { useActiveStateAgreementAudit } from '@/hooks/useActiveStateAgreementAudit';
import { parseLocalDate } from '@/lib/utils';
import { hasVerificationLink } from '@/lib/nyIndependentPractice';
import { useRequirementProofs, saveRequirementProof, refreshAgreementViews } from '@/hooks/useRequirementProofs';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export type ProofDraft = { source: string; date: string; link: string; file: File | null; expiration: string };
export const emptyDraft = (): ProofDraft => ({ source: '', date: '', link: '', file: null, expiration: '' });
export const draftStarted = (d: ProofDraft) => !!(d.source.trim() || d.date || d.link.trim() || d.file);
export const draftComplete = (d: ProofDraft, fileOnly = false) => !!d.source.trim() && !!d.date && (fileOnly ? !!d.file : (!!d.file || hasVerificationLink(d.link)));

/** One requirement's verification fields (source, date, link OR file). */
export function RequirementProofSection({ id, label, draft, onChange, fileOnly = false, showExpiration = true, info }: { id: string; label: string; draft: ProofDraft; onChange: (d: ProofDraft) => void; fileOnly?: boolean; showExpiration?: boolean; info?: React.ReactNode }) {
  const set = (v: Partial<ProofDraft>) => onChange({ ...draft, ...v });
  return <div className="space-y-2 rounded-md border p-3">
    <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold">{label}{info && <span className="ml-1.5">{info}</span>}</p>{draftComplete(draft, fileOnly) ? <span className="text-xs text-primary">Ready to save</span> : draftStarted(draft) ? <span className="text-xs text-destructive">Incomplete</span> : null}</div>
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor={`${id}-source`}>Where verified?<span className="text-destructive" aria-hidden="true"> *</span></Label><Input id={`${id}-source`} placeholder="State board, DS spreadsheet…" value={draft.source} onChange={e => set({ source: e.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor={`${id}-date`}>When verified?<span className="text-destructive" aria-hidden="true"> *</span></Label><Input id={`${id}-date`} type="date" max={new Date().toISOString().slice(0,10)} value={draft.date} onChange={e => set({ date: e.target.value })} /></div>
    </div>
    <p className="text-xs font-medium">Proof of Verification<span className="text-destructive" aria-hidden="true"> *</span>{fileOnly ? ' (file required)' : ''}</p>
    <div className={fileOnly ? '' : 'grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-end'}>
      {!fileOnly && <><div className="space-y-1"><Label htmlFor={`${id}-link`}>Link</Label><Input id={`${id}-link`} type="url" placeholder="https://…" value={draft.link} onChange={e => set({ link: e.target.value })} /></div>
      <p className="text-center text-xs font-medium text-muted-foreground sm:pb-2">OR</p></>}
      <div className="space-y-1"><Label htmlFor={`${id}-file`}>File</Label><Input id={`${id}-file`} type="file" onChange={e => set({ file: e.target.files?.[0] ?? null })} /></div>
    </div>
    {showExpiration && <div className="space-y-1"><Label htmlFor={`${id}-exp`}>Expiration date (if applicable)</Label><Input id={`${id}-exp`} type="date" value={draft.expiration} onChange={e => set({ expiration: e.target.value })} /></div>}
  </div>;
}

export function StateRequirementVerifyDialog({ open, onOpenChange, profileId, providerName, state }: { open: boolean; onOpenChange: (v: boolean) => void; profileId: string; providerName: string; state: string }) {
  const config = SHEET_REQUIREMENTS[state];
  const [maPath, setMaPath] = useState('independent');
  const [drafts, setDrafts] = useState<Record<string, ProofDraft>>({});
  const [saving, setSaving] = useState(false);
  const { data = [], error, isLoading } = useRequirementProofs(profileId); const { profile } = useAuth(); const client = useQueryClient();
  const audit = useActiveStateAgreementAudit(open);
  const today = new Date();
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const agreement = audit.data?.agreements.some(a => a.profileId === profileId && a.state === state
    && ['active', 'fully_executed'].includes((a.status ?? '').toLowerCase()) && (!!a.document?.trim() || a.documentExempt)
    && (!a.start || parseLocalDate(a.start.slice(0, 10)) <= day) && (!a.end || parseLocalDate(a.end.slice(0, 10)) >= day)) ?? false;
  const remaining = remainingVerificationKeys(profileId, state, agreement, data, audit.data?.sheetLicenses ?? [], day);
  const pending = state === 'MA' ? remaining.filter(k => maPath === 'independent' ? k === 'ma_csr_independent' : k !== 'ma_csr_independent') : remaining;
  const loading = isLoading || audit.isLoading;
  const loadError = error || audit.error;
  const draftFor = (k: string) => drafts[k] ?? emptyDraft();
  const started = pending.filter(k => draftStarted(draftFor(k)));
  const canSave = started.length > 0 && started.every(k => draftComplete(draftFor(k)));
  const save = async () => {
    if (loading || loadError || !canSave) return; setSaving(true);
    try {
      for (const k of started) { const d = draftFor(k); await saveRequirementProof({ profileId, state, key: k, source: d.source, date: d.date, link: d.link, file: d.file, expiration: d.expiration, verifiedBy: profile?.id }); }
      await refreshAgreementViews(client); toast.success(`${started.length} verification${started.length > 1 ? 's' : ''} saved`); setDrafts({}); onOpenChange(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save verification'); } finally { setSaving(false); }
  };
  const joiner = config?.anyDesignation ? 'OR' : 'AND';
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
    <DialogHeader><DialogTitle>Verify state requirements — {state}</DialogTitle><DialogDescription>{providerName} · {config?.label}</DialogDescription></DialogHeader>
    {loadError && <p className="text-sm text-destructive">Could not load saved verification.</p>}
    {loading && <p className="text-sm text-muted-foreground">Checking saved requirements…</p>}
    {state === 'MA' && !loading && !loadError && remaining.length > 0 && <>
      <Label>Verification path</Label>
      <Select value={maPath} onValueChange={setMaPath}><SelectTrigger aria-label="Verification path"><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value="independent">CSR + Independent APRN supervision (one upload)</SelectItem>
        <SelectItem value="agreement">CSR + Signed Collab Agreement (two items)</SelectItem>
      </SelectContent></Select>
    </>}
    {!loading && !loadError && config?.agreement && <p className="text-sm">Collab Agreement: {agreement ? <span className="text-primary font-medium">on file</span> : <span className="text-destructive font-medium">not linked{config.alternative ? ' (or verify an alternative below)' : ''}</span>}</p>}
    {!loading && !loadError && <p className="text-sm font-medium">{pending.length ? `Fill in any requirements below — each has its own proof. ${pending.length > 1 ? `(${joiner})` : ''}` : 'No outstanding designation or registration verifications.'}</p>}
    {!loading && !loadError && pending.map((k, i) => <div key={k} className="space-y-2">
      {i > 0 && <p className="text-center text-xs font-semibold text-muted-foreground">{joiner}</p>}
      <RequirementProofSection id={`req-${k}`} label={REQUIREMENT_LABELS[k] ?? k} info={<RequirementInfoNote state={state} requirementKey={k} />} draft={draftFor(k)} onChange={d => setDrafts(prev => ({ ...prev, [k]: d }))} />
    </div>)}
    {data.filter(p => p.state_abbreviation === state).length > 0 && <div className="space-y-2"><p className="text-sm font-medium">Already saved</p>{data.filter(p => p.state_abbreviation === state).map(p => <div key={p.requirement_key} className="text-sm border-b pb-2">
      <ProofEntry label={REQUIREMENT_LABELS[p.requirement_key]} status={validRequirementProof(p) ? 'Verified' : 'Needs review'} proof={p} />
    </div>)}</div>}
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>{pending.length > 0 && !loading && !loadError && <Button onClick={save} disabled={saving || !canSave}>{saving ? 'Saving…' : started.length > 1 ? `Save ${started.length} verifications` : 'Save verification'}</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}
export function StateRequirementProofList({ profileId }: { profileId: string }) {
  const { data = [] } = useRequirementProofs(profileId);
  return <div className="space-y-2">{data.map(p => <div key={`${p.state_abbreviation}:${p.requirement_key}`} className="text-sm"><ProofEntry label={`${p.state_abbreviation} · ${REQUIREMENT_LABELS[p.requirement_key]}`} proof={p} /></div>)}</div>;
}