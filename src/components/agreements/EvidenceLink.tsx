import { useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { evidenceReference } from '@/lib/evidenceReference';

/** Re-sign private files when opened; never make verification evidence public. */
export function EvidenceLink({ reference, children, bucket = 'task-documents', className = '', label }: { reference: string; children: React.ReactNode; bucket?: string; className?: string; label?: string }) {
  const [opening, setOpening] = useState(false);
  let resolved: ReturnType<typeof evidenceReference> | undefined;
  try { resolved = evidenceReference(reference, bucket); } catch { /* Report invalid references on click. */ }
  const classes = `h-auto p-0 whitespace-normal text-left max-w-full break-words ${className}`;
  if (resolved && 'url' in resolved) return <Button variant="link" size="sm" className={classes} asChild><a href={resolved.url} aria-label={label} target="_blank" rel="noopener noreferrer">{children}<ExternalLink className="ml-1 h-3 w-3 shrink-0" /></a></Button>;
  const open = async () => {
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    setOpening(true);
    try {
      if (!resolved || !('path' in resolved)) throw new Error('Invalid attachment reference');
      const { data, error } = await supabase.storage.from(resolved.bucket).createSignedUrl(resolved.path, 300);
      if (error || !data?.signedUrl) throw error ?? new Error('Missing file link');
      if (tab) tab.location.href = data.signedUrl;
      else window.location.assign(data.signedUrl);
    } catch {
      tab?.close();
      toast.error('Could not open the attachment');
    } finally { setOpening(false); }
  };
  return <Button variant="link" size="sm" className={classes} aria-label={label} disabled={opening} onClick={open}>{children}{opening ? <Loader2 className="ml-1 h-3 w-3 animate-spin" /> : <ExternalLink className="ml-1 h-3 w-3 shrink-0" />}</Button>;
}