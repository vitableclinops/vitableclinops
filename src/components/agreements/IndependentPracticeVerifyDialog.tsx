import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

/** Save a verified independent-practice status for one provider/state. */
export async function saveIndependentVerification(input: {
  profileId: string; state: string; source: string; verifiedOn: string; notes?: string; decidedBy?: string | null;
}) {
  const { error } = await supabase.from('provider_state_collab_decisions').upsert({
    profile_id: input.profileId,
    state_abbreviation: input.state,
    decision: 'independent_verified',
    verified_source: input.source.trim(),
    verified_on: input.verifiedOn,
    decision_notes: input.notes?.trim() || null,
    decided_by: input.decidedBy ?? null,
    decided_at: new Date().toISOString(),
  }, { onConflict: 'profile_id,state_abbreviation' });
  if (error) throw error;
}

export function IndependentPracticeFields({ source, verifiedOn, onChange }: {
  source: string; verifiedOn: string; onChange: (v: { source?: string; verifiedOn?: string }) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="ind-source">Where was it verified?</Label>
        <Input id="ind-source" placeholder="e.g. NYSED Office of the Professions lookup" value={source} onChange={e => onChange({ source: e.target.value })} />
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
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await saveIndependentVerification({ profileId, state, source, verifiedOn, notes, decidedBy: profile?.id });
      toast.success(`${providerName}: independent practice verified in ${state}`);
      queryClient.invalidateQueries({ queryKey: ['directory-collaboration'] });
      queryClient.invalidateQueries({ queryKey: ['agreements'] });
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
        <IndependentPracticeFields source={source} verifiedOn={verifiedOn} onChange={v => { if (v.source !== undefined) setSource(v.source); if (v.verifiedOn !== undefined) setVerifiedOn(v.verifiedOn); }} />
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
