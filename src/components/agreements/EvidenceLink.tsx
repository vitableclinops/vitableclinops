import { useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/** Re-sign private files when opened; never make verification evidence public. */
export function EvidenceLink({ reference, children }: { reference: string; children: React.ReactNode }) {
  const [opening, setOpening] = useState(false);
  const isUrl = /^https?:\/\//i.test(reference);
  if (isUrl) return <Button variant="link" size="sm" className="h-auto p-0 whitespace-normal text-left" asChild><a href={reference} target="_blank" rel="noopener noreferrer">{children}<ExternalLink className="ml-1 h-3 w-3 shrink-0" /></a></Button>;
  const open = async () => {
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    setOpening(true);
    try {
      const { data, error } = await supabase.storage.from('task-documents').createSignedUrl(reference, 300);
      if (error || !data?.signedUrl) throw error ?? new Error('Missing file link');
      if (tab) tab.location.href = data.signedUrl;
      else window.location.assign(data.signedUrl);
    } catch {
      tab?.close();
      toast.error('Could not open the attachment');
    } finally { setOpening(false); }
  };
  return <Button variant="link" size="sm" className="h-auto p-0 whitespace-normal text-left" disabled={opening} onClick={open}>{children}{opening ? <Loader2 className="ml-1 h-3 w-3 animate-spin" /> : <ExternalLink className="ml-1 h-3 w-3 shrink-0" />}</Button>;
}