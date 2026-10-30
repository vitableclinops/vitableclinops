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

/** Save a verified independent-practice status for one provider/state. */
export async function saveIndependentVerification(input: {
  profileId: string; state: string; source: string; verifiedOn: string; notes?: string; decidedBy?: string | null;
  link?: string; file?: File | null;
}) {
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
    decision: 'independent_verified',
    verified_source: input.source.trim(),
    verified_on: input.verifiedOn,
    decision_notes: input.notes?.trim() || null,
    decided_by: input.decidedBy ?? null,
    verified_link: normalizeLink(input.link),
    ...(attachmentPath && { verified_attachment_path: attachmentPath, verified_attachment_name: input.file!.name }),
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

export function IndependentPracticeFields({ source, verifiedOn, link = '', file = null, onChange }: {
  source: string; verifiedOn: string; link?: string; file?: File | null; onChange: (v: IndependentFieldChange) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="ind-source">Where was it verified?</Label>
        <Input id="ind-source" aria-describedby="ind-source-description" placeholder="Enter verification source" value={source} onChange={e => onChange({ source: e.target.value })} />
        <p id="ind-source-description" className="text-sm text-muted-foreground">State board communication, Direct Shifts supervision spreadsheet, etc.</p>
      </div>
      <div className="space-y-2 rounded-md border p-3">
        <p className="text-sm font-medium">Proof of verification</p>
        <p className="text-sm text-muted-foreground">Upload a download of the verification (e.g. a saved email or screenshot) or paste a link to it. Links become clickable once saved.</p>
        <div className="space-y-1">
          <Label htmlFor="ind-link">Link (optional)</Label>
          <Input id="ind-link" type="url" placeholder="https://…" value={link} onChange={e => onChange({ link: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ind-file">Attachment (optional)</Label>
          <Input id="ind-file" type="file" onChange={e => onChange({ file: e.target.files?.[0] ?? null })} />
          {file && <p className="text-xs text-muted-foreground">Selected: {file.name}</p>}
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="ind-date">When was it verified?</Label>
        <Input id="ind-date" type="date" value={verifiedOn} max={new Date().toISOString().slice(0, 10)} onChange={e => onChange({ verifiedOn: e.target.value })} />
      </div>
    </div>
  );
}

export function IndependentPracticeVerifyDialog({ open, onOpenChange, profileId, providerName, state }: {
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

  const save = async () => {
    setSaving(true);
    try {
      await saveIndependentVerification({ profileId, state, source, verifiedOn, notes, link, file, decidedBy: profile?.id });
      toast.success(`${providerName}: independent practice verified in ${state}`);
      queryClient.invalidateQueries({ queryKey: ['directory-collaboration'] });
      queryClient.invalidateQueries({ queryKey: ['agreements'] });
      queryClient.invalidateQueries({ queryKey: ['independent-verifications'] });
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
          <DialogTitle>Verify independent practice — {state}</DialogTitle>
          <DialogDescription>{providerName} will no longer need a {state} collaborative agreement once saved.</DialogDescription>
        </DialogHeader>
        <IndependentPracticeFields source={source} verifiedOn={verifiedOn} link={link} file={file} onChange={v => { if (v.source !== undefined) setSource(v.source); if (v.verifiedOn !== undefined) setVerifiedOn(v.verifiedOn); if (v.link !== undefined) setLink(v.link); if (v.file !== undefined) setFile(v.file); }} />
        <div className="space-y-1">
          <Label htmlFor="ind-notes">Notes (optional)</Label>
          <Textarea id="ind-notes" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={saving || !source.trim() || !verifiedOn} onClick={save}>Save verification</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Saved independent-practice verifications for a provider, with clickable proof. */
export function IndependentVerificationList({ profileId }: { profileId: string }) {
  const { data = [] } = useQuery({
    queryKey: ['independent-verifications', profileId],
    queryFn: async () => {
      const { data, error } = await supabase.from('provider_state_collab_decisions')
        .select('state_abbreviation, verified_source, verified_on, verified_link, verified_attachment_path, verified_attachment_name')
        .eq('profile_id', profileId).eq('decision', 'independent_verified').order('state_abbreviation');
      if (error) throw error;
      return data ?? [];
    },
  });
  if (!data.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Verified independent practice</p>
      {data.map(d => (
        <div key={d.state_abbreviation} className="rounded-md border p-2 text-sm space-y-1">
          <p><span className="font-medium">{d.state_abbreviation}</span> — {d.verified_source} ({d.verified_on})</p>
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
