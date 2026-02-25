import { useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Archive, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface BulkArchiveDialogProps {
  taskIds: string[];
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function BulkArchiveDialog({ taskIds, open, onClose, onSuccess }: BulkArchiveDialogProps) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const handleArchive = async () => {
    if (!reason.trim() || taskIds.length === 0) return;
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
        .in('id', taskIds);

      if (error) throw error;
      toast({ title: 'Tasks archived', description: `${taskIds.length} task(s) archived successfully.` });
      setReason('');
      onSuccess();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => { setReason(''); onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="h-4 w-4" />
            Bulk Archive ({taskIds.length} tasks)
          </DialogTitle>
          <DialogDescription>
            Archive {taskIds.length} selected task(s). Please provide a reason.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label htmlFor="bulk-archive-reason">Reason for archiving</Label>
          <Textarea
            id="bulk-archive-reason"
            placeholder="e.g., Batch cleanup, no longer relevant…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setReason(''); onClose(); }}>Cancel</Button>
          <Button onClick={handleArchive} disabled={saving || !reason.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Archive {taskIds.length} Task(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
