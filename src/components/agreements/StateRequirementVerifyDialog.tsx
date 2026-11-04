import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { REQUIREMENT_LABELS, SHEET_REQUIREMENTS, validRequirementProof } from '@/lib/stateSheetRequirements';
import { hasVerificationLink } from '@/lib/nyIndependentPractice';
import { useRequirementProofs, saveRequirementProof, refreshAgreementViews } from '@/hooks/useRequirementProofs';
import { useAuth } from '@/hooks/useAuth';
import { EvidenceLink } from './EvidenceLink';
import { toast } from 'sonner';

export function StateRequirementVerifyDialog({ open, onOpenChange, profileId, providerName, state }: { open: boolean; onOpenChange: (v: boolean) => void; profileId: string; providerName: string; state: string }) {
  const config = SHEET_REQUIREMENTS[state];
  const [key, setKey] = useState(config?.keys[0] ?? 'active_license');
  const [source, setSource] = useState(''); const [date, setDate] = useState(''); const [link, setLink] = useState(''); const [expiration, setExpiration] = useState('');
  const [file, setFile] = useState<File | null>(null); const [saving, setSaving] = useState(false);
  const { data = [], error } = useRequirementProofs(profileId); const { profile } = useAuth(); const client = useQueryClient();
  const save = async () => { setSaving(true); try { await saveRequirementProof({ profileId, state, key, source, date, link, file, expiration, verifiedBy: profile?.id }); await refreshAgreementViews(client); toast.success('Requirement verification saved'); setSource(''); setDate(''); setLink(''); setFile(null); onOpenChange(false); } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save verification'); } finally { setSaving(false); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
    <DialogHeader><DialogTitle>Verify state requirements — {state}</DialogTitle><DialogDescription>{providerName} · {config?.label}</DialogDescription></DialogHeader>
    {error && <p className="text-sm text-destructive">Could not load saved verification.</p>}
    {data.filter(p => p.state_abbreviation === state).map(p => <div key={p.requirement_key} className="text-sm border-b pb-2">
      <p>{REQUIREMENT_LABELS[p.requirement_key]} · {validRequirementProof(p) ? 'Verified' : 'Needs review'} {p.verified_on} {p.verified_attachment_path && <EvidenceLink reference={p.verified_attachment_path}>{p.verified_attachment_name ?? 'View file'}</EvidenceLink>} {p.verified_link && <EvidenceLink reference={p.verified_link}>Open link</EvidenceLink>}</p><p className="text-muted-foreground">{p.verified_source}</p>
    </div>)}
    <Label>Requirement to verify</Label><Select value={key} onValueChange={setKey}><SelectTrigger aria-label="Requirement to verify"><SelectValue /></SelectTrigger><SelectContent>{config?.keys.map(k => <SelectItem key={k} value={k}>{REQUIREMENT_LABELS[k]}</SelectItem>)}</SelectContent></Select>
    <Label htmlFor="req-source">Where was it verified?<span className="text-destructive" aria-hidden="true"> *</span></Label><Input id="req-source" value={source} onChange={e => setSource(e.target.value)} /><p className="text-xs text-muted-foreground">State board communication, Direct Shifts supervision spreadsheet, etc.</p>
    <Label htmlFor="req-date">When was it verified?<span className="text-destructive" aria-hidden="true"> *</span></Label><Input id="req-date" type="date" max={new Date().toISOString().slice(0,10)} value={date} onChange={e => setDate(e.target.value)} />
    <Label htmlFor="req-link">Verification link</Label><Input id="req-link" type="url" placeholder="https://…" value={link} onChange={e => setLink(e.target.value)} />
    <Label htmlFor="req-file">Or upload verification file</Label><Input id="req-file" type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} /><p className="text-xs text-muted-foreground">Upload a screenshot or saved document, or provide a link. Saved proof remains clickable.</p>
    <Label htmlFor="req-expiry">Expiration date (if applicable)</Label><Input id="req-expiry" type="date" value={expiration} onChange={e => setExpiration(e.target.value)} />
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button><Button onClick={save} disabled={saving || !source.trim() || !date || (!file && !hasVerificationLink(link))}>Save verification</Button></DialogFooter>
  </DialogContent></Dialog>;
}
export function StateRequirementProofList({ profileId }: { profileId: string }) {
  const { data = [] } = useRequirementProofs(profileId);
  return <div className="space-y-2">{data.map(p => <div key={`${p.state_abbreviation}:${p.requirement_key}`} className="text-sm"><span>{p.state_abbreviation} · {REQUIREMENT_LABELS[p.requirement_key]} · Verified {p.verified_on} </span>{p.verified_attachment_path && <EvidenceLink reference={p.verified_attachment_path}>{p.verified_attachment_name ?? 'View file'}</EvidenceLink>} {p.verified_link && <EvidenceLink reference={p.verified_link}>Open link</EvidenceLink>}<p className="text-muted-foreground">{p.verified_source}</p></div>)}</div>;
}