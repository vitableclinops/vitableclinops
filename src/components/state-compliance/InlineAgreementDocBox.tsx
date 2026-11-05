import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { refreshAgreementViews } from '@/lib/agreementRefresh';

/** In-flag box to attach the signed Collab Agreement (file or link) to an existing agreement. */
export function InlineAgreementDocBox({ agreementId, state }: { agreementId: string; state: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState('');
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const validLink = /^https?:\/\/\S+$/i.test(link.trim());
  const canSave = !!file || validLink;

  const save = async () => {
    setSaving(true);
    try {
      let docUrl = link.trim();
      if (file) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `${agreementId}/agreement-doc/${Date.now()}-${safeName}`;
        const { error: upErr } = await supabase.storage.from('task-documents').upload(storagePath, file);
        if (upErr) throw upErr;
        const { data } = await supabase.storage.from('task-documents').createSignedUrl(storagePath, 60 * 60 * 24 * 365 * 10);
        docUrl = data?.signedUrl || storagePath;
      }
      const { error } = await supabase.from('collaborative_agreements').update({ agreement_document_url: docUrl }).eq('id', agreementId);
      if (error) throw error;
      await supabase.from('agreement_audit_log').insert({ entity_type: 'agreement', entity_id: agreementId, action: 'document_uploaded', changes: { file_name: file?.name ?? null, link: file ? null : docUrl, source: 'compliance_flag' } });
      await refreshAgreementViews(queryClient);
      toast({ title: 'Collab Agreement saved' });
      setFile(null); setLink('');
    } catch (e) {
      toast({ title: 'Could not save the agreement', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setSaving(false); }
  };

  return <div className="space-y-3 rounded-md border bg-card p-4">
    <div><p className="text-sm font-semibold">Upload signed Collab Agreement — {state}</p><p className="text-xs text-muted-foreground">An agreement exists but no signed document is on file. Add a file or link.</p></div>
    <p className="text-xs font-medium">Proof of Verification <span className="text-destructive">*</span></p>
    <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
      <div className="space-y-1"><Label className="text-xs">Link</Label><Input placeholder="https://..." value={link} disabled={!!file} onChange={e => setLink(e.target.value)} /></div>
      <span className="text-xs text-muted-foreground text-center pb-2">OR</span>
      <div className="space-y-1"><Label className="text-xs">File</Label><Input type="file" disabled={!!link.trim()} onChange={e => setFile(e.target.files?.[0] ?? null)} /></div>
    </div>
    <div className="flex justify-end"><Button size="sm" disabled={!canSave || saving} onClick={save}>{saving ? 'Saving…' : 'Save agreement'}</Button></div>
  </div>;
}
