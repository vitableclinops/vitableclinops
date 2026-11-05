import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Paperclip } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { EvidenceLink } from './EvidenceLink';
import { RX_AUTHORITY_REQUIRED_STATES, hasVerificationLink } from '@/lib/nyIndependentPractice';
import { refreshAgreementViews } from '@/lib/agreementRefresh';
import { SHEET_REQUIREMENTS } from '@/lib/stateSheetRequirements';
import { saveRequirementProof } from '@/hooks/useRequirementProofs';
import { StateRequirementVerifyDialog, StateRequirementProofList } from './StateRequirementVerifyDialog';

/** Save a verified independent-practice status for one provider/state. */
export async function saveIndependentVerification(input: {
  profileId: string; state: string; source: string; verifiedOn: string; notes?: string; decidedBy?: string | null;
  link?: string; file?: File | null; decision?: 'independent_verified' | 'rx_authority_verified' | 'ncbon_registered';
}) {
  if (input.state === 'PA' && (input.decision !== 'rx_authority_verified' || !input.source.trim() || !input.verifiedOn || !(input.file instanceof File))) {
    throw new Error('PA requires Rx Authority verification with source, date and an uploaded verification file.');
  }
  if (input.state === 'NC' && (input.decision !== 'ncbon_registered' || !input.source.trim() || !input.verifiedOn || (!(input.file instanceof File) && !hasVerificationLink(normalizeLink(input.link))))) {
    throw new Error('NC requires NCBON registration verification with source, date and a proof file or link.');
  }
  let attachmentPath: string | null = null;
  if (input.file) {
    const safe = input.file.name.replace(/[^\w.-]+/g, '_');
    attachmentPath = `independent-verification/${input.profileId}/${input.state}-${Date.now()}-${safe}`;
    const { error: upErr } = await supabase.storage.from('task-documents').upload(attachmentPath, input.file);
    if (upErr) throw upErr;
  }
  const { error } = await supabase.from('provider_state_collab_decisions').upsert({
    profile_id: input.profileId,
    state_abbreviation: input.state,
    decision: input.decision ?? 'independent_verified',
    verified_source: input.source.trim(),
    verified_on: input.verifiedOn,
    decision_notes: input.notes?.trim() || null,
    decided_by: input.decidedBy ?? null,
    verified_link: input.state === 'PA' ? null : normalizeLink(input.link),
    ...(attachmentPath && input.file && { verified_attachment_path: attachmentPath, verified_attachment_name: input.file.name }),
    decided_at: new Date().toISOString(),
  }, { onConflict: 'profile_id,state_abbreviation' });
  if (error) throw error;
}

