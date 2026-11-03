import { useEffect, useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EvidenceLink } from '@/components/agreements/EvidenceLink';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save } from 'lucide-react';

export function ChartReviewTaskUrl({ taskId, title, disabled = false, onSaved }: {
  taskId: string; title: string; disabled?: boolean; onSaved?: () => void;
}) {
  const matches = title.trim().toLowerCase() === 'link chart review calendar/tracker';
  const id = useId();
  const client = useQueryClient();
  const { toast } = useToast();
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const queryKey = ['chart-review-task-url', taskId];
  const { data: savedUrl, isLoading, error } = useQuery({
    queryKey,
    enabled: matches,
    queryFn: async () => {
      const { data, error } = await supabase.from('agreement_tasks').select('external_url').eq('id', taskId).single();
      if (error) throw error;
      return data.external_url ?? '';
    },
  });
  useEffect(() => { setUrl(savedUrl ?? ''); }, [savedUrl, taskId]);
  if (!matches) return null;

  const save = async () => {
    const value = url.trim();
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      toast({ title: 'Enter a valid URL', description: 'Use a full http:// or https:// link.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.from('agreement_tasks').update({ external_url: value }).eq('id', taskId).select('external_url').single();
      if (error) throw error;
      client.setQueryData(queryKey, data.external_url ?? '');
      onSaved?.();
      toast({ title: 'Chart review URL saved' });
    } catch {
      toast({ title: 'Could not save URL', description: 'Please try again.', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-2 mt-2 min-w-0" onClick={event => event.stopPropagation()}>
      <Label htmlFor={id}>Chart review calendar/tracker URL</Label>
      {savedUrl && <div><EvidenceLink reference={savedUrl}>Open calendar/tracker</EvidenceLink></div>}
      {error && <p className="text-xs text-destructive">Could not load the saved URL.</p>}
      {!disabled && <div className="flex flex-wrap items-center gap-2">
        <Input id={id} type="url" placeholder="https://…" value={url} onChange={event => setUrl(event.target.value)} disabled={saving || isLoading || !!error} className="flex-1 min-w-[150px]" />
        <Button type="button" size="sm" onClick={save} disabled={saving || isLoading || !!error || !url.trim() || url.trim() === savedUrl}>
          {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}Save URL
        </Button>
      </div>}
    </div>
  );
}