import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Archive, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ArchiveTaskDialogProps {
  taskId: string | null;
  taskTitle: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function ArchiveTaskDialog({ taskId, taskTitle, onClose, onSuccess }: ArchiveTaskDialogProps) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const handleArchive = async () => {
    if (!taskId || !reason.trim()) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('agreement_tasks')
         .update({
           status: 'archived' as any,
           is_required: false,
           archived_at: new Date().toISOString(),
           archived_by: user?.id || null,
          archived_reason: reason.trim(),
        })
        .eq('id', taskId);

      if (error) throw error;
      toast({ title: 'Task archived', description: 'The task has been archived successfully.' });
      setReason('');
      onSuccess();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!taskId} onOpenChange={() => { setReason(''); onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="h-4 w-4" />
            Archive Task
          </DialogTitle>
          <DialogDescription>
            Archiving "<span className="font-medium">{taskTitle}</span>" will remove it from the active queue. Please provide a reason.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label htmlFor="archive-reason">Reason for archiving</Label>
          <Textarea
            id="archive-reason"
            placeholder="e.g., Duplicate task, no longer relevant, completed out-of-band…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setReason(''); onClose(); }}>
            Cancel
          </Button>
          <Button onClick={handleArchive} disabled={saving || !reason.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Archive Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