export function normalizeLink(link?: string | null): string | null {
  const t = link?.trim();
  if (!t) return null;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export type IndependentFieldChange = { source?: string; verifiedOn?: string; link?: string; file?: File | null };

export function IndependentPracticeFields({ source, verifiedOn, link = '', file = null, onChange, requireFile = false, registration = false }: {
  source: string; verifiedOn: string; link?: string; file?: File | null; onChange: (v: IndependentFieldChange) => void; requireFile?: boolean; registration?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="ind-source">Where was it verified?<span className="text-destructive" aria-hidden="true"> *</span></Label>
        <Input id="ind-source" aria-describedby="ind-source-description" placeholder="Enter verification source" value={source} onChange={e => onChange({ source: e.target.value })} />
        <p id="ind-source-description" className="text-sm text-muted-foreground">State board communication, Direct Shifts supervision spreadsheet, etc.</p>
      </div>
      <div className="space-y-2 rounded-md border p-3">
        <p className="text-sm font-medium">Proof of Verification<span className="text-destructive" aria-hidden="true"> *</span></p>
        <p className="text-sm text-muted-foreground">{registration ? 'Upload a screenshot or saved NCBON approval, or paste a link verifying NCBON registration. Proof is required and remains clickable once saved.' : requireFile ? 'Upload a screenshot or saved document verifying the Rx Authority license designation. The file is clickable once saved.' : 'Upload a download of the verification (e.g. a saved email or screenshot) or paste a link to it. Links become clickable once saved.'}</p>
        {!requireFile && <div className="space-y-1">
          <Label htmlFor="ind-link">Link</Label>
          <Input id="ind-link" type="url" placeholder="https://…" value={link} onChange={e => onChange({ link: e.target.value })} />
        </div>}
        {!requireFile && <p className="text-center text-xs font-medium text-muted-foreground">OR</p>}
        <div className="space-y-1">
          <Label htmlFor="ind-file">Verification file</Label>
          <Input id="ind-file" type="file" required={requireFile} onChange={e => onChange({ file: e.target.files?.[0] ?? null })} />
          {file && <p className="text-xs text-muted-foreground">Selected: {file.name}</p>}
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="ind-date">When was it verified?<span className="text-destructive" aria-hidden="true"> *</span></Label>
        <Input id="ind-date" type="date" value={verifiedOn} max={new Date().toISOString().slice(0, 10)} onChange={e => onChange({ verifiedOn: e.target.value })} />
      </div>
    </div>
  );
}

function LegacyPracticeVerifyDialog({ open, onOpenChange, profileId, providerName, state }: {
  open: boolean; onOpenChange: (o: boolean) => void; profileId: string; providerName: string; state: string;
}) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [source, setSource] = useState('');
  const [verifiedOn, setVerifiedOn] = useState('');
  const [notes, setNotes] = useState('');
  const [link, setLink] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const rxState = RX_AUTHORITY_REQUIRED_STATES.has(state);
  const paState = state === 'PA';
  const ncState = state === 'NC';
  const [paPath, setPaPath] = useState<'rx' | 'pals'>('rx');
  const palsPath = paState && paPath === 'pals';
  const [vaPath, setVaPath] = useState<'independent_verified' | 'rx_authority_verified'>('independent_verified');

  const save = async () => {
    setSaving(true);
    try {
      if (palsPath) {
        await saveRequirementProof({ profileId, state: 'PA', key: 'pals_collab_registration', source, date: verifiedOn, link, file, verifiedBy: profile?.id });
        await refreshAgreementViews(queryClient);
        toast.success(`${providerName}: PA PALS collab registration verified`);
        onOpenChange(false);
        return;
      }
      await saveIndependentVerification({ profileId, state, source, verifiedOn, notes, link, file, decidedBy: profile?.id, decision: ncState ? 'ncbon_registered' : paState ? 'rx_authority_verified' : rxState ? vaPath : 'independent_verified' });
      await Promise.all([refreshAgreementViews(queryClient), queryClient.invalidateQueries({ queryKey: ['independent-verifications'] })]);
      toast.success(ncState ? `${providerName}: NCBON registration verified` : rxState && (paState || vaPath === 'rx_authority_verified') ? `${providerName}: ${state} prescriptive authority verified` : `${providerName}: independent practice verified in ${state}`);
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error('Could not save the verification');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ncState ? 'Verify NCBON registration — NC' : rxState ? `Verify license designations — ${state}` : `Verify independent practice — ${state}`}</DialogTitle>
          <DialogDescription>{ncState ? `${providerName} needs a signed Collab Agreement AND registration with NCBON. Verify registration with a source, date and proof; the Collab Agreement is still required.` : paState ? `${providerName} needs a Collab Agreement, an Rx Authority license designation (file proof) and PALS portal collab confirmation/registration. Verify one item at a time.` : rxState
            ? `${providerName} needs either a collaborative agreement plus prescriptive authority, or prescriptive authority plus autonomous practice.`
            : `${providerName} will no longer need a ${state} collaborative agreement once saved.`}</DialogDescription>
        </DialogHeader>
        {paState && (
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <p className="font-medium">What are you verifying?</p>
            <label className="flex items-start gap-2"><input type="radio" name="pa-path" className="mt-1" checked={paPath === 'rx'} onChange={() => setPaPath('rx')} /><span>"Rx Authority" license designation (file required)</span></label>
            <label className="flex items-start gap-2"><input type="radio" name="pa-path" className="mt-1" checked={paPath === 'pals'} onChange={() => setPaPath('pals')} /><span>PALS portal collab confirmed/registration</span></label>
          </div>
        )}
        {rxState && !paState && (
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <p className="font-medium">What did you verify on the license?</p>
            <label className="flex items-start gap-2"><input type="radio" name="va-path" className="mt-1" checked={vaPath === 'independent_verified'} onChange={() => setVaPath('independent_verified')} /><span>Prescriptive authority + autonomous practice (no agreement needed)</span></label>
            <label className="flex items-start gap-2"><input type="radio" name="va-path" className="mt-1" checked={vaPath === 'rx_authority_verified'} onChange={() => setVaPath('rx_authority_verified')} /><span>Prescriptive authority only (a signed collaborative agreement is also required)</span></label>
          </div>
        )}
        <IndependentPracticeFields registration={ncState} requireFile={paState && !palsPath} source={source} verifiedOn={verifiedOn} link={link} file={file} onChange={v => { if (v.source !== undefined) setSource(v.source); if (v.verifiedOn !== undefined) setVerifiedOn(v.verifiedOn); if (v.link !== undefined) setLink(v.link); if (v.file !== undefined) setFile(v.file); }} />
        <div className="space-y-1">
          <Label htmlFor="ind-notes">Notes (optional)</Label>
          <Textarea id="ind-notes" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={saving || !source.trim() || !verifiedOn || (paState && !(file instanceof File)) || (ncState && !(file instanceof File) && !hasVerificationLink(normalizeLink(link)))} onClick={save}>Save verification</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function IndependentPracticeVerifyDialog(props: { open: boolean; onOpenChange: (o: boolean) => void; profileId: string; providerName: string; state: string }) {
  return SHEET_REQUIREMENTS[props.state] ? <StateRequirementVerifyDialog key={`${props.profileId}:${props.state}`} {...props} /> : <LegacyPracticeVerifyDialog {...props} />;
}

/** Saved independent-practice verifications for a provider, with clickable proof. */
export function IndependentVerificationList({ profileId }: { profileId: string }) {
  const { data = [] } = useQuery({
    queryKey: ['independent-verifications', profileId],
    queryFn: async () => {
      const { data, error } = await supabase.from('provider_state_collab_decisions')
        .select('state_abbreviation, decision, verified_source, verified_on, verified_link, verified_attachment_path, verified_attachment_name')
        .eq('profile_id', profileId).in('decision', ['independent_verified', 'rx_authority_verified', 'ncbon_registered']).order('state_abbreviation');
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <div className="space-y-2">
      <StateRequirementProofList profileId={profileId} />
      <p className="text-sm font-medium">Saved requirement verifications</p>
      {data.map(d => (
        <div key={d.state_abbreviation} className="rounded-md border p-2 text-sm space-y-1">
          <p><span className="font-medium">{d.state_abbreviation}</span>{d.decision === 'ncbon_registered' ? ' (NCBON registration)' : d.decision === 'rx_authority_verified' ? ' (Rx authority)' : ''} — {d.verified_source} ({d.verified_on})</p>
          <div className="flex flex-wrap gap-3">
            {d.verified_link && (
              <a href={d.verified_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline break-all">
                {d.verified_link}<ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            )}
            {d.verified_attachment_path && (
              <EvidenceLink reference={d.verified_attachment_path}>
                <Paperclip className="h-3 w-3" />{d.verified_attachment_name ?? 'Attachment'}
              </EvidenceLink>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
