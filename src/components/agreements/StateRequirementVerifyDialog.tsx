import { ProofEntry } from '@/components/agreements/ProofEntry';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { REQUIREMENT_LABELS, SHEET_REQUIREMENTS, validRequirementProof, remainingVerificationKeys } from '@/lib/stateSheetRequirements';
import { useActiveStateAgreementAudit } from '@/hooks/useActiveStateAgreementAudit';
import { parseLocalDate } from '@/lib/utils';
import { hasVerificationLink } from '@/lib/nyIndependentPractice';
import { useRequirementProofs, saveRequirementProof, refreshAgreementViews } from '@/hooks/useRequirementProofs';
import { useAuth } from '@/hooks/useAuth';
import { EvidenceLink } from './EvidenceLink';
import { toast } from 'sonner';

export function StateRequirementVerifyDialog({ open, onOpenChange, profileId, providerName, state }: { open: boolean; onOpenChange: (v: boolean) => void; profileId: string; providerName: string; state: string }) {
  const config = SHEET_REQUIREMENTS[state];
  const [selectedKey, setKey] = useState('');
  const [maPath, setMaPath] = useState('independent');
  const [source, setSource] = useState(''); const [date, setDate] = useState(''); const [link, setLink] = useState(''); const [expiration, setExpiration] = useState('');
  const [file, setFile] = useState<File | null>(null); const [saving, setSaving] = useState(false);
  const { data = [], error, isLoading } = useRequirementProofs(profileId); const { profile } = useAuth(); const client = useQueryClient();
  const audit = useActiveStateAgreementAudit(open);
  const today = new Date();
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const agreement = audit.data?.agreements.some(a => a.profileId === profileId && a.state === state
    && ['active', 'fully_executed'].includes((a.status ?? '').toLowerCase()) && (!!a.document?.trim() || a.documentExempt)
    && (!a.start || parseLocalDate(a.start.slice(0, 10)) <= day) && (!a.end || parseLocalDate(a.end.slice(0, 10)) >= day)) ?? false;
  const remaining = remainingVerificationKeys(profileId, state, agreement, data, audit.data?.sheetLicenses ?? [], day);
  const pending = state === 'MA' ? remaining.filter(k => maPath === 'independent' ? k === 'ma_csr_independent' : k !== 'ma_csr_independent') : remaining;
  const key = pending.includes(selectedKey) ? selectedKey : pending[0] ?? '';
  const loading = isLoading || audit.isLoading;
  const loadError = error || audit.error;
  const save = async () => { if (loading || loadError || !key) return; setSaving(true); try { await saveRequirementProof({ profileId, state, key, source, date, link, file, expiration, verifiedBy: profile?.id }); await refreshAgreementViews(client); toast.success('Requirement verification saved'); setSource(''); setDate(''); setLink(''); setFile(null); onOpenChange(false); } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save verification'); } finally { setSaving(false); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
    <DialogHeader><DialogTitle>Verify state requirements — {state}</DialogTitle><DialogDescription>{providerName} · {config?.label}</DialogDescription></DialogHeader>
    {loadError && <p className="text-sm text-destructive">Could not load saved verification.</p>}
    {loading && <p className="text-sm text-muted-foreground">Checking saved requirements…</p>}
    {state === 'MA' && !loading && !loadError && remaining.length > 0 && <>
      <Label>Verification path</Label>
      <Select value={maPath} onValueChange={value => { setMaPath(value); setKey(''); setSource(''); setDate(''); setLink(''); setFile(null); setExpiration(''); }}><SelectTrigger aria-label="Verification path"><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value="independent">CSR + Independent APRN supervision (one upload)</SelectItem>
        <SelectItem value="agreement">CSR + Signed Collab Agreement (two items)</SelectItem>
      </SelectContent></Select>
    </>}
    {!loading && !loadError && <p className="text-sm font-medium">{pending.length ? `Still to verify: ${pending.map(k => REQUIREMENT_LABELS[k]).join(config?.anyDesignation ? ' OR ' : ' + ')}` : 'No outstanding designation or registration verifications.'}</p>}
    {data.filter(p => p.state_abbreviation === state).map(p => <div key={p.requirement_key} className="text-sm border-b pb-2">
      <ProofEntry label={REQUIREMENT_LABELS[p.requirement_key]} status={validRequirementProof(p) ? 'Verified' : 'Needs review'} proof={p} />
    </div>)}
    {!loading && !loadError && key && <>
    <Label>Requirement to verify</Label><Select value={key} onValueChange={value => { setKey(value); setSource(''); setDate(''); setLink(''); setFile(null); setExpiration(''); }}><SelectTrigger aria-label="Requirement to verify"><SelectValue /></SelectTrigger><SelectContent>{pending.map(k => <SelectItem key={k} value={k}>{REQUIREMENT_LABELS[k]}</SelectItem>)}</SelectContent></Select>
    <Label htmlFor="req-source">Where was it verified?<span className="text-destructive" aria-hidden="true"> *</span></Label><Input id="req-source" value={source} onChange={e => setSource(e.target.value)} /><p className="text-xs text-muted-foreground">State board communication, Direct Shifts supervision spreadsheet, etc.</p>
    <Label htmlFor="req-date">When was it verified?<span className="text-destructive" aria-hidden="true"> *</span></Label><Input id="req-date" type="date" max={new Date().toISOString().slice(0,10)} value={date} onChange={e => setDate(e.target.value)} />
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium">Proof of Verification<span className="text-destructive" aria-hidden="true"> *</span></p>
      <p className="text-xs text-muted-foreground">Upload a screenshot or saved document, or provide a link. Saved proof remains clickable.</p>
      <Label htmlFor="req-link">Verification link</Label><Input id="req-link" type="url" placeholder="https://…" value={link} onChange={e => setLink(e.target.value)} />
      <p className="text-center text-xs font-medium text-muted-foreground">OR</p>
      <div className="space-y-1"><Label htmlFor="req-file">Upload verification file</Label><Input id="req-file" type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} /></div>
    </div>
    <Label htmlFor="req-expiry">Expiration date (if applicable)</Label><Input id="req-expiry" type="date" value={expiration} onChange={e => setExpiration(e.target.value)} />
    </>}
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>{key && !loading && !loadError && <Button onClick={save} disabled={saving || !source.trim() || !date || (!file && !hasVerificationLink(link))}>Save verification</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}
export function StateRequirementProofList({ profileId }: { profileId: string }) {
  const { data = [] } = useRequirementProofs(profileId);
  return <div className="space-y-2">{data.map(p => <div key={`${p.state_abbreviation}:${p.requirement_key}`} className="text-sm"><ProofEntry label={`${p.state_abbreviation} · ${REQUIREMENT_LABELS[p.requirement_key]}`} proof={p} /></div>)}</div>;
}